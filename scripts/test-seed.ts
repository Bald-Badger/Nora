import { db } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";
if (process.env.DATABASE_URL !== "file:/tmp/nora-e2e.db")
  throw new Error("Fixture only supports the isolated test database.");
async function main() {
  await db.setting.upsert({
    where: { key: "password" },
    create: { key: "password", value: hashPassword("nora-test-fixture-only") },
    update: { value: hashPassword("nora-test-fixture-only") },
  });
}
main().finally(() => db.$disconnect());
