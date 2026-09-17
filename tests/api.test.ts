import { beforeEach, afterAll, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "../src/lib/db";
import { digest, hashPassword } from "../src/lib/auth";
import sharp from "sharp";
import { mkdtemp, rm } from "node:fs/promises";
const ai = vi.hoisted(() => ({
  classify: vi.fn(),
  interpret: vi.fn(),
  available: vi.fn(),
}));
const barcode = vi.hoisted(() => ({
  decode: vi.fn(),
  lookup: vi.fn(),
}));
vi.mock("../src/ai/provider", () => ({
  ...ai,
  model: () => "test-model",
  promptVersion: "test-prompts",
  providerAvailable: ai.available,
}));
vi.mock("../src/lib/barcode", () => ({
  decodeRetailBarcode: barcode.decode,
  lookupFoodProduct: barcode.lookup,
}));
import { GET, POST } from "../src/app/api/[...path]/route";
const origin = "https://nora.shuainium.com";
function request(path: string, body?: BodyInit, authenticated = true) {
  return new NextRequest(`${origin}/api/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      origin,
      ...(authenticated ? { cookie: "__Host-nora=test-session" } : {}),
    },
    body,
  });
}
beforeEach(async () => {
  await db.event.deleteMany();
  await db.upload.deleteMany();
  await db.processing.deleteMany();
  await db.item.deleteMany();
  await db.message.deleteMany();
  await db.setting.deleteMany();
  await db.session.deleteMany();
  await db.loginAttempt.deleteMany();
  await db.session.create({ data: { id: digest("test-session") } });
  ai.classify.mockReset();
  ai.interpret.mockReset();
  ai.available.mockReset();
  barcode.decode.mockReset();
  barcode.lookup.mockReset();
});
afterAll(() => db.$disconnect());
it("requires authentication and blocks cross-site edits", async () => {
  expect((await GET(request("state", undefined, false))).status).toBe(401);
  expect(
    (
      await POST(
        new NextRequest(`${origin}/api/undo`, {
          method: "POST",
          headers: { origin: "https://other.example" },
        }),
      )
    ).status,
  ).toBe(403);
});
it("sets secure session cookies and throttles incorrect passwords", async () => {
  await db.setting.create({
    data: { key: "password", value: hashPassword("a long fixture password") },
  });
  const good = await POST(
    request(
      "login",
      JSON.stringify({ password: "a long fixture password" }),
      false,
    ),
  );
  expect(good.status).toBe(200);
  expect(good.headers.get("set-cookie")).toContain("Secure");
  expect(good.headers.get("set-cookie")).toContain("HttpOnly");
  for (let i = 0; i < 5; i++)
    expect(
      (
        await POST(
          request("login", JSON.stringify({ password: "wrong" }), false),
        )
      ).status,
    ).toBe(401);
  expect(
    (await POST(request("login", JSON.stringify({ password: "wrong" }), false)))
      .status,
  ).toBe(429);
});
it("does not mutate inventory when the AI service fails", async () => {
  ai.classify.mockRejectedValue(new Error("provider failed"));
  const form = new FormData();
  form.set("requestId", crypto.randomUUID());
  form.set("message", "Add some milk");
  expect((await POST(request("chat", form))).status).toBe(503);
  expect(await db.item.count()).toBe(0);
  expect(await db.event.count()).toBe(0);
});
it("requires confirmation for photo writes and keeps upload/event links", async () => {
  const folder = await mkdtemp("/tmp/nora-photo-test-");
  process.env.UPLOAD_DIR = folder;
  try {
    const pixels = await sharp({
      create: { width: 40, height: 40, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.set("requestId", crypto.randomUUID());
    form.set("image", new File([pixels], "photo.png", { type: "image/png" }));
    ai.interpret.mockResolvedValue({
      reply: "Milk found.",
      assumptions: ["Size estimated."],
      actions: [
        {
          operation: "add",
          item: {
            name: "Milk",
            brand: "",
            quantity: 1,
            unit: "carton",
            category: "Dairy",
            location: "Fridge",
            notes: "",
            storage: "",
            leftover: false,
            status: "available",
            expiration: "2027-01-01",
            dateSource: "ai",
            datePrecision: "approximate",
            dateKind: "quality",
            confidence: 0.8,
          },
        },
      ],
    });
    expect((await POST(request("chat", form))).status).toBe(200);
    expect(await db.item.count()).toBe(0);
    const pending = await db.processing.findFirstOrThrow({
      where: { status: "pending" },
    });
    expect(
      (await POST(request("confirm", JSON.stringify({ id: pending.id }))))
        .status,
    ).toBe(200);
    expect(await db.item.count()).toBe(1);
    expect((await db.upload.findFirstOrThrow()).processingId).toBe(pending.id);
    expect((await db.event.findFirstOrThrow()).processingId).toBe(pending.id);
    expect(
      (await POST(request("confirm", JSON.stringify({ id: pending.id }))))
        .status,
    ).toBe(409);
  } finally {
    delete process.env.UPLOAD_DIR;
    await rm(folder, { recursive: true, force: true });
  }
});
it("uses receipt instructions and confirmation for receipt photos", async () => {
  const folder = await mkdtemp("/tmp/nora-receipt-test-");
  process.env.UPLOAD_DIR = folder;
  try {
    const pixels = await sharp({
      create: { width: 40, height: 40, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.set("requestId", crypto.randomUUID());
    form.set("imageMode", "receipt");
    form.set("image", new File([pixels], "receipt.png", { type: "image/png" }));
    ai.interpret.mockResolvedValue({
      reply: "One refrigerated item found.",
      assumptions: [],
      actions: [],
    });
    expect((await POST(request("chat", form))).status).toBe(200);
    expect(ai.interpret.mock.calls[0][0]).toContain("purchased on this receipt");
    expect(ai.interpret.mock.calls[0][3]).toMatch(/^data:image\/jpeg;base64,/);
    expect((await db.upload.findFirstOrThrow()).deleted).toBe(false);
  } finally {
    delete process.env.UPLOAD_DIR;
    await rm(folder, { recursive: true, force: true });
  }
});
it("decodes barcode photos locally and creates a confirmation proposal", async () => {
  const folder = await mkdtemp("/tmp/nora-barcode-test-");
  process.env.UPLOAD_DIR = folder;
  try {
    const pixels = await sharp({
      create: { width: 40, height: 40, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    barcode.decode.mockResolvedValue("3017620422003");
    barcode.lookup.mockResolvedValue({
      barcode: "3017620422003",
      name: "Hazelnut spread",
      brand: "Fixture",
      packageQuantity: "400 g",
      categories: ["spreads"],
    });
    ai.interpret.mockResolvedValue({
      reply: "Product found.",
      assumptions: [],
      actions: [
        {
          operation: "add",
          item: {
            name: "Hazelnut spread",
            brand: "Fixture",
            quantity: 1,
            unit: "jar",
            category: "Condiments",
            location: "Fridge",
            notes: "",
            storage: "",
            leftover: false,
            status: "available",
            expiration: "2026-12-01",
            dateSource: "ai",
            datePrecision: "approximate",
            dateKind: "quality",
            confidence: 0.8,
          },
        },
      ],
    });
    const form = new FormData();
    form.set("requestId", crypto.randomUUID());
    form.set("imageMode", "barcode");
    form.set("image", new File([pixels], "barcode.png", { type: "image/png" }));
    expect((await POST(request("chat", form))).status).toBe(200);
    expect(barcode.decode).toHaveBeenCalledOnce();
    expect(barcode.lookup).toHaveBeenCalledWith("3017620422003");
    expect(ai.interpret.mock.calls[0][0]).toContain("Hazelnut spread");
    expect(ai.interpret.mock.calls[0][3]).toBeUndefined();
    expect(await db.item.count()).toBe(0);
    expect(await db.processing.count({ where: { status: "pending" } })).toBe(1);
  } finally {
    delete process.env.UPLOAD_DIR;
    await rm(folder, { recursive: true, force: true });
  }
});
it("passes no expired items or stale chat to recipe requests", async () => {
  const location = await db.location.upsert({
    where: { name: "Fridge" },
    create: { name: "Fridge" },
    update: {},
  });
  await db.item.create({
    data: {
      name: "Old milk",
      normalizedName: "old milk",
      quantity: 1,
      unit: "carton",
      category: "Dairy",
      locationId: location.id,
      expiration: "2000-01-01",
      dateSource: "user",
      datePrecision: "exact",
      confidence: 1,
      source: "chat",
    },
  });
  await db.message.create({
    data: { role: "assistant", content: "Old milk was available" },
  });
  ai.classify.mockResolvedValue({
    intent: "recommend",
    terms: [],
    expirationCorrection: false,
  });
  ai.interpret.mockResolvedValue({
    reply: "No usable items yet.",
    assumptions: [],
    actions: [],
  });
  const form = new FormData();
  form.set("requestId", crypto.randomUUID());
  form.set("message", "What dinner can I make?");
  expect((await POST(request("chat", form))).status).toBe(200);
  expect(ai.interpret.mock.calls[0][1].items).toEqual([]);
  expect(ai.interpret.mock.calls[0][1].recent).toEqual([]);
});
it("discards an item through the audit trail and allows undo", async () => {
  const location = await db.location.upsert({
    where: { name: "Fridge" },
    create: { name: "Fridge" },
    update: {},
  });
  const item = await db.item.create({
    data: {
      name: "Dragon fruit",
      normalizedName: "dragon fruit",
      quantity: 1,
      unit: "piece",
      category: "Fruit",
      locationId: location.id,
      expiration: "2026-09-30",
      dateSource: "ai",
      datePrecision: "approximate",
      confidence: 0.75,
      source: "chat",
    },
  });
  expect(
    (await POST(request("discard", JSON.stringify({ id: item.id })))).status,
  ).toBe(200);
  expect(
    await db.item.findUniqueOrThrow({ where: { id: item.id } }),
  ).toMatchObject({ quantity: 0, status: "discarded" });
  expect(await db.event.count({ where: { itemId: item.id } })).toBe(1);
  expect((await POST(request("undo", JSON.stringify({})))).status).toBe(200);
  expect(
    await db.item.findUniqueOrThrow({ where: { id: item.id } }),
  ).toMatchObject({ quantity: 1, status: "available" });
});

it("adjusts quantity through the audit trail and marks zero empty", async () => {
  const location = await db.location.upsert({
    where: { name: "Fridge" },
    create: { name: "Fridge" },
    update: {},
  });
  const item = await db.item.create({
    data: {
      name: "Yogurt",
      normalizedName: "yogurt",
      quantity: 1,
      unit: "tub",
      category: "Dairy",
      locationId: location.id,
      expiration: "2026-09-20",
      dateSource: "user",
      datePrecision: "exact",
      confidence: 1,
      source: "chat",
    },
  });
  expect(
    (
      await POST(
        request("quantity", JSON.stringify({ id: item.id, delta: -1 })),
      )
    ).status,
  ).toBe(200);
  expect(
    await db.item.findUniqueOrThrow({ where: { id: item.id } }),
  ).toMatchObject({ quantity: 0, status: "empty" });
  expect(await db.event.count({ where: { itemId: item.id } })).toBe(1);
  expect((await POST(request("undo", JSON.stringify({})))).status).toBe(200);
  expect(
    await db.item.findUniqueOrThrow({ where: { id: item.id } }),
  ).toMatchObject({ quantity: 1, status: "available" });
});

it("exports authenticated inventory as safe CSV and complete JSON", async () => {
  const location = await db.location.upsert({
    where: { name: "Fridge" },
    create: { name: "Fridge" },
    update: {},
  });
  await db.item.create({
    data: {
      name: "Milk",
      normalizedName: "milk",
      brand: "=unsafe spreadsheet formula",
      quantity: 2,
      unit: "cartons",
      category: "Dairy",
      locationId: location.id,
      expiration: "2026-09-30",
      dateSource: "image",
      datePrecision: "exact",
      confidence: 0.9,
      source: "photo",
    },
  });
  expect((await GET(request("export?format=csv", undefined, false))).status).toBe(
    401,
  );
  const csv = await GET(request("export?format=csv"));
  expect(csv.status).toBe(200);
  expect(csv.headers.get("content-disposition")).toContain(".csv");
  expect(await csv.text()).toContain("'=unsafe spreadsheet formula");
  const exported = await GET(request("export?format=json"));
  const body = await exported.json();
  expect(exported.status).toBe(200);
  expect(body.items[0]).toMatchObject({ name: "Milk", location: "Fridge" });
  expect(body).not.toHaveProperty("sessions");
});

it("reports provider availability without exposing diagnostics", async () => {
  ai.available.mockResolvedValue(false);
  const response = await GET(request("provider-status"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ available: false });
});
