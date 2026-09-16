import { z } from "zod";
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + "T00:00:00Z");
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  });
export const itemSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    brand: z.string().max(120),
    quantity: z.number().finite().min(0).max(100000),
    unit: z.string().trim().min(1).max(40),
    category: z.string().trim().min(1).max(60),
    location: z.literal("Fridge"),
    notes: z.string().max(1000),
    storage: z.string().max(120),
    leftover: z.boolean(),
    status: z.enum([
      "available",
      "low",
      "empty",
      "consumed",
      "discarded",
      "expired",
    ]),
    expiration: date,
    dateSource: z.enum(["user", "image", "ai"]),
    datePrecision: z.enum(["exact", "approximate", "unknown"]),
    dateKind: z.enum(["quality", "safety"]),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export const actionSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("add"), item: itemSchema }).strict(),
  z
    .object({
      operation: z.literal("update"),
      id: z.string().max(100),
      item: itemSchema,
    })
    .strict(),
  z.object({ operation: z.literal("undo") }).strict(),
]);
export const resultSchema = z
  .object({
    reply: z.string().max(12000),
    assumptions: z.array(z.string().max(500)).max(30),
    actions: z.array(actionSchema).max(50),
  })
  .strict();
export type Result = z.infer<typeof resultSchema>;
export const intentSchema = z
  .object({
    intent: z.enum(["edit", "query", "recommend", "shopping", "undo"]),
    terms: z.array(z.string().max(80)).max(12),
    expirationCorrection: z.boolean(),
  })
  .strict();
