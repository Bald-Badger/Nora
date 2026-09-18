import { readFile, mkdir, unlink, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { db, expired, today } from "./db";
import { applyResult, revision } from "./inventory";
import { searchBraveImages, BraveMonthlyLimitError } from "./brave";
import { completeStructured } from "../ai/provider";
import { imageChoiceSchema, menuBatchSchema, menuIngredientSchema, type MenuDishProposal } from "./menu-schema";

const promptPath = process.env.PROMPT_DIR || "/app/src/ai/prompts";
const imageRoot = process.env.MENU_IMAGE_DIR || "/app/data/menu-images";
const cacheLimit = 512 * 1024 * 1024;
const activeStatuses = ["available", "low"];

function normalizeDish(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

export async function activeInventory() {
  const items = await db.item.findMany({ include: { location: true } });
  return items.filter(
    (item) => activeStatuses.includes(item.status) && item.quantity > 0 && !expired(item),
  );
}

export async function createMenuGeneration(source: "manual" | "routine" = "manual") {
  const inventory = await activeInventory();
  if (!inventory.length) throw new Error("MENU_INVENTORY_EMPTY");
  const generation = await db.menuGeneration.create({
    data: { source, inventoryRevision: await revision() },
  });
  const spacing = source === "manual" ? 0 : 120_000;
  await db.menuJob.createMany({
    data: [0, 1, 2].map((batch) => ({
      type: "recipes",
      priority: source === "manual" ? 100 : 10,
      generationId: generation.id,
      stateJson: JSON.stringify({ batch }),
      notBefore: new Date(Date.now() + batch * spacing),
    })),
  });
  return generation;
}

async function generateRecipes(job: { id: string; generationId: string | null; stateJson: string | null; priority: number }) {
  if (!job.generationId) throw new Error("MENU_JOB_GENERATION_MISSING");
  const inventory = await activeInventory();
  const allowedIds = new Set(inventory.map((item) => item.id));
  const existing = await db.menuDish.findMany({ where: { generationId: job.generationId } });
  const prompt = await readFile(path.join(promptPath, "menu.md"), "utf8");
  const raw = await completeStructured(
    `${prompt}\nReturn JSON matching this shape exactly: {"dishes":[{"nameZh":"","nameEn":"","prepMinutes":1,"cookMinutes":1,"imageSearchQuery":"","ingredients":[{"itemId":"","nameZh":"","nameEn":"","amountValue":100,"amountUnitZh":"克","amountUnitEn":"g","inventoryQuantity":0.5}],"stepsZh":["",""],"stepsEn":["",""]}]}`,
    [{ type: "text", text: JSON.stringify({
      date: today(),
      servings: 2,
      inventory: inventory.map((item) => ({ id: item.id, name: item.name, quantity: item.quantity, unit: item.unit, category: item.category, location: item.location.name, expiration: item.expiration })),
      recentDishNames: existing.flatMap((dish) => [dish.nameZh, dish.nameEn]),
    }) }],
    7000,
  );
  const parsed = menuBatchSchema.parse(raw);
  if (parsed.dishes.some((dish) => dish.ingredients.some((ingredient) => !allowedIds.has(ingredient.itemId))))
    throw new Error("MENU_AI_UNKNOWN_INGREDIENT");
  if (parsed.dishes.some((dish) => dish.ingredients.some((ingredient) => {
    const item = inventory.find((candidate) => candidate.id === ingredient.itemId)!;
    return ingredient.inventoryQuantity > item.quantity;
  }))) throw new Error("MENU_AI_EXCESS_INVENTORY");
  const batch = JSON.parse(job.stateJson || "{}").batch || 0;
  await db.$transaction(async (tx) => {
    for (const [index, dish] of parsed.dishes.entries()) {
      const useSoon = dish.ingredients.some((ingredient) => {
        const item = inventory.find((candidate) => candidate.id === ingredient.itemId)!;
        const remaining = Math.ceil((new Date(`${item.expiration}T12:00:00Z`).getTime() - Date.now()) / 86400000);
        return remaining >= 0 && remaining <= 3;
      });
      const created = await tx.menuDish.create({ data: dishData(job.generationId!, batch * 6 + index, dish, useSoon) });
      await tx.menuJob.create({ data: { type: "image", priority: job.priority > 50 ? 90 : 10, generationId: job.generationId, dishId: created.id, notBefore: new Date(Date.now() + (job.priority > 50 ? index * 1000 : (batch * 6 + index) * 120_000)) } });
    }
  });
}

function dishData(generationId: string, position: number, dish: MenuDishProposal, useSoon: boolean) {
  return {
    generationId, position, nameZh: dish.nameZh, nameEn: dish.nameEn,
    prepMinutes: dish.prepMinutes, cookMinutes: dish.cookMinutes,
    imageSearchQuery: dish.imageSearchQuery,
    ingredientsJson: JSON.stringify(dish.ingredients), stepsZhJson: JSON.stringify(dish.stepsZh),
    stepsEnJson: JSON.stringify(dish.stepsEn),
    requiredItemIdsJson: JSON.stringify([...new Set(dish.ingredients.map((item) => item.itemId))]), useSoon,
  };
}

async function safeDownload(url: string, filename: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "imgs.search.brave.com") throw new Error("MENU_IMAGE_HOST_REJECTED");
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: "error" });
  if (!response.ok) throw new Error(`MENU_IMAGE_HTTP_${response.status}`);
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > 2 * 1024 * 1024) throw new Error("MENU_IMAGE_TOO_LARGE");
  const source = Buffer.from(await response.arrayBuffer());
  if (source.byteLength > 2 * 1024 * 1024) throw new Error("MENU_IMAGE_TOO_LARGE");
  const output = await sharp(source).rotate().resize(1200, 900, { fit: "cover" }).jpeg({ quality: 82 }).toBuffer();
  await mkdir(imageRoot, { recursive: true });
  const destination = path.join(/* turbopackIgnore: true */ imageRoot, filename);
  await writeFile(destination, output, { mode: 0o600 });
  return { destination, size: output.byteLength };
}

async function imagePart(filePath: string) {
  return { type: "image_url", image_url: { url: `data:image/jpeg;base64,${(await readFile(filePath)).toString("base64")}` } };
}

async function chooseThree(candidates: Array<{ path: string; title: string }>, dish: string) {
  if (candidates.length === 1) return 0;
  const content: unknown[] = [{ type: "text", text: `Choose the most accurate, appetizing, well-lit finished-dish photo for ${dish}. Candidate numbers follow. Avoid text-heavy, collage, raw ingredient, and unrelated images.` }];
  for (const [index, candidate] of candidates.entries()) {
    content.push({ type: "text", text: `Candidate ${index + 1}: ${candidate.title}` }, await imagePart(candidate.path));
  }
  const result = imageChoiceSchema.parse(await completeStructured("You are a food photography selector. Return only JSON with index (1-3) and a brief reason.", content, 300));
  return Math.min(result.index - 1, candidates.length - 1);
}

async function processImage(job: { dishId: string | null }) {
  if (!job.dishId) throw new Error("MENU_JOB_DISH_MISSING");
  const dish = await db.menuDish.findUniqueOrThrow({ where: { id: job.dishId } });
  const normalized = normalizeDish(dish.nameZh);
  let images = await db.menuImage.findMany({ where: { normalizedDish: normalized, disliked: false }, orderBy: { candidateIndex: "asc" } });
  if (!images.length) {
    try {
      const results = await searchBraveImages(dish.imageSearchQuery, 9);
      for (const [index, result] of results.entries()) {
        try {
          const downloaded = await safeDownload(result.thumbnailUrl, `${dish.id}-${index}.jpg`);
          await db.menuImage.create({ data: { normalizedDish: normalized, candidateIndex: index, title: result.title, pageUrl: result.pageUrl, imageUrl: result.imageUrl, source: result.source, path: downloaded.destination, mime: "image/jpeg", size: downloaded.size } });
        } catch { /* Skip malformed third-party images. */ }
      }
      images = await db.menuImage.findMany({ where: { normalizedDish: normalized, disliked: false }, orderBy: { candidateIndex: "asc" } });
    } catch (error) {
      if (!(error instanceof BraveMonthlyLimitError)) throw error;
    }
  }
  if (!images.length) {
    await db.menuDish.update({ where: { id: dish.id }, data: { imageStatus: "placeholder" } });
    return;
  }
  const preferred = images.find((image) => image.preferred);
  let winner = preferred || images[0];
  if (!preferred && images.length > 1) {
    const preliminary = [];
    for (let i = 0; i < images.length; i += 3) {
      const group = images.slice(i, i + 3);
      preliminary.push(group[await chooseThree(group, dish.nameZh)]);
    }
    winner = preliminary[await chooseThree(preliminary.slice(0, 3), dish.nameZh)];
  }
  await db.$transaction([
    db.menuImage.updateMany({ where: { normalizedDish: normalized }, data: { selected: false } }),
    db.menuImage.update({ where: { id: winner.id }, data: { selected: true, lastUsedAt: new Date() } }),
    db.menuDish.update({ where: { id: dish.id }, data: { imageId: winner.id, imageStatus: "ready" } }),
  ]);
  await enforceImageCache();
}

export async function enforceImageCache() {
  let images = await db.menuImage.findMany({ orderBy: { lastUsedAt: "asc" } });
  let total = images.reduce((sum, image) => sum + image.size, 0);
  for (const image of images) {
    if (total <= cacheLimit) break;
    await unlink(image.path).catch(() => undefined);
    await db.$transaction([
      db.menuDish.updateMany({ where: { imageId: image.id }, data: { imageId: null, imageStatus: "placeholder" } }),
      db.menuImage.delete({ where: { id: image.id } }),
    ]);
    total -= image.size;
  }
}

export async function runNextMenuJob() {
  const job = await db.menuJob.findFirst({ where: { status: "queued", notBefore: { lte: new Date() } }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }] });
  if (!job) return false;
  const claimed = await db.menuJob.updateMany({ where: { id: job.id, status: "queued" }, data: { status: "running", attempts: { increment: 1 } } });
  if (!claimed.count) return true;
  try {
    if (job.type === "recipes") await generateRecipes(job);
    else if (job.type === "image") await processImage(job);
    await db.menuJob.update({ where: { id: job.id }, data: { status: "complete", error: null } });
  } catch (error) {
    const attempts = job.attempts + 1;
    await db.menuJob.update({ where: { id: job.id }, data: { status: attempts < 3 ? "queued" : "failed", notBefore: new Date(Date.now() + attempts * 60_000), error: String(error).slice(0, 1000) } });
  }
  return true;
}

export async function scheduleRoutineMenu(now = new Date()) {
  const zone = process.env.HOUSEHOLD_TIMEZONE || "America/Phoenix";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  const localDate = `${value("year")}-${value("month")}-${value("day")}`;
  const hour = Number(value("hour"));
  const targetHour = 2 + (createHash("sha256").update(`nora-menu-${localDate}`).digest()[0] % 4);
  const marker = await db.setting.findUnique({ where: { key: "menu-routine-checked-date" } });
  if (marker?.value === localDate || hour < targetHour) return false;
  const previousRevision = Number((await db.setting.findUnique({ where: { key: "menu-routine-revision" } }))?.value || 0);
  const currentRevision = await revision();
  if (!marker) {
    await db.$transaction([
      db.setting.upsert({ where: { key: "menu-routine-checked-date" }, create: { key: "menu-routine-checked-date", value: localDate }, update: { value: localDate } }),
      db.setting.upsert({ where: { key: "menu-routine-revision" }, create: { key: "menu-routine-revision", value: String(currentRevision) }, update: { value: String(currentRevision) } }),
    ]);
    return true;
  }
  if (currentRevision > previousRevision) {
    const recentEvents = await db.event.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
    const meaningful = recentEvents.some((event) => {
      const after = event.after ? JSON.parse(event.after) as { category?: string; quantity?: number; status?: string } : null;
      const before = event.before ? JSON.parse(event.before) as { category?: string; quantity?: number; status?: string } : null;
      const category = (after?.category || before?.category || "").toLowerCase();
      if (category.includes("fruit")) return false;
      if (!before || !after) return true;
      if (after.status !== before.status) return true;
      const base = Math.max(Math.abs(before.quantity || 0), 1);
      return Math.abs((after.quantity || 0) - (before.quantity || 0)) / base >= 0.25;
    });
    if (meaningful) await createMenuGeneration("routine");
  }
  await db.$transaction([
    db.setting.upsert({ where: { key: "menu-routine-checked-date" }, create: { key: "menu-routine-checked-date", value: localDate }, update: { value: localDate } }),
    db.setting.upsert({ where: { key: "menu-routine-revision" }, create: { key: "menu-routine-revision", value: String(currentRevision) }, update: { value: String(currentRevision) } }),
  ]);
  return true;
}

export async function menuState(offset = 0, limit = 6) {
  const generation = await db.menuGeneration.findFirst({ where: { status: "active" }, orderBy: { createdAt: "desc" } });
  if (!generation) return { dishes: [], total: 0, generating: false };
  const inventoryIds = new Set((await activeInventory()).map((item) => item.id));
  const all = await db.menuDish.findMany({ where: { generationId: generation.id }, orderBy: { position: "asc" } });
  const valid = all.filter((dish) =>
    (JSON.parse(dish.requiredItemIdsJson) as string[]).every((id) => inventoryIds.has(id)) &&
    menuIngredientSchema.array().safeParse(JSON.parse(dish.ingredientsJson)).success,
  );
  const jobs = await db.menuJob.count({ where: { generationId: generation.id, status: { in: ["queued", "running"] } } });
  const page = valid.slice(offset, offset + limit);
  const imageIds = page.flatMap((dish) => dish.imageId ? [dish.imageId] : []);
  const images = await db.menuImage.findMany({ where: { id: { in: imageIds } } });
  const imageById = new Map(images.map((image) => [image.id, image]));
  return { generationId: generation.id, dishes: page.map((dish) => serializeDish(dish, dish.imageId ? imageById.get(dish.imageId) : undefined)), total: valid.length, generating: jobs > 0 };
}

function serializeDish(dish: Awaited<ReturnType<typeof db.menuDish.findFirstOrThrow>>, image?: { source: string; pageUrl: string }) {
  return { id: dish.id, nameZh: dish.nameZh, nameEn: dish.nameEn, prepMinutes: dish.prepMinutes, cookMinutes: dish.cookMinutes, ingredients: JSON.parse(dish.ingredientsJson), stepsZh: JSON.parse(dish.stepsZhJson), stepsEn: JSON.parse(dish.stepsEnJson), useSoon: dish.useSoon, imageId: dish.imageId, imageStatus: dish.imageStatus, imageSource: image?.source || null, imagePageUrl: image?.pageUrl || null };
}

export async function consumeMenuDish(dishId: string, servings: number) {
  if (!Number.isInteger(servings) || servings < 1 || servings > 12) throw new Error("MENU_SERVINGS_INVALID");
  const dish = await db.menuDish.findUniqueOrThrow({ where: { id: dishId } });
  const ingredients = menuIngredientSchema.array().parse(JSON.parse(dish.ingredientsJson));
  const ratio = servings / 2;
  const requested = new Map<string, number>();
  for (const ingredient of ingredients) requested.set(ingredient.itemId, (requested.get(ingredient.itemId) || 0) + ingredient.inventoryQuantity * ratio);
  const items = await db.item.findMany({ where: { id: { in: [...requested.keys()] } }, include: { location: true } });
  if (items.length !== requested.size) throw new Error("MENU_INGREDIENT_UNAVAILABLE");
  const actions = items.map((item) => {
    const used = requested.get(item.id)!;
    if (!activeStatuses.includes(item.status) || expired(item) || item.quantity + 1e-9 < used) throw new Error("MENU_INGREDIENT_UNAVAILABLE");
    const quantity = Math.max(0, Number((item.quantity - used).toFixed(6)));
    return { operation: "update" as const, id: item.id, item: { name: item.name, brand: item.brand, quantity, unit: item.unit, category: item.category, location: item.location.name as "Fridge" | "Freezer" | "Shelf", notes: item.notes, storage: item.storage, leftover: item.leftover, status: quantity === 0 ? "empty" as const : item.status as "available" | "low", expiration: item.expiration, dateSource: item.dateSource as "user" | "image" | "ai", datePrecision: item.datePrecision as "exact" | "approximate" | "unknown", dateKind: item.dateKind as "quality" | "safety", confidence: item.confidence } };
  });
  const processing = await db.processing.create({ data: { requestId: randomUUID(), original: `Cook ${dish.nameEn} for ${servings}`, promptVersion: "menu-cook-v1", model: "local", baseRevision: await revision(), status: "pending", result: JSON.stringify({ reply: "", assumptions: [], actions }) } });
  return applyResult(processing.id);
}

export async function setImagePreference(dishId: string, preference: "like" | "dislike") {
  const dish = await db.menuDish.findUniqueOrThrow({ where: { id: dishId } });
  if (!dish.imageId) throw new Error("MENU_IMAGE_MISSING");
  const current = await db.menuImage.findUniqueOrThrow({ where: { id: dish.imageId } });
  if (preference === "like") {
    await db.$transaction([
      db.menuImage.updateMany({ where: { normalizedDish: current.normalizedDish }, data: { preferred: false } }),
      db.menuImage.update({ where: { id: current.id }, data: { preferred: true, disliked: false, lastUsedAt: new Date() } }),
    ]);
    return { imageId: current.id, lastImage: false };
  }
  await db.menuImage.update({ where: { id: current.id }, data: { preferred: false, selected: false, disliked: true } });
  const next = await db.menuImage.findFirst({ where: { normalizedDish: current.normalizedDish, disliked: false }, orderBy: [{ preferred: "desc" }, { candidateIndex: "asc" }] });
  await db.menuDish.update({ where: { id: dish.id }, data: { imageId: next?.id || null, imageStatus: next ? "ready" : "placeholder" } });
  if (next) await db.menuImage.update({ where: { id: next.id }, data: { selected: true, lastUsedAt: new Date() } });
  return { imageId: next?.id || null, lastImage: !next };
}
