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
  await expect(
    page.getByRole("heading", { name: "What’s cooking?" }),
  ).toBeVisible();
  const passwordInput = page.getByLabel("Password", { exact: true });
  await expect(passwordInput).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(passwordInput).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(passwordInput).toHaveAttribute("type", "password");
  await page
    .getByLabel("Password", { exact: true })
    .fill("nora-test-fixture-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "What’s in your kitchen?" }),
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
    notes: "Added by user. Whole and uncut.",
    storage: "Top shelf",
    leftover: false,
    createdAt: "2026-09-16",
    location: { name: "Fridge" },
  };
  const laterItem = {
    ...item,
    id: "later-fixture",
    name: "Butter",
    brand: "unknown",
    quantity: 1,
    unit: "pack",
    expiration: "2027-02-01",
    storage: "Spice rack",
    location: { name: "Shelf" },
  };
  const expiredLeftover = {
    ...item,
    id: "leftover-fixture",
    name: "Rice bowl",
    brand: "",
    quantity: 1,
    unit: "container",
    category: "Leftovers",
    expiration: "2026-12-28",
    expired: true,
    leftover: true,
    storage: "Middle shelf",
    location: { name: "Freezer" },
  };
  const expiredMilk = {
    ...item,
    id: "expired-milk-fixture",
    name: "Old milk",
    quantity: 1,
    expiration: "2026-12-27",
    expired: true,
  };
  await page.route("**/api/auth", (r) =>
    r.fulfill({ json: { authenticated: true, configured: true } }),
  );
  await page.route("**/api/state", (r) =>
    r.fulfill({
      json: {
        items: [laterItem, expiredLeftover, expiredMilk, item],
        today: "2026-12-29",
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
              actions: [
                {
                  operation: "add",
                  item: { ...item, location: "Fridge" },
                },
              ],
            },
          },
        ],
      },
    }),
  );
  await page.route("**/api/provider-status", (r) =>
    r.fulfill({ json: { available: true, state: "ready" } }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Confirm", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Attach photo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Take photo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Scan receipt" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Scan product barcode" }),
  ).toHaveCount(0);
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-theme", /dark|light/);
  const initialTheme = await root.getAttribute("data-theme");
  await page.getByRole("button", { name: /Use (day|night) theme/ }).click();
  await expect(root).not.toHaveAttribute("data-theme", initialTheme || "");
  await page.getByRole("button", { name: /Expiration reminders, 3 items/ }).click();
  await expect(
    page.getByRole("heading", { name: "Expiration reminders" }),
  ).toBeVisible();
  await expect(page.getByText("Expires in 3 days", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Throw away this expired leftover", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Expired · review or discard", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/${info.project.name}-reminders.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close reminders" }).click();
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
  await expect(
    page.getByRole("button", { name: "Decrease Whole milk by 1 cartons" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Increase Whole milk by 1 cartons" }),
  ).toBeVisible();
  await expect(page.getByText("Expires in 3 days", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Export format")).toHaveValue("csv");
  await expect(
    page.getByRole("link", { name: "Download inventory as CSV" }),
  ).toHaveAttribute("href", "/api/export?format=csv");
  const inventoryNames = page.locator(".inventory-item strong");
  await expect(inventoryNames.nth(0)).toHaveText("Old milk");
  await expect(inventoryNames.nth(1)).toHaveText("Whole milk");
  await expect(inventoryNames.nth(2)).toHaveText("Butter");
  await expect(
    page
      .locator(".inventory-item", { hasText: "Whole milk" })
      .getByText(/^Fridge · Top shelf$/),
  ).toBeVisible();
  await expect(
    page
      .locator(".inventory-item", { hasText: "Butter" })
      .getByText(/^Shelf · Spice rack$/),
  ).toBeVisible();
  await expect(
    page
      .locator(".inventory-item", { hasText: "Rice bowl" })
      .getByText(/^Freezer · Middle shelf · Leftover$/),
  ).toBeVisible();
  await expect(
    page.getByText("Added by user. Whole and uncut.", { exact: true }),
  ).not.toBeVisible();
  await expect(page.getByText("unknown", { exact: true })).not.toBeVisible();
  await expect(page.getByText(/From chat/)).not.toBeVisible();
  await expect(page.getByText(/confidence/)).not.toBeVisible();
  await expect(page.getByText(/Added 2026/)).not.toBeVisible();
  await expect(page.getByText(/AI estimated/)).not.toBeVisible();
  await expect(page.getByText(/Approximate/)).not.toBeVisible();
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

test("loads older chat only after scrolling upward to the top", async ({
  page,
}) => {
  let historyRequests = 0;
  const recent = Array.from({ length: 30 }, (_, index) => ({
    id: `recent-${index}`,
    role: index % 2 ? "assistant" : "user",
    content: `Recent message ${index} with enough text to create a scrollable conversation.`,
  }));
  await page.route("**/api/auth", (route) =>
    route.fulfill({ json: { authenticated: true, configured: true } }),
  );
  await page.route("**/api/provider-status", (route) =>
    route.fulfill({ json: { available: true, state: "ready" } }),
  );
  await page.route("**/api/state", (route) =>
    route.fulfill({
      json: {
        items: [],
        messages: recent,
        pending: [],
        today: "2026-09-16",
        hasMoreMessages: true,
      },
    }),
  );
  await page.route("**/api/messages?before=*", (route) => {
    historyRequests += 1;
    return route.fulfill({
      json: {
        messages: [
          {
            id: "older-1",
            role: "assistant",
            content: "Loaded older message",
          },
        ],
        hasMore: false,
      },
    });
  });

  await page.goto("/");
  await expect(page.getByText("Recent message 29", { exact: false })).toBeVisible();
  expect(historyRequests).toBe(0);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(120);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByText("Loaded older message", { exact: true })).toBeVisible();
  expect(historyRequests).toBe(1);
});
