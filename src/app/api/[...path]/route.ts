import { NextRequest, NextResponse } from "next/server";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { db, expired, today, days, settingNumber } from "@/lib/db";
import {
  authorized,
  cookieName,
  digest,
  sameOrigin,
  verifyPassword,
} from "@/lib/auth";
import { classify, interpret, model, promptVersion } from "@/ai/provider";
import { applyResult, revision } from "@/lib/inventory";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status });
export async function GET(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (path === "/api/health") return json({ ok: true });
  if (path === "/api/auth")
    return json({
      authenticated: await authorized(req),
      configured: !!(await db.setting.findUnique({
        where: { key: "password" },
      })),
    });
  if (!(await authorized(req))) return json({ error: "Please sign in." }, 401);
  if (path === "/api/state") {
    const [items, messages, pending] = await Promise.all([
      db.item.findMany({
        include: { location: true },
        orderBy: [{ category: "asc" }, { name: "asc" }],
      }),
      db.message.findMany({
        where: {
          createdAt: {
            gte: new Date(Date.now() - days(settingNumber("CHAT_DAYS", 60))),
          },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      db.processing.findMany({
        where: { status: "pending" },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);
    return json({
      items: items.map((i) => ({ ...i, expired: expired(i) })),
      messages: messages.reverse(),
      pending: pending.map((p) => ({
        id: p.id,
        result: JSON.parse(p.result!),
      })),
    });
  }
  return json({ error: "Not found" }, 404);
}
let busy = false;
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Invalid request origin." }, 403);
  const path = req.nextUrl.pathname;
  if (Number(req.headers.get("content-length") || 0) > 9 * 1024 * 1024)
    return json({ error: "Upload exceeds 8 MB." }, 413);
  try {
    if (path === "/api/login") {
      const attempt = await db.loginAttempt.upsert({
        where: { id: 1 },
        create: { id: 1 },
        update: {},
      });
      if (attempt.blockedUntil && attempt.blockedUntil > new Date())
        return json(
          { error: "Too many attempts. Try again in 15 minutes." },
          429,
        );
      const { password } = await req.json();
      if (typeof password !== "string" || password.length > 1024)
        return json({ error: "Invalid password." }, 400);
      const saved = await db.setting.findUnique({ where: { key: "password" } });
      if (!saved)
        return json(
          { error: "Run the local password setup command first." },
          503,
        );
      if (!verifyPassword(password, saved.value)) {
        await db.loginAttempt.update({
          where: { id: 1 },
          data: {
            failures: { increment: 1 },
            blockedUntil:
              attempt.failures >= 4 ? new Date(Date.now() + 900000) : null,
          },
        });
        return json({ error: "Incorrect password." }, 401);
      }
      await db.loginAttempt.update({
        where: { id: 1 },
        data: { failures: 0, blockedUntil: null },
      });
      const token = randomBytes(32).toString("hex");
      await db.session.create({ data: { id: digest(token) } });
      const response = json({ ok: true });
      response.cookies.set(cookieName, token, {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        path: "/",
        maxAge: days(settingNumber("SESSION_MAX_DAYS", 30)) / 1000,
      });
      return response;
    }
    if (!(await authorized(req)))
      return json({ error: "Please sign in." }, 401);
    if (path === "/api/logout" || path === "/api/revoke") {
      await db.session.deleteMany({
        where:
          path === "/api/revoke"
            ? {}
            : { id: digest(req.cookies.get(cookieName)!.value) },
      });
      const response = json({ ok: true });
      response.cookies.set(cookieName, "", {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        path: "/",
        maxAge: 0,
      });
      return response;
    }
    if (path === "/api/confirm" || path === "/api/cancel") {
      const { id } = await req.json();
      if (typeof id !== "string")
        return json({ error: "Invalid proposal." }, 400);
      if (path === "/api/cancel")
        await db.processing.updateMany({
          where: { id, status: "pending" },
          data: { status: "cancelled" },
        });
      else await applyResult(id);
      return json({ ok: true });
    }
    if (path === "/api/undo") {
      const processing = await db.processing.create({
        data: {
          requestId: randomUUID(),
          original: "Undo last change",
          promptVersion: "local-undo-v1",
          model: "local",
          baseRevision: await revision(),
          status: "pending",
          result: JSON.stringify({
            reply: "",
            assumptions: [],
            actions: [{ operation: "undo" }],
          }),
        },
      });
      await applyResult(processing.id);
      return json({ ok: true });
    }
    if (path === "/api/discard") {
      const { id } = await req.json();
      if (typeof id !== "string") return json({ error: "Invalid item." }, 400);
      const item = await db.item.findUnique({
        where: { id },
        include: { location: true },
      });
      if (!item || ["consumed", "discarded", "empty"].includes(item.status))
        return json({ error: "That item is no longer active." }, 409);
      const processing = await db.processing.create({
        data: {
          requestId: randomUUID(),
          original: `Discard ${item.name}`,
          promptVersion: "local-discard-v1",
          model: "local",
          baseRevision: await revision(),
          status: "pending",
          result: JSON.stringify({
            reply: "",
            assumptions: [],
            actions: [
              {
                operation: "update",
                id: item.id,
                item: {
                  name: item.name,
                  brand: item.brand,
                  quantity: 0,
                  unit: item.unit,
                  category: item.category,
                  location: "Fridge",
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
              },
            ],
          }),
        },
      });
      await applyResult(processing.id);
      return json({ ok: true });
    }
    if (path !== "/api/chat") return json({ error: "Not found" }, 404);
    if (busy)
      return json({ error: "Nora is finishing your previous request." }, 409);
    busy = true;
    let processingId: string | undefined;
    try {
      const form = await req.formData();
      const message = String(form.get("message") || "").trim();
      const requestId = String(form.get("requestId") || "");
      const file = form.get("image");
      if (
        !/^[a-f0-9-]{36}$/.test(requestId) ||
        message.length > 8000 ||
        (!message && !(file instanceof File))
      )
        return json({ error: "Enter a message or attach a photo." }, 400);
      const existing = await db.processing.findUnique({ where: { requestId } });
      if (existing) {
        if (["applied", "answered", "pending"].includes(existing.status))
          return json({ ok: true });
        return json(
          {
            error:
              existing.status === "processing"
                ? "This request is still processing."
                : "That request failed. Please try again.",
          },
          existing.status === "processing" ? 409 : 503,
        );
      }
      const processing = await db.processing.create({
        data: {
          requestId,
          original: message,
          promptVersion,
          model: model(),
          baseRevision: await revision(),
        },
      });
      processingId = processing.id;
      let image: string | undefined;
      if (file instanceof File && file.size) {
        if (file.size > 8 * 1024 * 1024) throw new Error("IMAGE_SIZE");
        const original = Buffer.from(await file.arrayBuffer());
        const metadata = await sharp(original, {
          limitInputPixels: 25000000,
        }).metadata();
        if (!["jpeg", "png", "webp"].includes(metadata.format || ""))
          throw new Error("IMAGE_FORMAT");
        const normalized = await sharp(original, { limitInputPixels: 25000000 })
          .rotate()
          .resize({
            width: 1600,
            height: 1600,
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: 85 })
          .toBuffer();
        const folder = process.env.UPLOAD_DIR || "/app/data/uploads";
        await mkdir(folder, { recursive: true, mode: 0o700 });
        const path = `${folder}/${randomUUID()}.${metadata.format}`;
        await writeFile(path, original, { mode: 0o600 });
        await db.upload.create({
          data: { processingId, path, mime: `image/${metadata.format}` },
        });
        image = `data:image/jpeg;base64,${normalized.toString("base64")}`;
      }
      await db.message.create({
        data: {
          role: "user",
          content: message || "Photo inventory request",
          processingId,
        },
      });
      const intent =
        image && !message
          ? { intent: "edit", terms: [], expirationCorrection: false }
          : await classify(message);
      await db.debugLog.create({
        data: {
          code: `AI_INTENT_${intent.intent.toUpperCase()}`,
          processingId,
        },
      });
      const all = await db.item.findMany({
        include: { location: true },
        orderBy: { updatedAt: "desc" },
      });
      let selected = all.filter(
        (i) => !["consumed", "discarded", "empty"].includes(i.status),
      );
      if (intent.intent === "recommend" || intent.intent === "shopping")
        selected = selected.filter((i) => !expired(i) && i.quantity > 0);
      else if (intent.terms.length) {
        const matches = selected.filter((i) =>
          intent.terms.some((t) =>
            `${i.name} ${i.brand}`.toLowerCase().includes(t.toLowerCase()),
          ),
        );
        selected = matches.length ? matches : selected.slice(0, 10);
      }
      const history =
        intent.intent === "shopping"
          ? (
              await db.event.findMany({
                where: { action: { not: "undo" } },
                orderBy: { createdAt: "desc" },
                take: 30,
                select: { action: true, after: true },
              })
            ).map((event) => {
              const item = event.after ? JSON.parse(event.after) : null;
              return {
                action: event.action,
                name: item?.name,
                unit: item?.unit,
                quantity: item?.quantity,
              };
            })
          : [];
      const recent = ["edit", "query", "undo"].includes(intent.intent)
        ? await db.message.findMany({
            orderBy: { createdAt: "desc" },
            take: 6,
            select: { role: true, content: true },
          })
        : [];
      const contextItems = selected
        .slice(0, 40)
        .map(
          ({
            createdAt,
            updatedAt,
            version,
            locationId,
            normalizedName,
            ...item
          }) => ({ ...item, location: item.location.name }),
        );
      while (JSON.stringify(contextItems).length > 14000) contextItems.pop();
      const context = {
        now: new Date().toISOString(),
        today: today(),
        timezone: process.env.HOUSEHOLD_TIMEZONE || "America/Phoenix",
        items: contextItems,
        truncated: selected.length > contextItems.length,
        history,
        recent: recent
          .reverse()
          .map((m) => ({ ...m, content: m.content.slice(0, 1500) })),
      };
      const result = await interpret(
        message || "Identify grocery items to add.",
        context,
        intent.intent,
        image,
      );
      for (const action of result.actions) {
        if (action.operation !== "update") continue;
        const original = selected.find((i) => i.id === action.id);
        if (
          !original ||
          (expired(original) &&
            !expired(action.item) &&
            !intent.expirationCorrection)
        )
          throw new Error("INVALID_ITEM_UPDATE");
      }
      await db.processing.update({
        where: { id: processingId },
        data: {
          result: JSON.stringify(result),
          status: result.actions.length ? "pending" : "answered",
        },
      });
      if (!result.actions.length)
        await db.message.create({
          data: {
            role: "assistant",
            content: [result.reply, ...result.assumptions].join("\n"),
            processingId,
          },
        });
      else if (!image) await applyResult(processingId);
      await db.debugLog
        .create({ data: { code: "AI_VALIDATED", processingId } })
        .catch(() => {});
      return json({ ok: true });
    } catch (failure) {
      if (processingId)
        await db.processing.updateMany({
          where: {
            id: processingId,
            status: { in: ["processing", "pending"] },
          },
          data: { status: "failed" },
        });
      const safeCode =
        failure instanceof Error &&
        /^AI_HTTP_\d+(?:_RETRY_SECONDS_\d+)?$/.test(failure.message)
          ? failure.message
          : "AI_OR_VALIDATION_FAILURE";
      await db.debugLog.create({ data: { code: safeCode, processingId } });
      return json(
        {
          error:
            "AI or image processing is unavailable, or the response could not be safely applied. Inventory was not changed. Please try again.",
        },
        503,
      );
    } finally {
      busy = false;
    }
  } catch {
    return json(
      {
        error:
          "The request could not be applied. Inventory may have changed; refresh and try again.",
      },
      409,
    );
  }
}
