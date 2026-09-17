import { afterEach, expect, it, vi } from "vitest";
import { writeBarcode } from "zxing-wasm/writer";
import { decodeRetailBarcode, lookupFoodProduct } from "../src/lib/barcode";

afterEach(() => vi.unstubAllGlobals());

it("decodes a retail EAN-13 image locally", async () => {
  const written = await writeBarcode("3017620422003", {
    format: "EAN13",
    scale: 4,
    addQuietZones: true,
  });
  expect(written.image).not.toBeNull();
  const image = new Uint8Array(await written.image!.arrayBuffer());
  await expect(decodeRetailBarcode(image)).resolves.toBe("3017620422003");
});

it("looks up only a fixed barcode path and returns bounded product metadata", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        product: {
          product_name: "Fixture yogurt",
          brands: "Fixture Dairy",
          quantity: "500 g",
          categories_tags: Array.from({ length: 20 }, (_, i) => `tag-${i}`),
        },
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  const product = await lookupFoodProduct("3017620422003");
  expect(product).toMatchObject({
    barcode: "3017620422003",
    name: "Fixture yogurt",
  });
  expect(product.categories).toHaveLength(8);
  const [url, options] = fetchMock.mock.calls[0];
  expect(String(url)).toContain("/api/v3/product/3017620422003");
  expect(options.headers["User-Agent"]).toContain("Nora/");
});
