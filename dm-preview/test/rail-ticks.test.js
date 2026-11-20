import assert from "node:assert/strict";
import {test} from "node:test";
import {readFile} from "node:fs/promises";
import {getZoomByScale} from "../src/core/map-scale.js";
import {MM_TO_PX} from "../src/core/pen-width.js";
import {evaluate} from "./helpers/pen-expressions.js";

const readStyle = async level => JSON.parse(await readFile(new URL(`../static/maplibre/style-${level}.json`, import.meta.url), "utf8"));

for (const level of [250, 500, 1000]) for (const code of [2304, 2305]) {
  test(`${code}/${level} draws the original centerline and generated 2 mm ticks without a dash approximation`, async () => {
    const style = await readStyle(level);
    const base = style.layers.find(layer => layer.id === `dm-${code}-line-${level}-line`);
    const ticks = style.layers.find(layer => layer.id === `dm-${code}-line-${level}-decoration`);
    assert.ok(base); assert.ok(ticks);
    assert.equal(ticks.type, "line");
    assert.equal(ticks["source-layer"], `dm_${code}_line_deco_line`);
    assert.deepEqual(ticks.filter, ["all", ["==", ["get", "LEVEL"], level], ["==", ["get", "DECORATION"], "perpendicular_tick"]]);
    assert.equal(ticks.metadata["dm:tick-length-mm"], 2);
    assert.equal(ticks.metadata["dm:tick-interval-mm"], 10);
    assert.equal(ticks.layout["line-cap"], "butt");
    const zoom = getZoomByScale(level, 36);
    for (const layer of [base, ticks]) {
      assert.equal(layer.paint["line-dasharray"], undefined);
      assert.equal(layer.paint["line-color"], "#000000");
      assert.ok(Math.abs(evaluate(layer.paint["line-width"], {}, zoom) / MM_TO_PX - (code === 2304 ? .4 : .3)) < 1e-8);
    }
  });
}

test("large-scale rail tick styles do not add a 2304 decoration at 2500/5000 or change existing 2305 coarse styling", async () => {
  for (const level of [2500, 5000]) {
    const style = await readStyle(level);
    assert.equal(style.layers.some(layer => layer.id === `dm-2304-line-${level}-decoration`), false);
    const ticks = style.layers.find(layer => layer.id === `dm-2305-line-${level}-decoration`);
    assert.ok(ticks);
    assert.deepEqual(ticks.filter, ["==", ["get", "LEVEL"], level]);
    assert.equal(ticks.metadata["dm:pen-number"], 6);
  }
});
