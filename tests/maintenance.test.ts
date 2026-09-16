import { it, expect, afterAll } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  access,
  readdir,
  rm,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { db, days } from "../src/lib/db";
afterAll(() => db.$disconnect());
it("cleans retained data, preserves audit events, and creates a restorable SQLite snapshot", async () => {
  const folder = await mkdtemp("/tmp/nora-maintenance-");
  const uploads = `${folder}/uploads`,
    backups = `${folder}/backups`;
  await mkdir(uploads);
  await mkdir(backups);
  try {
    const processing = await db.processing.create({
      data: {
        requestId: crypto.randomUUID(),
        original: "Permanent audit source",
        promptVersion: "test",
        model: "test",
        baseRevision: 0,
      },
    });
    await db.event.create({
      data: {
        processingId: processing.id,
        itemId: "historical",
        action: "add",
        after: "{}",
      },
    });
    await writeFile(`${uploads}/old.png`, "old");
    await writeFile(`${uploads}/new.png`, "new");
    await db.upload.create({
      data: {
        processingId: processing.id,
        path: `${uploads}/old.png`,
        mime: "image/png",
        createdAt: new Date(Date.now() - days(31)),
      },
    });
    await db.upload.create({
      data: {
        processingId: processing.id,
        path: `${uploads}/new.png`,
        mime: "image/png",
      },
    });
    const old = await db.message.create({
      data: {
        role: "user",
        content: "old chat",
        createdAt: new Date(Date.now() - days(61)),
      },
    });
    for (let i = 1; i <= 31; i++)
      await mkdir(`${backups}/2020-01-${String(i).padStart(2, "0")}`);
    execFileSync(
      "node",
      ["node_modules/tsx/dist/cli.mjs", "scripts/maintenance.ts"],
      {
        env: { ...process.env, UPLOAD_DIR: uploads, BACKUP_DIR: backups },
        stdio: "pipe",
      },
    );
    expect(await db.message.findUnique({ where: { id: old.id } })).toBeNull();
    expect(
      await db.event.count({ where: { processingId: processing.id } }),
    ).toBe(1);
    await expect(access(`${uploads}/old.png`)).rejects.toThrow();
    await access(`${uploads}/new.png`);
    const name = new Date().toISOString().slice(0, 10);
    expect(
      execFileSync(
        "sqlite3",
        [`${backups}/${name}/nora.db`, "PRAGMA integrity_check;"],
        { encoding: "utf8" },
      ).trim(),
    ).toBe("ok");
    await access(`${backups}/${name}/uploads/new.png`);
    expect((await readdir(backups)).length).toBe(30);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
