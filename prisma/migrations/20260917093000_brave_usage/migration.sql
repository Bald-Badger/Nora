-- Track externally metered requests separately from inventory and AI audit records.
CREATE TABLE "ExternalUsage" (
    "provider" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("provider", "period")
);

-- Two Brave Image Search requests were made while validating the integration.
INSERT INTO "ExternalUsage" ("provider", "period", "count")
VALUES ('brave-image-search', '2026-09', 2)
ON CONFLICT ("provider", "period") DO NOTHING;
