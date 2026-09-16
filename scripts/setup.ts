import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { db } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";
let muted = false;
const output = new Writable({
  write(chunk, _encoding, callback) {
    if (!muted) process.stdout.write(chunk);
    callback();
  },
});
const rl = createInterface({ input: process.stdin, output, terminal: true });
async function ask(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  muted = true;
  return new Promise((resolve) =>
    rl.question("", (answer) => {
      muted = false;
      process.stdout.write("\n");
      resolve(answer);
    }),
  );
}
try {
  const password = await ask("New Nora password (at least 12 characters): ");
  const confirm = await ask("Confirm password: ");
  if (password.length < 12 || password !== confirm)
    throw new Error("Passwords must match and contain at least 12 characters.");
  const value=hashPassword(password);
  await db.$transaction([db.setting.upsert({
    where: { key: "password" },
    create: { key: "password", value },
    update: { value },
  }), db.session.deleteMany(), db.loginAttempt.deleteMany()]);
  console.log("Password set. All previous sessions revoked.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Setup failed");
  process.exitCode = 1;
} finally {
  rl.close();
  await db.$disconnect();
}
