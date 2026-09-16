import { PrismaClient } from "@prisma/client";
const globalDb = globalThis as unknown as { prisma: PrismaClient };
export const db = globalDb.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalDb.prisma = db;
export const days = (n: number) => n * 86400000;
export function settingNumber(name: string, fallback: number) {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(n) || n <= 0) throw new Error("Invalid configuration");
  return n;
}
export function today(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.HOUSEHOLD_TIMEZONE || "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function expired(
  item: { expiration: string; status: string },
  date = today(),
) {
  return item.status === "expired" || item.expiration < date;
}
