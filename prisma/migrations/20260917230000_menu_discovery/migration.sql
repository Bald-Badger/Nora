ALTER TABLE "Session" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'nora';

CREATE INDEX "Session_scope_idx" ON "Session"("scope");

CREATE TABLE "MenuGeneration" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "status" TEXT NOT NULL DEFAULT 'active',
  "source" TEXT NOT NULL,
  "inventoryRevision" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "MenuGeneration_status_createdAt_idx" ON "MenuGeneration"("status", "createdAt");

CREATE TABLE "MenuDish" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "generationId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "nameZh" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "prepMinutes" INTEGER NOT NULL,
  "cookMinutes" INTEGER NOT NULL,
  "imageSearchQuery" TEXT NOT NULL,
  "ingredientsJson" TEXT NOT NULL,
  "stepsZhJson" TEXT NOT NULL,
  "stepsEnJson" TEXT NOT NULL,
  "requiredItemIdsJson" TEXT NOT NULL,
  "useSoon" BOOLEAN NOT NULL DEFAULT false,
  "imageId" TEXT,
  "imageStatus" TEXT NOT NULL DEFAULT 'queued',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "MenuDish_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "MenuGeneration"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MenuDish_generationId_position_key" ON "MenuDish"("generationId", "position");
CREATE INDEX "MenuDish_generationId_position_idx" ON "MenuDish"("generationId", "position");

CREATE TABLE "MenuImage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "normalizedDish" TEXT NOT NULL,
  "candidateIndex" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "pageUrl" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "preferred" BOOLEAN NOT NULL DEFAULT false,
  "selected" BOOLEAN NOT NULL DEFAULT false,
  "disliked" BOOLEAN NOT NULL DEFAULT false,
  "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "MenuImage_normalizedDish_candidateIndex_key" ON "MenuImage"("normalizedDish", "candidateIndex");
CREATE INDEX "MenuImage_normalizedDish_preferred_disliked_idx" ON "MenuImage"("normalizedDish", "preferred", "disliked");
CREATE INDEX "MenuImage_lastUsedAt_idx" ON "MenuImage"("lastUsedAt");

CREATE TABLE "MenuJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "generationId" TEXT,
  "dishId" TEXT,
  "stage" INTEGER NOT NULL DEFAULT 0,
  "stateJson" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "notBefore" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "error" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "MenuJob_status_notBefore_priority_idx" ON "MenuJob"("status", "notBefore", "priority");
CREATE INDEX "MenuJob_generationId_idx" ON "MenuJob"("generationId");
CREATE INDEX "MenuJob_dishId_idx" ON "MenuJob"("dishId");
