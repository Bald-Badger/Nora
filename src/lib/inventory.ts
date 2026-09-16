import { db, expired } from "./db";
import { Result, resultSchema } from "./schema";
import type { Prisma } from "@prisma/client";
export async function revision() {
  return Number(
    (await db.setting.findUnique({ where: { key: "revision" } }))?.value || 0,
  );
}
export async function applyResult(processingId: string) {
  return db.$transaction(async (tx) => {
    const processing = await tx.processing.findUniqueOrThrow({
      where: { id: processingId },
    });
    if (processing.status !== "pending")
      throw new Error("This proposal is no longer pending.");
    const rev = Number(
      (await tx.setting.findUnique({ where: { key: "revision" } }))?.value || 0,
    );
    if (rev !== processing.baseRevision)
      throw new Error("Inventory changed. Please send your request again.");
    const result = resultSchema.parse(JSON.parse(processing.result!));
    if (result.actions.some((a) => a.operation === "undo")) {
      if (result.actions.length !== 1)
        throw new Error("Undo must be a separate request.");
      await undo(tx, processingId);
    } else {
      const location = await tx.location.upsert({
        where: { name: "Fridge" },
        create: { name: "Fridge" },
        update: {},
      });
      for (const action of result.actions) {
        if (action.operation === "undo") continue;
        const { location: _location, ...fields } = action.item;
        const values = {
          ...fields,
          normalizedName: fields.name.toLowerCase(),
          locationId: location.id,
          source:
            processingId && (await tx.upload.count({ where: { processingId } }))
              ? "photo"
              : "chat",
        };
        if (
          values.quantity === 0 &&
          ["available", "low"].includes(values.status)
        )
          values.status = "empty";
        if (action.operation === "add" && values.quantity <= 0)
          throw new Error("New items need a positive quantity.");
        let before =
          action.operation === "update"
            ? await tx.item.findUniqueOrThrow({ where: { id: action.id } })
            : null;
        if (
          before &&
          expired(before) &&
          !expired(values) &&
          before.expiration === values.expiration
        )
          throw new Error(
            "An expired item needs an explicit expiration correction.",
          );
        // Merge only identical batch metadata, preserving differences in storage and notes too.
        if (action.operation === "add")
          before = await tx.item.findFirst({
            where: {
              ...values,
              quantity: undefined,
              confidence: undefined,
              source: undefined,
            },
          });
        const after = before
          ? await tx.item.update({
              where: { id: before.id },
              data: {
                ...values,
                quantity:
                  action.operation === "add"
                    ? before.quantity + values.quantity
                    : values.quantity,
                version: { increment: 1 },
              },
            })
          : await tx.item.create({ data: values });
        await tx.event.create({
          data: {
            processingId,
            itemId: after.id,
            action: action.operation,
            before: before ? JSON.stringify(before) : null,
            after: JSON.stringify(after),
          },
        });
      }
    }
    await tx.setting.upsert({
      where: { key: "revision" },
      create: { key: "revision", value: String(rev + 1) },
      update: { value: String(rev + 1) },
    });
    await tx.processing.update({
      where: { id: processingId },
      data: { status: "applied" },
    });
    const receipt = result.actions
      .map((a) =>
        a.operation === "undo"
          ? "Undid the last inventory change."
          : `${a.operation === "add" ? "Added" : "Updated"} ${a.item.name}: ${a.item.quantity} ${a.item.unit}; ${a.item.expiration} (${a.item.dateSource}, ${a.item.datePrecision}).`,
      )
      .join("\n");
    await tx.message.create({
      data: {
        role: "assistant",
        processingId,
        content: [
          receipt,
          ...result.assumptions.map((a) => `Assumption: ${a}`),
        ].join("\n"),
      },
    });
    return receipt;
  });
}
async function undo(tx: Prisma.TransactionClient, processingId: string) {
  const latest = await tx.event.findFirst({
    where: { undone: false, action: { not: "undo" } },
    orderBy: { createdAt: "desc" },
  });
  if (!latest) throw new Error("No inventory change to undo.");
  const events = await tx.event.findMany({
    where: { processingId: latest.processingId, undone: false },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  for (const event of events) {
    const current = await tx.item.findUnique({ where: { id: event.itemId } });
    const expected = JSON.parse(event.after!);
    if (!current || current.version !== expected.version)
      throw new Error(
        "This item changed after that edit; undo is unavailable.",
      );
    if (event.before) {
      const previous = JSON.parse(event.before);
      await tx.item.update({
        where: { id: event.itemId },
        data: {
          ...previous,
          createdAt: new Date(previous.createdAt),
          updatedAt: new Date(previous.updatedAt),
        },
      });
    } else await tx.item.delete({ where: { id: event.itemId } });
    await tx.event.update({ where: { id: event.id }, data: { undone: true } });
    await tx.event.create({
      data: {
        processingId,
        itemId: event.itemId,
        action: "undo",
        before: JSON.stringify(current),
        after: event.before,
      },
    });
  }
}
