import assert from "node:assert/strict";
import {test} from "node:test";
import {readFile} from "node:fs/promises";
import {getZoomByScale} from "../src/core/map-scale.js";
import {MM_TO_PX} from "../src/core/pen-width.js";
import {evaluate} from "./helpers/pen-expressions.js";
for (const level of [250, 500, 1000]) test(`3403/${level} renders 0.3 mm hollow circles and a 3-pen outline`, async () => {
 const style = JSON.parse(await readFile(new URL(`../static/maplibre/style-${level}.json`, import.meta.url)));
 const circle = style.layers.find(l => l.id === `dm-3403-polygon-${level}-circles`);
 assert.ok(circle); assert.equal(circle.type, "circle");
 assert.equal(circle["source-layer"], "dm_3403_polygon_deco_point");
 assert.deepEqual(circle.filter, ["all", ["==", ["get", "LEVEL"], level], ["==", ["get", "DECORATION"], "staggered_circles"]]);
 const zoom = getZoomByScale(level, 36);
 const r = evaluate(circle.paint["circle-radius"], {}, zoom)/MM_TO_PX;
 const w = evaluate(circle.paint["circle-stroke-width"], {}, zoom)/MM_TO_PX;
 assert.ok(Math.abs(2*(r+w)-0.3)<1e-8); assert.ok(Math.abs(w-0.1)<1e-8);
 assert.equal(circle.paint["circle-color"], "#ffffff");
 assert.equal(circle.paint["circle-stroke-color"], "#000000");
 const outline = style.layers.find(l => l.id === `dm-3403-polygon-${level}-line`);
 assert.ok(Math.abs(evaluate(outline.paint["line-width"], {}, zoom)/MM_TO_PX-0.15)<1e-8);
});
test("3403 has no generated circle style at levels 2500 and 5000", async () => {
 for (const level of [2500, 5000]) {
  const style = JSON.parse(await readFile(new URL(`../static/maplibre/style-${level}.json`, import.meta.url)));
  assert.equal(style.layers.some(l => l["source-layer"] === "dm_3403_polygon_deco_point"), false);
 }
});
