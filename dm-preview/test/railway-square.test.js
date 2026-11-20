import assert from "node:assert/strict";
import {Resvg} from "@resvg/resvg-js";
import {test} from "node:test";
import {readFile} from "node:fs/promises";
import {getZoomByScale} from "../src/core/map-scale.js";
import {MM_TO_PX} from "../src/core/pen-width.js";
import {evaluate} from "./helpers/pen-expressions.js";
const assets = new URL("../static/maplibre/", import.meta.url);
for (const level of [250, 500, 1000]) test(`2401/${level} has a rotating 1 mm square point symbol`, async () => {
 const style = JSON.parse(await readFile(new URL(`style-${level}.json`, assets)));
 const layer = style.layers.find(layer => layer["source-layer"] === "dm_2401_point");
 assert.ok(layer); assert.equal(layer.type, "symbol");
 assert.equal(layer.metadata["dm:icon-dimensions-mm"].side, 1);
 assert.equal(layer.layout["icon-rotation-alignment"], "map");
 assert.deepEqual(layer.layout["icon-rotate"], ["coalesce", ["get", "ROTATION"], 0]);
 assert.deepEqual(layer.filter, ["==", ["get", "LEVEL"], level]);
 const canvas = evaluate(layer.layout["icon-size"], {}, getZoomByScale(level, 36)) * 32 / MM_TO_PX;
 assert.ok(Math.abs(canvas - 2) < 1e-8);
 const spec = JSON.parse(await readFile(new URL("symbol-spec.json", assets))).symbols.find(s => s.code === 2401);
 const svg = await readFile(new URL("icons/source/2401.svg", assets), "utf8");
 const image = new Resvg(svg).render(); const pixels = image.pixels;
 const xs = []; const ys = [];
 for (let y=0; y<96; y++) for (let x=0; x<96; x++) {
  const i=(y*96+x)*4;
  if (pixels[i+3]>128 && pixels[i]<128) { xs.push(x); ys.push(y); }
 }
 assert.equal((Math.max(...xs)-Math.min(...xs)+1)/48, 1);
 assert.equal((Math.max(...ys)-Math.min(...ys)+1)/48, 1);
 assert.equal(spec.paths[0].fill, "#ffffff");
 assert.ok(Math.abs(0.85 + spec.pen * 0.05 - 1) < 1e-8);
});
