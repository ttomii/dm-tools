import assert from "node:assert/strict";
import {test} from "node:test";
import {resolveDefaultAssetRoot} from "../src/node/asset-roots.js";

test("uses packaged assets next to the executable when available", () => {
  assert.equal(
    resolveDefaultAssetRoot("/package", (file) => file === "/package/assets/index.html"),
    "/package",
  );
});

test("uses source static assets when packaged assets are unavailable", () => {
  assert.equal(resolveDefaultAssetRoot("/package", () => false), "/package/static");
});
