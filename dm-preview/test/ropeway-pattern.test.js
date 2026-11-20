import assert from "node:assert/strict";
import {test} from "node:test";
import {readFile} from "node:fs/promises";
import {getZoomByScale} from "../src/core/map-scale.js";
import {MM_TO_PX} from "../src/core/pen-width.js";
import {evaluate} from "./helpers/pen-expressions.js";
const readStyle = async level => JSON.parse(await readFile(new URL(`../static/maplibre/style-${level}.json`, import.meta.url), "utf8"));
for (const level of [250, 500, 1000]) test(`2306/${level} draws the shared attached-triangle pattern as generated linework`, async () => {
  const style = await readStyle(level);
  const base = style.layers.find(layer => layer.id === `dm-2306-line-${level}-line`);
  const pattern = style.layers.find(layer => layer.id === `dm-2306-line-${level}-decoration`);
  assert.ok(base); assert.ok(pattern);
  assert.equal(pattern.type, "line");
  assert.equal(pattern["source-layer"], "dm_2306_line_deco_line");
  assert.deepEqual(pattern.filter, ["all", ["==", ["get", "LEVEL"], level], ["==", ["get", "DECORATION"], "attached_triangles"]]);
  assert.equal(pattern.metadata["dm:triangle-base-mm"], .8);
  assert.equal(pattern.metadata["dm:triangle-side-mm"], .5);
  assert.equal(pattern.metadata["dm:triangle-height-mm"], .3);
  assert.equal(pattern.metadata["dm:triangle-interval-mm"], 10);
  for (const layer of [base, pattern]) {
    assert.equal(layer.paint["line-dasharray"], undefined);
    assert.equal(layer.paint["line-color"], "#000000");
    assert.ok(Math.abs(evaluate(layer.paint["line-width"], {}, getZoomByScale(level, 36)) / MM_TO_PX - .15) < 1e-8);
  }
});
test("2306 retains the existing 2500/5000 pattern styles and two-pen strokes", async () => {
  for (const level of [2500, 5000]) {
    const layer = (await readStyle(level)).layers.find(layer => layer.id === `dm-2306-line-${level}-decoration`);
    assert.ok(layer); assert.deepEqual(layer.filter, ["==", ["get", "LEVEL"], level]);
    assert.ok(Math.abs(evaluate(layer.paint["line-width"], {}, getZoomByScale(level, 36)) / MM_TO_PX - .1) < 1e-8);
  }
});
