import { classify, interpret } from "../src/ai/provider";
import { resultSchema } from "../src/lib/schema";
import sharp from "sharp";
import { readFileSync } from "node:fs";
async function main() {
  const context = {
    now: "2026-09-16T12:00:00Z",
    today: "2026-09-16",
    timezone: "America/Phoenix",
    items: [],
    recent: [],
    history: [],
  };
  const message =
    "Add 3 cartons of Costco whole milk, expiring in roughly 3 months.";
  if (!process.env.SMOKE_VISION_ONLY) {
    const intent = await classify(message);
    const result = resultSchema.parse(
      await interpret(message, context, intent.intent),
    );
    if (
      result.actions[0]?.operation !== "add" ||
      result.actions[0].item.quantity !== 3 ||
      result.actions[0].item.expiration !== "2026-12-16" ||
      result.actions[0].item.datePrecision !== "approximate"
    )
      throw new Error(
        "Text interpretation did not match expected inventory fields",
      );
    console.log("PASS live text: quantity, units, relative date, uncertainty");
  }
  const fixture = await sharp(readFileSync("/fixtures/desktop-label.png"))
    .png()
    .toBuffer();
  const photo = await interpret(
    "Add the single item shown.",
    context,
    "edit",
    `data:image/png;base64,${fixture.toString("base64")}`,
  );
  const action = photo.actions[0];
  if (
    action?.operation !== "add" ||
    action.item.expiration !== "2026-10-15" ||
    action.item.dateSource !== "image"
  )
    throw new Error("Photo interpretation did not match label");
  console.log("PASS live vision: item identification and printed date");
}
main().catch((error) => {
  console.error(
    "Live smoke test failed:",
    error instanceof Error ? error.name : "unknown",
  );
  if (
    error instanceof Error &&
    /^(AI_HTTP_\d+|Text interpretation|Photo interpretation)/.test(
      error.message,
    )
  )
    console.error(error.message);
  process.exitCode = 1;
});
