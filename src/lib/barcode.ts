import { readBarcodes } from "zxing-wasm/reader";

export async function decodeRetailBarcode(image: Uint8Array) {
  const results = await readBarcodes(image, {
    formats: ["EAN13", "EAN8", "UPCA", "UPCE"],
    tryHarder: true,
    maxNumberOfSymbols: 4,
  });
  const code = results
    .map((result) => result.text.replace(/\D/g, ""))
    .find((text) => text.length >= 8 && text.length <= 14);
  if (!code) throw new Error("BARCODE_NOT_FOUND");
  return code;
}

export async function lookupFoodProduct(code: string) {
  const url = new URL(
    `https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(code)}`,
  );
  url.searchParams.set(
    "fields",
    "product_name,brands,quantity,categories_tags",
  );
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: {
      "User-Agent": "Nora/0.1 (private home inventory; shuainium.com)",
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error("BARCODE_PRODUCT_NOT_FOUND");
  const data = await response.json();
  const product = data.product;
  const name = String(product?.product_name || "").trim();
  if (!name) throw new Error("BARCODE_PRODUCT_NOT_FOUND");
  return {
    barcode: code,
    name,
    brand: String(product.brands || "").trim(),
    packageQuantity: String(product.quantity || "").trim(),
    categories: Array.isArray(product.categories_tags)
      ? product.categories_tags.slice(0, 8)
      : [],
  };
}
