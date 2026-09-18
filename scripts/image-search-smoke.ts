import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { searchBraveImages, type BraveImageResult } from "../src/lib/brave";

type DishResults = { dish: string; candidates: BraveImageResult[] };
type Winner = { dish: string; index: number; reason: string };
type CachedDish = {
  dish: string;
  winnerIndex: number | null;
  candidates: Array<BraveImageResult & { cachedPreview: string }>;
};

const searches = [
  { dish: "腌笃鲜", query: "腌笃鲜" },
  { dish: "Air fryer salmon", query: "air fryer salmon" },
];

const key = (name: string, fallback: string) =>
  readFileSync(process.env[name] || fallback, "utf8").trim();

const candidateText = (results: DishResults[]) =>
  results
    .map(({ dish, candidates }) =>
      `${dish}:\n${candidates
        .map(
          (candidate, index) =>
            `${index + 1}. ${candidate.title} | ${candidate.source} | ${candidate.width || "?"}x${candidate.height || "?"} | ${candidate.thumbnailUrl}`,
        )
        .join("\n")}`,
    )
    .join("\n\n");

const system = `You are choosing menu-card photos. For each dish, select the candidate thumbnail that most accurately and appetizingly depicts that exact dish. Prefer a clear finished-dish photo, not ingredients, packaging, an unrelated dish, or a text graphic. Return JSON only: {"winners":[{"dish":"string","index":number,"reason":"short explanation"}]}. index is one-based and must refer to the candidates supplied for that dish.`;

async function selectWithGroq(results: DishResults[]): Promise<Winner[]> {
  const content: unknown[] = [{ type: "text", text: candidateText(results) }];
  for (const { dish, candidates } of results) {
    for (const [index, candidate] of candidates.entries()) {
      content.push({ type: "text", text: `${dish}, candidate ${index + 1}` });
      content.push({ type: "image_url", image_url: { url: candidate.thumbnailUrl } });
    }
  }
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: {
      Authorization: `Bearer ${key("AI_KEY_FILE", "/run/secrets/groq_api_key")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL || "qwen/qwen3.8-27b",
      messages: [
        { role: "system", content: system },
        { role: "user", content },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 700,
      temperature: 0,
    }),
  });
  if (!response.ok) throw new Error(`GROQ_HTTP_${response.status}`);
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return JSON.parse(body.choices?.[0]?.message?.content || "{}")?.winners || [];
}

async function selectWithGeminiText(results: DishResults[]): Promise<Winner[]> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || "gemini-3.5-flash-lite"}:generateContent`,
    {
      method: "POST",
      signal: AbortSignal.timeout(60_000),
      headers: {
        "x-goog-api-key": key("GEMINI_KEY_FILE", "/run/secrets/gemini_api_key"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: `${system} You cannot view thumbnails in this fallback; use titles and sources only.` }] },
        contents: [{ role: "user", parts: [{ text: candidateText(results) }] }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: 700, temperature: 0 },
      }),
    },
  );
  if (!response.ok) throw new Error(`GEMINI_HTTP_${response.status}`);
  const body = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
  return JSON.parse(text || "{}")?.winners || [];
}

async function downloadThumbnail(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "imgs.search.brave.com")
    throw new Error("THUMBNAIL_HOST_REJECTED");
  const response = await fetch(parsed, {
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const type = response.headers.get("content-type")?.split(";", 1)[0];
  if (!response.ok || !type || !["image/jpeg", "image/png", "image/webp"].includes(type))
    throw new Error("THUMBNAIL_RESPONSE_REJECTED");
  const declared = Number(response.headers.get("content-length") || 0);
  const maximum = 2 * 1024 * 1024;
  if (declared > maximum) throw new Error("THUMBNAIL_TOO_LARGE");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("THUMBNAIL_EMPTY");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maximum) throw new Error("THUMBNAIL_TOO_LARGE");
    chunks.push(value);
  }
  const image = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    image.set(chunk, offset);
    offset += chunk.length;
  }
  return { image, extension: type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg" };
}

async function cachePreviews(results: DishResults[], winners: Winner[]) {
  const root = process.env.MENU_IMAGE_CACHE_DIR || "/app/data/menu-images/smoke-search";
  await mkdir(root, { recursive: true, mode: 0o700 });
  const winnerByDish = new Map(winners.map((winner) => [winner.dish, winner]));
  const cached: CachedDish[] = [];
  for (const [dishIndex, dish] of results.entries()) {
    const directory = join(root, `dish-${dishIndex + 1}`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const winner = winnerByDish.get(dish.dish);
    const winnerIndex = winner && winner.index >= 1 && winner.index <= dish.candidates.length ? winner.index : null;
    const candidates = await Promise.all(
      dish.candidates.map(async (candidate, candidateIndex) => {
        const preview = await downloadThumbnail(candidate.thumbnailUrl);
        const filename = `candidate-${candidateIndex + 1}.${preview.extension}`;
        await writeFile(join(directory, filename), preview.image, { mode: 0o600 });
        return { ...candidate, cachedPreview: join(directory, filename) };
      }),
    );
    cached.push({ dish: dish.dish, winnerIndex, candidates });
  }
  await writeFile(
    join(root, "manifest.json"),
    JSON.stringify({ kind: "brave-thumbnail-preview", storedAt: new Date().toISOString(), cached }, null, 2),
    { mode: 0o600 },
  );
  return { root, cached };
}

try {
  const results = await Promise.all(
    searches.map(async ({ dish, query }) => ({ dish, candidates: await searchBraveImages(query, 4) })),
  );
  let provider = "groq";
  let winners: Winner[];
  try {
    winners = await selectWithGroq(results);
  } catch {
    provider = "gemini-text-fallback";
    winners = await selectWithGeminiText(results);
  }
  const cache = await cachePreviews(results, winners);
  console.log(JSON.stringify({ provider, results, winners, cache }, null, 2));
} finally {
  process.exitCode = 0;
}
