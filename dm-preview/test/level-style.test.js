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

test("5000 data keeps a distinct interval between 2500 and 10000", () => {
  const style = createLevelStyle(templates, {levels: [2500, 5000, 10000], center: [138, 35, 15]});
  const line = (level) => style.layers.find((layer) => layer.id.endsWith(`-line-level-${level}`));
  const fine = line(2500), middle = line(5000), coarse = line(10000);
  assert.equal(fine.minzoom, middle.maxzoom);
  assert.equal(middle.minzoom, coarse.maxzoom);
  assert.ok(middle.minzoom > getZoomByScale(10000, 35));
  assert.ok(middle.minzoom < getZoomByScale(9999, 35));
  assert.ok(middle.maxzoom > getZoomByScale(5000, 35));
  assert.ok(middle.maxzoom < getZoomByScale(4999, 35));
  assert.ok(middle.minzoom < middle.maxzoom);
});

test("level 10000 coral keeps the base line when reusing the 5000 template", () => {
  const style = createLevelStyle(templates, {levels: [10000], center: [138, 35, 15]});
  const base = style.layers.find((layer) => layer.id === "dm-7214-line-5000-line-level-10000");
  const decoration = style.layers.find((layer) => layer.id === "dm-7214-line-5000-arc-symbols-level-10000");
  const eligible = ["in", ["get", "LEVEL"], ["literal", [2500, 5000]]];
  assert.equal(base.layout?.visibility ?? "visible", "visible");
  assert.deepEqual(base.filter, ["all", ["==", ["get", "LEVEL"], 10000], ["!", eligible]]);
  assert.deepEqual(decoration.filter, ["all", ["==", ["get", "LEVEL"], 10000], eligible]);
});
