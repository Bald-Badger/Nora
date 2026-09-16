import { db, days, settingNumber } from "../src/lib/db";
import { mkdir, cp, rm, readdir, rename } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const root = process.env.BACKUP_DIR || "/app/backups";
async function run() {
  const now = Date.now();
  for (const upload of await db.upload.findMany({
    where: {
      deleted: false,
      createdAt: { lt: new Date(now - days(settingNumber("IMAGE_DAYS", 30))) },
    },
  })) {
    await rm(upload.path, { force: true });
    await db.upload.update({
      where: { id: upload.id },
      data: { deleted: true },
    });
  }
  await db.message.deleteMany({
    where: {
      createdAt: { lt: new Date(now - days(settingNumber("CHAT_DAYS", 60))) },
    },
  });
  await db.processing.updateMany({
    where: {
      createdAt: { lt: new Date(now - days(settingNumber("CHAT_DAYS", 60))) },
      events: { none: {} },
    },
    data: { original: "[expired]", result: null, status: "expired" },
  });
  await db.debugLog.deleteMany({
    where: {
      createdAt: { lt: new Date(now - days(settingNumber("DEBUG_DAYS", 90))) },
    },
  });
  await db.session.deleteMany({
    where: {
      OR: [
        {
          lastSeen: {
            lt: new Date(now - days(settingNumber("SESSION_IDLE_DAYS", 15))),
          },
        },
        {
          createdAt: {
            lt: new Date(now - days(settingNumber("SESSION_MAX_DAYS", 30))),
          },
        },
      ],
    },
  });
  await mkdir(root, { recursive: true, mode: 0o700 });
  const name = new Date().toISOString().slice(0, 10),
    destination = `${root}/${name}`;
  if (!(await readdir(root)).includes(name)) {
    const temp = `${root}/.${name}.tmp`;
    await rm(temp, { recursive: true, force: true });
    await mkdir(temp, { mode: 0o700 });
    const database = (
      process.env.DATABASE_URL || "file:/app/data/nora.db"
    ).replace(/^file:/, "");
    execFileSync("sqlite3", [database, `.backup '${temp}/nora.db'`]);
    await cp(process.env.UPLOAD_DIR || "/app/data/uploads", `${temp}/uploads`, {
      recursive: true,
    }).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") throw e;
    });
    await rename(temp, destination);
  }
  const snapshots = (await readdir(root))
    .filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n))
    .sort()
    .reverse();
  for (const name of snapshots.slice(settingNumber("BACKUP_COUNT", 30)))
    await rm(`${root}/${name}`, { recursive: true, force: true });
}
run()
  .catch(async () => {
    await db.debugLog.create({ data: { code: "MAINTENANCE_FAILURE" } });
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
