import assert from "node:assert/strict";
import {test} from "node:test";
import {readFile} from "node:fs/promises";
import {getZoomByScale} from "../src/core/map-scale.js";
import {MM_TO_PX} from "../src/core/pen-width.js";
import {evaluate} from "./helpers/pen-expressions.js";
for (const code of [2425, 2428]) for (const level of [250, 500, 1000]) test(`${code}/${level} repeats 1 mm strokes and 0.5 mm gaps`, async () => {
 const style = JSON.parse(await readFile(new URL(`../static/maplibre/style-${level}.json`, import.meta.url)));
 const line = style.layers.find(layer => layer.id === `dm-${code}-line-${level}-line`);
 assert.deepEqual(line.metadata["dm:dash-mm"], [1, 0.5]);
 assert.equal(line.layout["line-cap"], "butt");
 for (const offset of [0, 1, 2]) {
  const width = evaluate(line.paint["line-width"], {}, getZoomByScale(level, 36) + offset) / MM_TO_PX / 2 ** offset;
  for (const [index, mm] of [1, 0.5].entries()) assert.ok(Math.abs(line.paint["line-dasharray"][index] * width - mm) < 1e-6);
 }
});
