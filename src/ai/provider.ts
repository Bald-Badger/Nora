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
export const model = () => process.env.AI_MODEL || "qwen/qwen3.8-27b";
const key = () =>
  readFileSync(
    /* turbopackIgnore: true */ process.env.AI_KEY_FILE ||
      "/run/secrets/groq_api_key",
    "utf8",
  ).trim();
type ProviderHealth = {
  checkedAt: number;
  available: boolean;
  state: "ready" | "unavailable" | "rate_limited";
  retryAt?: number;
};
let availability: ProviderHealth | undefined;
export async function providerHealth(): Promise<ProviderHealth> {
  if (
    availability?.state === "rate_limited" &&
    availability.retryAt &&
    Date.now() < availability.retryAt
  )
    return availability;
  if (availability && Date.now() - availability.checkedAt < 60_000)
    return availability;
  try {
    const response = await fetch("https://api.groq.com/openai/v1/models", {
      signal: AbortSignal.timeout(5000),
      headers: { Authorization: `Bearer ${key()}` },
    });
    await response.body?.cancel();
    availability = {
      checkedAt: Date.now(),
      available: response.ok,
      state: response.ok ? "ready" : "unavailable",
    };
  } catch {
    availability = {
      checkedAt: Date.now(),
      available: false,
      state: "unavailable",
    };
  }
  return availability;
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
          Authorization: `Bearer ${key()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model(),
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
      availability = {
        checkedAt: Date.now(),
        available: false,
        state: "unavailable",
      };
      throw failure;
    }
    const waitSeconds = Number(response.headers.get("retry-after"));
    if (response.status === 429 && waitSeconds > 0 && waitSeconds <= 10) {
      await response.body?.cancel();
      await new Promise((resolve) =>
        setTimeout(resolve, Math.ceil(waitSeconds * 1000) + 250),
      );
      response = await request();
    }
    if (!response.ok) {
      const retry = Number(response.headers.get("retry-after"));
      availability = {
        checkedAt: Date.now(),
        available: false,
        state: response.status === 429 ? "rate_limited" : "unavailable",
        ...(response.status === 429
          ? { retryAt: Date.now() + Math.max(retry || 60, 10) * 1000 }
          : {}),
      };
      throw new Error(
        `AI_HTTP_${response.status}${retry > 0 ? `_RETRY_SECONDS_${Math.ceil(retry)}` : ""}`,
      );
    }
    availability = {
      checkedAt: Date.now(),
      available: true,
      state: "ready",
    };
    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);
  }
}
function provider(): Provider {
  if ((process.env.AI_PROVIDER || "groq") !== "groq")
    throw new Error("AI_PROVIDER_UNSUPPORTED");
  return new GroqProvider();
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
