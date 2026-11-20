import assert from "node:assert/strict";
import {test} from "node:test";
import {readFile} from "node:fs/promises";
import {getZoomByScale} from "../src/core/map-scale.js";
import {MM_TO_PX} from "../src/core/pen-width.js";
import {evaluate} from "./helpers/pen-expressions.js";
for (const code of [2425, 2428]) for (const level of [250, 500, 1000]) test(`${code}/${level} repeats 1 mm strokes and 0.5 mm gaps`, async () => {
 const style = JSON.parse(await readFile(new URL(`../static/maplibre/style-${level}.json`, import.meta.url)));
 for (const kind of ["line", "polygon"]) {
   const outline = style.layers.find(layer => layer.id === `dm-${code}-${kind}-${level}-line`);
   assert.ok(outline, `missing ${kind} style`);
   assert.equal(outline["source-layer"], `dm_${code}_${kind}`);
   assert.equal(outline.type, "line");
   assert.deepEqual(outline.metadata["dm:dash-mm"], [1, 0.5]);
   assert.equal(outline.layout["line-cap"], "butt");
   for (const offset of [0, 1, 2]) {
     const width = evaluate(outline.paint["line-width"], {}, getZoomByScale(level, 36) + offset) / MM_TO_PX / 2 ** offset;
     for (const [index, mm] of [1, 0.5].entries()) {
       assert.ok(Math.abs(outline.paint["line-dasharray"][index] * width - mm) < 1e-6);
     }
   }
 }
});
