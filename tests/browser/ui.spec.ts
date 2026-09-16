import { test, expect } from "@playwright/test";
test("generate grocery label fixture", async ({ page }, info) => {
  await page.setViewportSize({ width: 700, height: 400 });
  await page.setContent(
    '<main style="background:white;color:black;font:32px Arial;padding:30px;height:340px"><div style="background:#dae6f2;width:270px;padding:20px"><b>WHOLE MILK</b><p>1 L</p><small>BEST BY</small><div>2026-10-15</div></div></main>',
  );
  await page.screenshot({
    path: `test-results/${info.project.name}-label.png`,
  });
});
test("login, inventory drawer, photo attachment, and sign out", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByLabel("Password", { exact: true })
    .fill("nora-test-fixture-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "What’s in your fridge?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Inventory/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("textbox", { name: "Search inventory" }).fill("milk");
  await expect(page.getByText("No items yet.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("textbox", { name: "Message Nora" })
    .fill("I bought milk");
  await page.screenshot({
    path: `test-results/${info.project.name}-chat.png`,
    fullPage: true,
  });
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  expect(overflows).toBe(false);
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
});
test("renders populated inventory and photo confirmation", async ({
  page,
}, info) => {
  const item = {
    id: "fixture",
    name: "Whole milk",
    brand: "Costco",
    quantity: 3,
    unit: "cartons",
    category: "Dairy",
    expiration: "2027-01-01",
    dateSource: "ai",
    datePrecision: "approximate",
    dateKind: "quality",
    expired: false,
    status: "available",
    notes: "",
    storage: "Top shelf",
    leftover: false,
    createdAt: "2026-09-16",
    location: { name: "Fridge" },
  };
  await page.route("**/api/auth", (r) =>
    r.fulfill({ json: { authenticated: true, configured: true } }),
  );
  await page.route("**/api/state", (r) =>
    r.fulfill({
      json: {
        items: [item],
        messages: [
          {
            id: "1",
            role: "user",
            content: "Add the groceries in this photo.",
          },
        ],
        pending: [
          {
            id: "p",
            result: {
              reply: "I found milk.",
              assumptions: ["The carton volume is not readable."],
              actions: [{ operation: "add", item }],
            },
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Confirm", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/${info.project.name}-proposal.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: /Inventory/ }).click();
  await expect(
    page.getByRole("dialog").getByText("Whole milk", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Discard Whole milk" }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/${info.project.name}-inventory.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});
