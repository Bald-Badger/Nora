import { z } from "zod";

export const menuIngredientSchema = z
  .object({
    itemId: z.string().min(1).max(100),
    nameZh: z.string().min(1).max(100),
    nameEn: z.string().min(1).max(100),
    amountValue: z.number().positive().max(100000),
    amountUnitZh: z.string().trim().min(1).max(30),
    amountUnitEn: z.string().trim().min(1).max(30),
    inventoryQuantity: z.number().positive().max(100000),
  })
  .strict();

export const menuDishSchema = z
  .object({
    nameZh: z.string().min(1).max(100),
    nameEn: z.string().min(1).max(100),
    prepMinutes: z.number().int().min(1).max(360),
    cookMinutes: z.number().int().min(1).max(720),
    imageSearchQuery: z.string().min(1).max(160),
    ingredients: z.array(menuIngredientSchema).min(1).max(30),
    stepsZh: z.array(z.string().min(12).max(700)).min(2).max(30),
    stepsEn: z.array(z.string().min(12).max(700)).min(2).max(30),
  })
  .strict();

export const menuBatchSchema = z
  .object({ dishes: z.array(menuDishSchema).length(6) })
  .strict();

export const imageChoiceSchema = z
  .object({ index: z.number().int().min(1).max(3), reason: z.string().max(300) })
  .strict();

export type MenuDishProposal = z.infer<typeof menuDishSchema>;
