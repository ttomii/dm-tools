import assert from "node:assert/strict";
import {test} from "node:test";
import {createDefaultAssetRoots, resolveDefaultAssetRoot} from "../src/node/asset-roots.js";

test("uses packaged assets next to the executable when available", () => {
  assert.equal(
    resolveDefaultAssetRoot("/package", (file) => file === "/package/assets/index.html"),
    "/package",
  );
});

test("uses source static assets when packaged assets are unavailable", () => {
  assert.equal(resolveDefaultAssetRoot("/package", () => false), "/package/static");
});

test("resolves MapLibre 6 ES modules as vendor assets", () => {
  const {vendorFiles} = createDefaultAssetRoots();

  assert.match(vendorFiles.get("/vendor/maplibre-gl.mjs"), /maplibre-gl\.mjs$/);
  assert.match(vendorFiles.get("/vendor/maplibre-gl-shared.mjs"), /maplibre-gl-shared\.mjs$/);
  assert.match(vendorFiles.get("/vendor/maplibre-gl-worker.mjs"), /maplibre-gl-worker\.mjs$/);
  assert.equal(vendorFiles.has("/vendor/maplibre-gl.js"), false);
});
