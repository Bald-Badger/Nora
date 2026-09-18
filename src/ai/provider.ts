import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";
import { intentSchema, resultSchema } from "../lib/schema";
const promptNames = ["core", "inventory", "image", "expiration", "recommend"];
const directory = process.env.PROMPT_DIR || "/app/src/ai/prompts";
const prompts = Object.fromEntries(
  promptNames.map((n) => [n, readFileSync(`${directory}/${n}.md`, "utf8")]),
);
export const promptVersion = createHash("sha256")
  .update(promptNames.map((n) => prompts[n]).join("\n"))
  .digest("hex")
  .slice(0, 16);
const groqModel = () => process.env.AI_MODEL || "qwen/qwen3.8-27b";
const geminiModel = () =>
  process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
export const model = () =>
  `${process.env.AI_PROVIDER || "groq"}:${
    (process.env.AI_PROVIDER || "groq") === "gemini"
      ? geminiModel()
      : groqModel()
  }`;
const groqKey = () =>
  readFileSync(
    /* turbopackIgnore: true */ process.env.AI_KEY_FILE ||
      "/run/secrets/groq_api_key",
    "utf8",
  ).trim();
const geminiKey = () => {
  try {
    return readFileSync(
      /* turbopackIgnore: true */ process.env.GEMINI_KEY_FILE ||
        "/run/secrets/gemini_api_key",
      "utf8",
    ).trim();
  } catch {
    return undefined;
  }
};
type Agent = "groq" | "gemini";
type AgentHealth = {
  checkedAt: number;
  available: boolean;
  state: "ready" | "unavailable" | "rate_limited";
  retryAt?: number;
};
type ProviderHealth = AgentHealth & {
  provider?: Agent;
  agents?: Record<Agent, AgentHealth>;
};
let availability: ProviderHealth | undefined;
const agentAvailability: Partial<Record<Agent, AgentHealth>> = {};
function markHealth(provider: Agent, health: AgentHealth) {
  agentAvailability[provider] = health;
  availability = { ...health, provider };
}
function cachedHealth(provider: Agent) {
  const health = agentAvailability[provider];
  if (
    health?.state === "rate_limited" &&
    health.retryAt &&
    Date.now() < health.retryAt
  )
    return health;
  if (health && Date.now() - health.checkedAt < 60_000) return health;
  return undefined;
}
async function groqHealth(): Promise<AgentHealth> {
  const cached = cachedHealth("groq");
  if (cached) return cached;
  try {
    const response = await fetch("https://api.groq.com/openai/v1/models", {
      signal: AbortSignal.timeout(5000),
      headers: { Authorization: `Bearer ${groqKey()}` },
    });
    await response.body?.cancel();
    const health: AgentHealth = {
      checkedAt: Date.now(),
      available: response.ok,
      state: response.ok ? "ready" : "unavailable",
    };
    markHealth("groq", health);
    return health;
  } catch {
    const health: AgentHealth = {
      checkedAt: Date.now(),
      available: false,
      state: "unavailable",
    };
    markHealth("groq", health);
    return health;
  }
}
async function geminiHealth(): Promise<AgentHealth> {
  const cached = cachedHealth("gemini");
  if (cached) return cached;
  const key = geminiKey();
  if (!key) {
    const health: AgentHealth = {
      checkedAt: Date.now(),
      available: false,
      state: "unavailable",
    };
    markHealth("gemini", health);
    return health;
  }
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel()}`,
      {
        signal: AbortSignal.timeout(5000),
        headers: { "x-goog-api-key": key },
      },
    );
    await response.body?.cancel();
    const health: AgentHealth = {
      checkedAt: Date.now(),
      available: response.ok,
      state: response.ok ? "ready" : "unavailable",
    };
    markHealth("gemini", health);
    return health;
  } catch {
    const health: AgentHealth = {
      checkedAt: Date.now(),
      available: false,
      state: "unavailable",
    };
    markHealth("gemini", health);
    return health;
  }
}
export async function providerHealth(): Promise<ProviderHealth> {
  const [groq, gemini] = await Promise.all([groqHealth(), geminiHealth()]);
  const selected = groq.available
    ? { ...groq, provider: "groq" as const }
    : gemini.available
      ? { ...gemini, provider: "gemini" as const }
      : { ...groq, provider: "groq" as const };
  return { ...selected, agents: { groq, gemini } };
}
export async function providerAvailable() {
  return (await providerHealth()).available;
}
export interface Provider {
  complete(
    system: string,
    content: unknown[],
    maxTokens?: number,
  ): Promise<unknown>;
}
class GroqProvider implements Provider {
  async complete(system: string, content: unknown[], maxTokens = 2048) {
    const request = () =>
      fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(60000),
        headers: {
          Authorization: `Bearer ${groqKey()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: groqModel(),
          messages: [
            { role: "system", content: system },
            { role: "user", content },
          ],
          response_format: { type: "json_object" },
          max_completion_tokens: maxTokens,
          temperature: 0.2,
        }),
      });
    let response: Response;
    try {
      response = await request();
    } catch (failure) {
      markHealth("groq", {
        checkedAt: Date.now(),
        available: false,
        state: "unavailable",
      });
      throw failure;
    }
    if (!response.ok) {
      const retry = Number(response.headers.get("retry-after"));
      markHealth("groq", {
        checkedAt: Date.now(),
        available: false,
        state: response.status === 429 ? "rate_limited" : "unavailable",
        ...(response.status === 429
          ? { retryAt: Date.now() + Math.max(retry || 60, 10) * 1000 }
          : {}),
      });
      throw new Error(
        `AI_HTTP_${response.status}${retry > 0 ? `_RETRY_SECONDS_${Math.ceil(retry)}` : ""}`,
      );
    }
    markHealth("groq", {
      checkedAt: Date.now(),
      available: true,
      state: "ready",
    });
    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);
  }
}
class GeminiProvider implements Provider {
  constructor(private readonly apiKey: string) {}

  async complete(system: string, content: unknown[], maxTokens = 2048) {
    const parts = content.flatMap<
      | { text: string }
      | { inlineData: { mimeType: string; data: string } }
    >((part) => {
      if (!part || typeof part !== "object") return [];
      const value = part as {
        type?: string;
        text?: string;
        image_url?: { url?: string };
      };
      if (value.type === "text" && value.text)
        return [{ text: value.text }];
      if (value.type === "image_url" && value.image_url?.url) {
        const match = value.image_url.url.match(
          /^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/,
        );
        if (match)
          return [{ inlineData: { mimeType: match[1], data: match[2] } }];
      }
      return [];
    });
    let response: Response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel()}:generateContent`,
        {
          method: "POST",
          signal: AbortSignal.timeout(60000),
          headers: {
            "x-goog-api-key": this.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts }],
            generationConfig: {
              responseMimeType: "application/json",
              maxOutputTokens: maxTokens,
              temperature: 0.2,
            },
          }),
        },
      );
    } catch (failure) {
      markHealth("gemini", {
        checkedAt: Date.now(),
        available: false,
        state: "unavailable",
      });
      throw failure;
    }
    if (!response.ok) {
      const retry = Number(response.headers.get("retry-after"));
      markHealth("gemini", {
        checkedAt: Date.now(),
        available: false,
        state: response.status === 429 ? "rate_limited" : "unavailable",
        ...(response.status === 429
          ? { retryAt: Date.now() + Math.max(retry || 60, 10) * 1000 }
          : {}),
      });
      throw new Error(
        `AI_HTTP_${response.status}${retry > 0 ? `_RETRY_SECONDS_${Math.ceil(retry)}` : ""}`,
      );
    }
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text || "")
      .join("");
    if (!text) throw new Error("AI_EMPTY_RESPONSE");
    markHealth("gemini", {
      checkedAt: Date.now(),
      available: true,
      state: "ready",
    });
    return JSON.parse(text);
  }
}
class FallbackProvider implements Provider {
  constructor(
    private readonly primary: Provider,
    private readonly fallback?: Provider,
  ) {}

  async complete(system: string, content: unknown[], maxTokens?: number) {
    try {
      return await this.primary.complete(system, content, maxTokens);
    } catch (failure) {
      if (!this.fallback) throw failure;
      return this.fallback.complete(system, content, maxTokens);
    }
  }
}
function provider(): Provider {
  const selected = process.env.AI_PROVIDER || "groq";
  if (selected === "gemini") {
    const fallbackKey = geminiKey();
    if (!fallbackKey) throw new Error("AI_PROVIDER_UNCONFIGURED");
    return new GeminiProvider(fallbackKey);
  }
  if (selected !== "groq")
    throw new Error("AI_PROVIDER_UNSUPPORTED");
  const fallbackKey =
    process.env.AI_GEMINI_FALLBACK === "false" ? undefined : geminiKey();
  return new FallbackProvider(
    new GroqProvider(),
    fallbackKey ? new GeminiProvider(fallbackKey) : undefined,
  );
}
export async function completeStructured(
  system: string,
  content: unknown[],
  maxTokens?: number,
) {
  return provider().complete(system, content, maxTokens);
}
export async function classify(message: string) {
  return intentSchema.parse(
    await provider().complete(
      prompts.core +
        "\nClassify the request, without inventory access. Do not answer it. Return intent edit/query/recommend/shopping/undo/unrelated and search terms for relevant item names. Use unrelated for requests that are not about household food inventory, storage, expiration, groceries, cooking from inventory, recipes, meal planning, or shopping based on inventory. A message saying an item was opened is edit. expirationCorrection is true ONLY if the user explicitly requests correcting an existing expiration date. General inventory queries may have empty terms. Schema: " +
        JSON.stringify(z.toJSONSchema(intentSchema)),
      [{ type: "text", text: message }],
      256,
    ),
  );
}
export async function interpret(
  message: string,
  context: unknown,
  mode: string,
  image?: string,
) {
  const system = [
    prompts.core,
    mode === "recommend" || mode === "shopping"
      ? prompts.recommend
      : prompts.inventory,
    prompts.expiration,
    image ? prompts.image : "",
    "Return JSON matching: " + JSON.stringify(z.toJSONSchema(resultSchema)),
  ].join("\n");
  const content: unknown[] = [
    { type: "text", text: JSON.stringify({ context, message }) },
  ];
  if (image) content.push({ type: "image_url", image_url: { url: image } });
  const result = resultSchema.parse(await provider().complete(system, content));
  if (
    ["query", "recommend", "shopping"].includes(mode) &&
    result.actions.length
  )
    throw new Error("AI_READ_ONLY_VIOLATION");
  return result;
}
