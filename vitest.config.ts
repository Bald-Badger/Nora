import { defineConfig } from "vitest/config";
if (process.env.DATABASE_URL !== 'file:/tmp/nora-test.db') {
  throw new Error('Tests require DATABASE_URL=file:/tmp/nora-test.db; refusing to touch another database.');
}
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], fileParallelism: false },
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
});
