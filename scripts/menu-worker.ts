import { runNextMenuJob, scheduleRoutineMenu } from "../src/lib/menu";
import { db } from "../src/lib/db";

async function main() {
  for (;;) {
    await scheduleRoutineMenu().catch(() => undefined);
    const worked = await runNextMenuJob();
    if (!worked) await new Promise((resolve) => setTimeout(resolve, 5000));
    else await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
main().finally(() => db.$disconnect());
