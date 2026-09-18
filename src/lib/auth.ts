import {
  randomBytes,
  createHash,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { db, days, settingNumber } from "./db";
import type { NextRequest } from "next/server";
export const cookieName = "__Host-nora";
export function hashPassword(password: string) {
  const salt = randomBytes(32).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password: string, saved: string) {
  const [salt, value] = saved.split(":");
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(value, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
export const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export type SessionScope = "nora" | "menu";
export async function authorized(req: NextRequest, scope: SessionScope = "nora") {
  const token = req.cookies.get(cookieName)?.value;
  if (!token) return false;
  const session = await db.session.findUnique({ where: { id: digest(token) } });
  if (!session || session.scope !== scope) return false;
  const now = Date.now();
  if (
    now - session.lastSeen.getTime() >
      days(settingNumber("SESSION_IDLE_DAYS", 15)) ||
    now - session.createdAt.getTime() >
      days(settingNumber("SESSION_MAX_DAYS", 30))
  ) {
    await db.session.deleteMany({ where: { id: session.id } });
    return false;
  }
  await db.session.updateMany({
    where: { id: session.id },
    data: { lastSeen: new Date() },
  });
  return true;
}
export function sameOrigin(req: NextRequest, scope: SessionScope = "nora") {
  const expected =
    scope === "menu"
      ? process.env.MENU_ORIGIN || "https://menu.shuainium.com"
      : process.env.APP_ORIGIN || "https://nora.shuainium.com";
  return (
    req.headers.get("origin") === expected
  );
}
