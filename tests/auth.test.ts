import { beforeEach, afterAll, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { db, days } from "../src/lib/db";
import { authorized, digest, sameOrigin } from "../src/lib/auth";
const token = "fixture-token";
const request = () =>
  new NextRequest("https://nora.shuainium.com/api/state", {
    headers: { cookie: `__Host-nora=${token}` },
  });
beforeEach(() => db.session.deleteMany());
afterAll(() => db.$disconnect());
it("denies unauthenticated requests", async () => {
  expect(await authorized(request())).toBe(false);
});
it("expires idle sessions", async () => {
  await db.session.create({
    data: { id: digest(token), lastSeen: new Date(Date.now() - days(16)) },
  });
  expect(await authorized(request())).toBe(false);
});
it("expires absolute lifetime even when recently active", async () => {
  await db.session.create({
    data: { id: digest(token), createdAt: new Date(Date.now() - days(31)) },
  });
  expect(await authorized(request())).toBe(false);
});
it("accepts valid sessions and rejects cross-origin mutations", async () => {
  await db.session.create({ data: { id: digest(token) } });
  expect(await authorized(request())).toBe(true);
  expect(
    sameOrigin(
      new NextRequest("https://nora.shuainium.com/api/chat", {
        headers: { origin: "https://attacker.example" },
      }),
    ),
  ).toBe(false);
});
