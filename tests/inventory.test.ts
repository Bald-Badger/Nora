import { beforeEach, afterAll, describe, it, expect } from "vitest";
import { db, expired } from "../src/lib/db";
import { applyResult, revision } from "../src/lib/inventory";
import { itemSchema } from "../src/lib/schema";
import { hashPassword, verifyPassword } from "../src/lib/auth";
const item = {
  name: "Milk",
  brand: "Costco",
  quantity: 3,
  unit: "cartons",
  category: "Dairy",
  location: "Fridge",
  notes: "",
  storage: "",
  leftover: false,
  status: "available",
  expiration: "2027-01-01",
  dateSource: "user",
  datePrecision: "exact",
  dateKind: "quality",
  confidence: 1,
};
async function proposal(actions: unknown[], baseRevision?: number) {
  return db.processing.create({
    data: {
      requestId: crypto.randomUUID(),
      original: "test",
      model: "test",
      promptVersion: "test",
      status: "pending",
      baseRevision: baseRevision ?? (await revision()),
      result: JSON.stringify({ reply: "", assumptions: [], actions }),
    },
  });
}
beforeEach(async () => {
  await db.event.deleteMany();
  await db.upload.deleteMany();
  await db.processing.deleteMany();
  await db.item.deleteMany();
  await db.location.deleteMany();
  await db.message.deleteMany();
  await db.setting.deleteMany();
});
afterAll(() => db.$disconnect());
describe("inventory authority", () => {
  it("adds, merges matching batches, and separates expiration dates", async () => {
    for (const expiration of ["2027-01-01", "2027-01-01", "2027-02-01"])
      await applyResult(
        (await proposal([{ operation: "add", item: { ...item, expiration } }]))
          .id,
      );
    expect(await db.item.count()).toBe(2);
    expect(
      (await db.item.findFirst({ where: { expiration: "2027-01-01" } }))
        ?.quantity,
    ).toBe(6);
    expect(await db.event.count()).toBe(3);
  });
  it("rolls back the whole transaction on an invalid item reference", async () => {
    const p = await proposal([
      { operation: "add", item },
      { operation: "update", id: "missing", item },
    ]);
    await expect(applyResult(p.id)).rejects.toThrow();
    expect(await db.item.count()).toBe(0);
    expect(await db.event.count()).toBe(0);
  });
  it("rejects stale and repeated proposals", async () => {
    const a = await proposal([{ operation: "add", item }]);
    const b = await proposal([{ operation: "add", item }]);
    await applyResult(a.id);
    await expect(applyResult(b.id)).rejects.toThrow("Inventory changed");
    await expect(applyResult(a.id)).rejects.toThrow("no longer pending");
  });
  it("undoes atomically without deleting the audit trail", async () => {
    await applyResult((await proposal([{ operation: "add", item }])).id);
    await applyResult((await proposal([{ operation: "undo" }])).id);
    expect(await db.item.count()).toBe(0);
    expect(await db.event.count()).toBe(2);
  });
  it("blocks expired status removal without date correction", async () => {
    await applyResult(
      (
        await proposal([
          { operation: "add", item: { ...item, status: "expired" } },
        ])
      ).id,
    );
    const saved = await db.item.findFirstOrThrow();
    await expect(
      applyResult(
        (await proposal([{ operation: "update", id: saved.id, item }])).id,
      ),
    ).rejects.toThrow("expiration correction");
  });
});
it("validates actual calendar dates and rejects unrecognized fields", () => {
  expect(
    itemSchema.safeParse({ ...item, expiration: "2026-02-30" }).success,
  ).toBe(false);
  expect(
    itemSchema.safeParse({ ...item, sql: "DROP TABLE Item" }).success,
  ).toBe(false);
});
it("filters expired items and respects exact boundary", () => {
  expect(
    expired({ expiration: "2026-09-15", status: "available" }, "2026-09-16"),
  ).toBe(true);
  expect(
    expired({ expiration: "2026-09-16", status: "available" }, "2026-09-16"),
  ).toBe(false);
});
it("hashes passwords with individual salts", () => {
  const hash = hashPassword("a sufficiently long password");
  expect(verifyPassword("a sufficiently long password", hash)).toBe(true);
  expect(verifyPassword("wrong", hash)).toBe(false);
  expect(hashPassword("a sufficiently long password")).not.toBe(hash);
});
