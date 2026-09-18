import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import { consumeMenuDish, menuState } from "../src/lib/menu";
import { menuIngredientSchema } from "../src/lib/menu-schema";

async function fixture(quantity = 4) {
  const location = await db.location.upsert({ where: { name: "Fridge" }, create: { name: "Fridge" }, update: {} });
  const item = await db.item.create({ data: { name: "Eggs", normalizedName: "eggs", quantity, unit: "eggs", category: "Protein", locationId: location.id, expiration: "2099-01-01", dateSource: "user", datePrecision: "exact", confidence: 1, source: "chat" } });
  const generation = await db.menuGeneration.create({ data: { source: "manual", inventoryRevision: 0 } });
  const ingredients = [{ itemId: item.id, nameZh: "鸡蛋", nameEn: "Eggs", amountValue: 2, amountUnitZh: "个", amountUnitEn: "eggs", inventoryQuantity: 2 }];
  const dish = await db.menuDish.create({ data: { generationId: generation.id, position: 0, nameZh: "煎蛋", nameEn: "Fried eggs", prepMinutes: 2, cookMinutes: 4, imageSearchQuery: "fried eggs", ingredientsJson: JSON.stringify(ingredients), stepsZhJson: JSON.stringify(["打散 2 个鸡蛋，用时 1 分钟。", "中火煎 3 分钟至凝固。"]), stepsEnJson: JSON.stringify(["Beat 2 eggs for 1 minute.", "Cook over medium heat for 3 minutes."]), requiredItemIdsJson: JSON.stringify([item.id]) } });
  return { item, dish };
}

beforeEach(async () => {
  await db.event.deleteMany();
  await db.upload.deleteMany();
  await db.processing.deleteMany();
  await db.menuJob.deleteMany();
  await db.menuDish.deleteMany();
  await db.menuGeneration.deleteMany();
  await db.item.deleteMany();
  await db.location.deleteMany();
  await db.message.deleteMany();
  await db.setting.deleteMany();
});
afterAll(() => db.$disconnect());

describe("menu recipes", () => {
  it("requires structured cooking and inventory quantities", () => {
    expect(menuIngredientSchema.safeParse({ itemId: "egg", nameZh: "鸡蛋", nameEn: "Egg", amountValue: 2, amountUnitZh: "个", amountUnitEn: "eggs", inventoryQuantity: 2 }).success).toBe(true);
    expect(menuIngredientSchema.safeParse({ itemId: "egg", nameZh: "鸡蛋", nameEn: "Egg", amountValue: 2, amountUnitZh: "个", amountUnitEn: "eggs" }).success).toBe(false);
  });

  it("deducts scaled servings through the audited inventory transaction", async () => {
    const { item, dish } = await fixture(4);
    await consumeMenuDish(dish.id, 3);
    expect((await db.item.findUniqueOrThrow({ where: { id: item.id } })).quantity).toBe(1);
    expect(await db.event.count({ where: { itemId: item.id } })).toBe(1);
    expect((await db.processing.findFirstOrThrow()).promptVersion).toBe("menu-cook-v1");
    expect((await db.setting.findUniqueOrThrow({ where: { key: "revision" } })).value).toBe("1");
  });

  it("does not deduct anything when the selected servings exceed inventory", async () => {
    const { item, dish } = await fixture(2);
    await expect(consumeMenuDish(dish.id, 3)).rejects.toThrow("MENU_INGREDIENT_UNAVAILABLE");
    expect((await db.item.findUniqueOrThrow({ where: { id: item.id } })).quantity).toBe(2);
    expect(await db.event.count()).toBe(0);
  });

  it("hides recipes generated before scalable quantities were introduced", async () => {
    const { dish } = await fixture(4);
    await db.menuDish.update({ where: { id: dish.id }, data: { ingredientsJson: JSON.stringify([{ itemId: "old", nameZh: "鸡蛋", nameEn: "Eggs", amount: "2 eggs" }]) } });
    expect((await menuState()).dishes).toEqual([]);
  });
});
