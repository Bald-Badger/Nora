import { randomUUID } from "node:crypto";
import { db, today } from "../src/lib/db";
import { applyResult, revision } from "../src/lib/inventory";

if (process.env.ALLOW_REPLACE_INVENTORY !== "1") {
  throw new Error("Set ALLOW_REPLACE_INVENTORY=1 to replace active inventory.");
}

const baseDate = today();
const addDays = (amount: number) => {
  const date = new Date(`${baseDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
};

type Fixture = {
  name: string;
  quantity: number;
  unit: string;
  category: string;
  location: "Fridge" | "Freezer" | "Shelf";
  days: number;
};

const fixtures: Fixture[] = [
  { name: "Eggs", quantity: 12, unit: "pieces", category: "Dairy & Eggs", location: "Fridge", days: 24 },
  { name: "Whole milk", quantity: 1, unit: "gallon", category: "Dairy & Eggs", location: "Fridge", days: 14 },
  { name: "Greek yogurt", quantity: 4, unit: "cups", category: "Dairy & Eggs", location: "Fridge", days: 24 },
  { name: "Butter", quantity: 2, unit: "sticks", category: "Dairy & Eggs", location: "Fridge", days: 75 },
  { name: "Cheddar cheese", quantity: 1, unit: "block", category: "Dairy & Eggs", location: "Fridge", days: 40 },
  { name: "Chicken thighs", quantity: 2, unit: "lb", category: "Meat", location: "Fridge", days: 5 },
  { name: "Bok choy", quantity: 2, unit: "heads", category: "Vegetables", location: "Fridge", days: 8 },
  { name: "Spinach", quantity: 1, unit: "bag", category: "Vegetables", location: "Fridge", days: 7 },
  { name: "Carrots", quantity: 2, unit: "lb", category: "Vegetables", location: "Fridge", days: 28 },
  { name: "Tomatoes", quantity: 6, unit: "pieces", category: "Vegetables", location: "Fridge", days: 12 },
  { name: "Green onions", quantity: 2, unit: "bunches", category: "Vegetables", location: "Fridge", days: 9 },
  { name: "Mushrooms", quantity: 1, unit: "box", category: "Vegetables", location: "Fridge", days: 10 },
  { name: "Firm tofu", quantity: 2, unit: "packs", category: "Protein", location: "Fridge", days: 21 },
  { name: "Ginger", quantity: 1, unit: "piece", category: "Aromatics", location: "Fridge", days: 35 },
  { name: "Salmon fillets", quantity: 4, unit: "pieces", category: "Seafood", location: "Freezer", days: 210 },
  { name: "Ground beef", quantity: 2, unit: "lb", category: "Meat", location: "Freezer", days: 210 },
  { name: "Frozen dumplings", quantity: 2, unit: "bags", category: "Frozen", location: "Freezer", days: 300 },
  { name: "Frozen peas", quantity: 1, unit: "bag", category: "Frozen", location: "Freezer", days: 270 },
  { name: "Chicken breasts", quantity: 4, unit: "pieces", category: "Meat", location: "Freezer", days: 210 },
  { name: "Jasmine rice", quantity: 10, unit: "lb", category: "Grains", location: "Shelf", days: 540 },
  { name: "Wheat noodles", quantity: 4, unit: "packs", category: "Grains", location: "Shelf", days: 365 },
  { name: "Pasta", quantity: 2, unit: "boxes", category: "Grains", location: "Shelf", days: 540 },
  { name: "Canned tomatoes", quantity: 4, unit: "cans", category: "Canned Goods", location: "Shelf", days: 720 },
  { name: "Black beans", quantity: 4, unit: "cans", category: "Canned Goods", location: "Shelf", days: 720 },
  { name: "Yellow onions", quantity: 6, unit: "pieces", category: "Vegetables", location: "Shelf", days: 50 },
  { name: "Potatoes", quantity: 8, unit: "pieces", category: "Vegetables", location: "Shelf", days: 45 },
  { name: "Garlic", quantity: 3, unit: "bulbs", category: "Aromatics", location: "Shelf", days: 75 },
  { name: "Soy sauce", quantity: 1, unit: "bottle", category: "Condiments", location: "Shelf", days: 540 },
  { name: "Rice vinegar", quantity: 1, unit: "bottle", category: "Condiments", location: "Shelf", days: 540 },
  { name: "Cooking oil", quantity: 1, unit: "bottle", category: "Condiments", location: "Shelf", days: 365 },
  { name: "All-purpose flour", quantity: 5, unit: "lb", category: "Baking", location: "Shelf", days: 240 },
];

async function apply(actions: unknown[], label: string) {
  const processing = await db.processing.create({
    data: {
      requestId: randomUUID(),
      original: label,
      promptVersion: "menu-fixture-seed-v1",
      model: "local",
      baseRevision: await revision(),
      status: "pending",
      result: JSON.stringify({ reply: "", assumptions: [], actions }),
    },
  });
  await applyResult(processing.id);
}

try {
  const active = await db.item.findMany({
    where: { status: { notIn: ["consumed", "discarded", "empty"] } },
    include: { location: true },
  });
  for (let offset = 0; offset < active.length; offset += 40) {
    const actions = active.slice(offset, offset + 40).map((item) => ({
      operation: "update",
      id: item.id,
      item: {
        name: item.name,
        brand: item.brand,
        quantity: 0,
        unit: item.unit,
        category: item.category,
        location: item.location.name,
        notes: item.notes,
        storage: item.storage,
        leftover: item.leftover,
        status: "discarded",
        expiration: item.expiration,
        dateSource: item.dateSource,
        datePrecision: item.datePrecision,
        dateKind: item.dateKind,
        confidence: item.confidence,
      },
    }));
    await apply(actions, "Replace active inventory with menu test fixtures");
  }

  const actions = fixtures.map((item) => ({
    operation: "add",
    item: {
      name: item.name,
      brand: "",
      quantity: item.quantity,
      unit: item.unit,
      category: item.category,
      location: item.location,
      notes: "Menu discovery test fixture.",
      storage: "",
      leftover: false,
      status: "available",
      expiration: addDays(item.days),
      dateSource: "user",
      datePrecision: "exact",
      dateKind: "quality",
      confidence: 1,
    },
  }));
  await apply(actions, "Add common ingredients for menu discovery testing");
  console.log(`Discarded ${active.length} active items and added ${fixtures.length} test fixtures.`);
} finally {
  await db.$disconnect();
}
