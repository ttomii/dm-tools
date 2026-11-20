import assert from "node:assert/strict";
import {test} from "node:test";
import {readFile} from "node:fs/promises";
import {Resvg} from "@resvg/resvg-js";

const assets = new URL("../static/maplibre/", import.meta.url);

test("bus-stop SVG rasterizes a hollow circle, lower stem and base without an upper stem", async () => {
  const svg = await readFile(new URL("icons/source/2221.svg", assets), "utf8");
  const rendered = new Resvg(svg, {fitTo: {mode: "zoom", value: 0.5}}).render();
  assert.equal(rendered.width, 32); assert.equal(rendered.height, 32);
  const pixels = rendered.pixels;
  const alpha = (x, y) => pixels[(y * rendered.width + x) * 4 + 3];
  assert.equal(alpha(16, 6), 0, "circle interior must be empty");
  assert.equal(alpha(16, 0), 0, "the symbol has no upper stem");
  assert.ok(alpha(19, 6) > 0, "circle outline must exist");
  assert.ok(alpha(16, 16) > 0, "lower stem must exist");
  assert.ok(alpha(13, 26) > 0, "horizontal base must exist");
});

test("both sprite resolutions contain the bus-stop base and all calibrated variants", async () => {
  const variants = JSON.parse(await readFile(new URL("pen-icon-variants.json", assets), "utf8")).variants.filter(item => item.baseId === "dm-2221");
  assert.deepEqual(variants.map(item => item.level), [250, 500, 1000]);
  for (const ratio of [1, 2]) {
    const atlas = JSON.parse(await readFile(new URL(`sprite/sprite${ratio === 2 ? "@2x" : ""}.json`, assets), "utf8"));
    for (const id of ["dm-2221", ...variants.map(item => item.id)]) {
      assert.ok(atlas[id], id); assert.equal(atlas[id].pixelRatio, ratio);
      assert.equal(atlas[id].width, 32 * ratio); assert.equal(atlas[id].height, 32 * ratio);
    }
  }
});
