import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";
import {createLevelStyle} from "../src/core/level-style.js";
import {getZoomByScale} from "../src/core/map-scale.js";

const templates = Object.fromEntries(await Promise.all([2500, 5000].map(async (level) => [
  level, JSON.parse(await readFile(new URL(`../static/maplibre/style-${level}.json`, import.meta.url))),
])));

for (const coarse of [5000, 10000]) {
  test(`switches 2500 and ${coarse} strictly above the coarser presentation scale`, () => {
    const style = createLevelStyle(templates, {levels: [coarse, 2500], center: [138, 35, 15]});
    const fine = style.layers.find((layer) => layer.source === "dm");
    const large = style.layers.find((layer) => layer.id.endsWith(`-level-${coarse}`));
    const boundary = getZoomByScale(Math.min(coarse, 5000), 35);
    assert.ok(fine.minzoom > boundary);
    assert.ok(large.maxzoom > boundary);
    assert.equal(fine.minzoom, large.maxzoom);
    assert.ok(JSON.stringify(large.filter).includes(`["get","LEVEL"],${coarse}`));
    const original = templates[5000].layers.find((layer) => layer.source === "dm");
    assert.equal(large.paint["line-width"][4], original.paint["line-width"][4] / 2);
    assert.equal(large.paint["line-width"][3], original.paint["line-width"][3] - Math.log2(coarse / 5000) - 1);
  });
}

test("a single 10000 level uses 5000 symbols with doubled text and icon sizes", () => {
  const style = createLevelStyle(templates, {levels: [10000], center: [138, 35, 15]});
  for (const property of ["text-size", "icon-size"]) {
    const original = templates[5000].layers.find((layer) => layer.layout?.[property]);
    const result = style.layers.find((layer) => layer.id === `${original.id}-level-10000`);
    if (typeof original.layout[property] === "number") {
      assert.equal(result.layout[property], original.layout[property] * 2);
    } else {
      assert.equal(result.layout[property][4], original.layout[property][4] / 2);
      assert.equal(result.layout[property][3], original.layout[property][3] - 2);
    }
    if (original.minzoom !== undefined) assert.equal(result.minzoom, original.minzoom - 2);
  }
  assert.equal(templates[5000].metadata["dm:map-level"], 5000);
});

test("coarse lines remain visible at z12 and halve their width from z13", () => {
  const style = createLevelStyle(templates, {levels: [2500, 10000], center: [138, 35, 15]});
  const line = style.layers.find((layer) => layer.id === "dm-default-line-5000-line-level-10000");
  assert.equal(line.minzoom, 12);
  assert.equal(line.paint["line-width"][3], 12);
  assert.equal(line.paint["line-width"][5], 13);
  assert.equal(line.paint["line-width"][4], line.paint["line-width"][6] / 2);
});
