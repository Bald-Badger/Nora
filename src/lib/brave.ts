import { readFileSync } from "node:fs";
import { db, settingNumber } from "./db";

const provider = "brave-image-search";
const keyFile = () =>
  process.env.BRAVE_SEARCH_KEY_FILE || "/run/secrets/brave_search_api_key";
const limit = () => settingNumber("BRAVE_MONTHLY_QUERY_LIMIT", 999);

function period(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.HOUSEHOLD_TIMEZONE || "America/Phoenix",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const value = (type: "year" | "month") =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}`;
}

export class BraveMonthlyLimitError extends Error {
  constructor() {
    super("BRAVE_MONTHLY_QUERY_LIMIT");
  }
}

export async function reserveBraveImageSearch(now = new Date()) {
  const month = period(now);
  const monthlyLimit = limit();
  const changed = await db.$executeRaw`
    INSERT INTO "ExternalUsage" ("provider", "period", "count", "createdAt", "updatedAt")
    VALUES (${provider}, ${month}, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("provider", "period") DO UPDATE SET
      "count" = "ExternalUsage"."count" + 1,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "ExternalUsage"."count" < ${monthlyLimit}
  `;
  if (changed !== 1) throw new BraveMonthlyLimitError();
  return db.externalUsage.findUniqueOrThrow({
    where: { provider_period: { provider, period: month } },
  });
}

export type BraveImageResult = {
  title: string;
  pageUrl: string;
  imageUrl: string;
  thumbnailUrl: string;
  source: string;
  width?: number;
  height?: number;
};

export async function searchBraveImages(query: string, count = 8) {
  const normalized = query.trim();
  if (!normalized || normalized.length > 400) throw new Error("BRAVE_QUERY_INVALID");
  const requestedCount = Math.max(1, Math.min(Math.trunc(count), 20));
  await reserveBraveImageSearch();
  const key = readFileSync(/* turbopackIgnore: true */ keyFile(), "utf8").trim();
  if (!key) throw new Error("BRAVE_KEY_UNAVAILABLE");
  const response = await fetch(
    `https://api.search.brave.com/res/v1/images/search?${new URLSearchParams({
      q: normalized,
      count: String(requestedCount),
      search_lang: "zh-hans",
      safesearch: "strict",
    })}`,
    {
      signal: AbortSignal.timeout(15_000),
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": key,
      },
    },
  );
  if (!response.ok) throw new Error(`BRAVE_HTTP_${response.status}`);
  const body = (await response.json()) as {
    results?: Array<{
      title?: string;
      url?: string;
      source?: string;
      thumbnail?: { src?: string; width?: number; height?: number };
      properties?: { url?: string; width?: number; height?: number };
    }>;
  };
  return (body.results || [])
    .flatMap((result): BraveImageResult[] => {
      const imageUrl = result.properties?.url;
      const thumbnailUrl = result.thumbnail?.src;
      if (!imageUrl || !thumbnailUrl || !result.url) return [];
      return [
        {
          title: result.title || "",
          pageUrl: result.url,
          imageUrl,
          thumbnailUrl,
          source: result.source || new URL(result.url).hostname,
          width: result.properties?.width || result.thumbnail?.width,
          height: result.properties?.height || result.thumbnail?.height,
        },
      ];
    })
    .slice(0, requestedCount);
}
