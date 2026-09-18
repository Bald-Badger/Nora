import { afterAll, beforeEach, expect, it } from "vitest";
import { db } from "../src/lib/db";
import {
  BraveMonthlyLimitError,
  reserveBraveImageSearch,
} from "../src/lib/brave";

beforeEach(async () => {
  await db.externalUsage.deleteMany();
  process.env.BRAVE_MONTHLY_QUERY_LIMIT = "2";
});
afterAll(async () => {
  delete process.env.BRAVE_MONTHLY_QUERY_LIMIT;
  await db.$disconnect();
});

it("allows exactly the configured number of Brave searches per month", async () => {
  const now = new Date("2026-09-17T18:00:00Z");
  await reserveBraveImageSearch(now);
  await reserveBraveImageSearch(now);
  await expect(reserveBraveImageSearch(now)).rejects.toBeInstanceOf(
    BraveMonthlyLimitError,
  );
  await expect(
    db.externalUsage.findUniqueOrThrow({
      where: {
        provider_period: { provider: "brave-image-search", period: "2026-09" },
      },
    }),
  ).resolves.toMatchObject({ count: 2 });
});
