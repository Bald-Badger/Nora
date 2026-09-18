import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { authorized, cookieName, digest, sameOrigin, verifyPassword } from "@/lib/auth";
import { db, days, settingNumber } from "@/lib/db";
import { consumeMenuDish, createMenuGeneration, menuState, setImagePreference } from "@/lib/menu";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) => NextResponse.json(value, { status });

export async function GET(req: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (action === "auth") return json({ authenticated: await authorized(req, "menu") });
  if (!(await authorized(req, "menu"))) return json({ error: "Please sign in." }, 401);
  if (action === "state") {
    const offset = Math.max(0, Math.min(Number(req.nextUrl.searchParams.get("offset") || 0), 1000));
    const limit = Math.max(1, Math.min(Number(req.nextUrl.searchParams.get("limit") || 6), 18));
    return json(await menuState(offset, limit));
  }
  if (action === "image") {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return json({ error: "Missing image." }, 400);
    const image = await db.menuImage.findUnique({ where: { id } });
    if (!image) return json({ error: "Image unavailable." }, 404);
    const data = await readFile(image.path).catch(() => null);
    if (!data) return json({ error: "Image unavailable." }, 404);
    await db.menuImage.update({ where: { id }, data: { lastUsedAt: new Date() } });
    return new NextResponse(data, { headers: { "Content-Type": image.mime, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" } });
  }
  return json({ error: "Not found." }, 404);
}

export async function POST(req: NextRequest, context: { params: Promise<{ action: string }> }) {
  if (!sameOrigin(req, "menu")) return json({ error: "Invalid request origin." }, 403);
  const { action } = await context.params;
  try {
    if (action === "login") {
      const attempt = await db.loginAttempt.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
      if (attempt.blockedUntil && attempt.blockedUntil > new Date()) return json({ error: "Too many attempts. Try again in 15 minutes." }, 429);
      const body = await req.json();
      if (typeof body.password !== "string" || body.password.length > 1024) return json({ error: "Invalid password." }, 400);
      const saved = await db.setting.findUnique({ where: { key: "password" } });
      if (!saved || !verifyPassword(body.password, saved.value)) {
        await db.loginAttempt.update({ where: { id: 1 }, data: { failures: { increment: 1 }, blockedUntil: attempt.failures >= 4 ? new Date(Date.now() + 900000) : null } });
        return json({ error: "Incorrect password." }, 401);
      }
      await db.loginAttempt.update({ where: { id: 1 }, data: { failures: 0, blockedUntil: null } });
      const token = randomBytes(32).toString("hex");
      await db.session.create({ data: { id: digest(token), scope: "menu" } });
      const response = json({ ok: true });
      response.cookies.set(cookieName, token, { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: days(settingNumber("SESSION_MAX_DAYS", 30)) / 1000 });
      return response;
    }
    if (!(await authorized(req, "menu"))) return json({ error: "Please sign in." }, 401);
    if (action === "logout") {
      const token = req.cookies.get(cookieName)?.value;
      if (token) await db.session.deleteMany({ where: { id: digest(token), scope: "menu" } });
      const response = json({ ok: true });
      response.cookies.set(cookieName, "", { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 0 });
      return response;
    }
    if (action === "generate") return json({ generationId: (await createMenuGeneration("manual")).id }, 202);
    if (action === "preference") {
      const body = await req.json();
      if (typeof body.dishId !== "string" || !["like", "dislike"].includes(body.preference)) return json({ error: "Invalid preference." }, 400);
      return json(await setImagePreference(body.dishId, body.preference));
    }
    if (action === "cook") {
      const body = await req.json();
      if (typeof body.dishId !== "string" || !Number.isInteger(body.servings)) return json({ error: "Invalid cooking request." }, 400);
      return json({ receipt: await consumeMenuDish(body.dishId, body.servings) });
    }
    return json({ error: "Not found." }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Menu request failed.";
    const conflict = ["MENU_INVENTORY_EMPTY", "MENU_INGREDIENT_UNAVAILABLE"].includes(message);
    return json({ error: message === "MENU_INVENTORY_EMPTY" ? "No active ingredients are available." : message === "MENU_INGREDIENT_UNAVAILABLE" ? "One or more ingredients are no longer available in the required quantity." : "Menu request failed. Please try again." }, conflict ? 409 : 503);
  }
}
