import assert from "node:assert/strict";
import {test} from "node:test";
import {readFile} from "node:fs/promises";
import {getZoomByScale} from "../src/core/map-scale.js";
import {MM_TO_PX} from "../src/core/pen-width.js";
import {evaluate} from "./helpers/pen-expressions.js";
const assets = new URL("../static/maplibre/", import.meta.url);
for (const code of [3512,3513,3518,3527]) for (const level of [250,500,1000]) test(`${code}/${level} has a calibrated individual icon`, async()=>{
 const style=JSON.parse(await readFile(new URL(`style-${level}.json`,assets)));
 const layer=style.layers.find(l=>l.id===`dm-${code}-point-${level}-symbol-point`);
 assert.ok(layer);assert.equal(layer.type,"symbol");
 const diameter=code===3513?(level===1000?2:3):(level===1000?2.5:4);
 assert.equal(layer.metadata["dm:icon-dimensions-mm"].diameter,diameter);
 const canvas=evaluate(layer.layout["icon-size"],{},getZoomByScale(level,36))*32/MM_TO_PX;
 assert.ok(Math.abs(canvas-6)<1e-8);
});
for (const level of [250,500,1000,2500,5000]) test(`3523/${level} has the specified cross dimensions and crossbar height`,async()=>{
 const spec=JSON.parse(await readFile(new URL("symbol-spec.json",assets))).symbols.find(s=>s.code===3523);
 assert.ok(spec);
 const variant=spec.variants?.find(v=>v.level===level);const d=variant?.dimensionsMm??spec.dimensionsMm;
 assert.deepEqual(d,level<=500?{width:4,height:4,topToBar:1.5,bottomToBar:2.5}:{width:2.5,height:2.5,topToBar:1,bottomToBar:1.5});
 const paths=variant?.paths??spec.paths;
 const nums=paths[0].d.match(/-?\d+(?:\.\d+)?/g).map(Number);const [x1,y1,x2,y2]=nums;
 const bar=paths[1].d.match(/-?\d+(?:\.\d+)?/g).map(Number);
 assert.equal(y2-y1,d.height);assert.equal(x1,x2);assert.equal(bar[2]-bar[0],d.width);
 assert.equal(bar[1]-y1,d.topToBar);assert.equal(y2-bar[1],d.bottomToBar);
});
