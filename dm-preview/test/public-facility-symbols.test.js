import assert from "node:assert/strict";
import {test} from "node:test";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {getZoomByScale} from "../src/core/map-scale.js";
import {MM_TO_PX} from "../src/core/pen-width.js";
import {evaluate} from "./helpers/pen-expressions.js";
const assets=new URL('../static/maplibre/',import.meta.url);
const codes=[3528,3529,3552,3559,4101,4111,4119,4121,4131,4132,4141,4142,4151,4161,4208,4215,4224,4226,4238,4245,4231,4227,3556,4228];
for(const code of codes) for(const level of code===4227?[250,500]:[250,500,1000]) test(`${code}/${level} has a complete native point icon`,async()=>{
 const style=JSON.parse(await readFile(new URL(`style-${level}.json`,assets)));
 const layer=style.layers.find(l=>l.id===`dm-${code}-point-${level}-symbol-point`);
 assert.ok(layer);assert.equal(layer.type,'symbol');assert.equal(layer['source-layer'],`dm_${code}_point`);
 assert.deepEqual(layer.filter,['==',['get','LEVEL'],level]);
 const canvas=evaluate(layer.layout['icon-size'],{},getZoomByScale(level,36))*32/MM_TO_PX;
 assert.ok(Math.abs(canvas-layer.metadata['dm:icon-canvas-mm'])<1e-8);
 const atlas=JSON.parse(await readFile(new URL('sprite/sprite.json',assets)));
 assert.ok(atlas[layer.layout['icon-image']]);
});
test('4231 uses a 2 mm circle and the katakana タ; 4227 applies only to 500',async()=>{
 const spec=JSON.parse(await readFile(new URL('symbol-spec.json',assets)));
 const tank=spec.symbols.find(s=>s.code===4231);assert.ok(tank);
 assert.equal(tank.dimensionsMm.diameter,2);assert.equal(tank.fixedLabel,'タ');
 assert.ok(Math.abs(tank.dimensionsMm.circleCenterlineDiameter+tank.pen*0.05-2)<1e-8);
 assert.deepEqual(spec.symbols.find(s=>s.code===4227).levels,[500]);
});
test('pump and crane have large-scale geometry instead of their coarse symbols',async()=>{
 const spec=JSON.parse(await readFile(new URL('symbol-spec.json',assets)));
 const pump=spec.symbols.find(s=>s.code===3556);assert.ok(pump);
 assert.equal(pump.dimensionsMm.baseWidth,4.5);assert.equal(pump.variants[0].dimensionsMm.baseWidth,3);
 assert.equal(pump.dimensionsMm.halfWidthInteriorStrokes,true);
 for(const variant of [pump,...pump.variants]) {
  const inner=variant.paths.filter(p=>p.strokeWidthMm===0.15);assert.equal(inner.length,2);
  for(const path of inner) {
   const [x1,y1,x2,y2]=path.d.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g).map(Number);
   assert.equal(x1,0);assert.ok(x2>0);assert.equal(y1,y2);
  }
 }
 const crane=spec.symbols.find(s=>s.code===4228);assert.ok(crane);
 assert.equal(crane.dimensionsMm.baseWidth,1.2);assert.equal(crane.dimensionsMm.baseHeight,1.2);
 assert.equal(crane.dimensionsMm.boomRise,2.1);assert.equal(crane.dimensionsMm.hookDiameter,0.5);
});

const coarseHashes={"3556": "9dfd7c6a362aa80b4141c1ddabf02d232ec23af6680f27302438e0d30df7db94", "4228": "e3c401052f670679c45d1824da503f4f64087374d78e088d6186fca6a5c417fa", "4208": "88281004d05e9157e5727361dbf42e3600c4532514ab615be4a8517d02aff66b"};
for(const [code,hash] of Object.entries(coarseHashes)) for(const level of [2500,5000]) test(`${code}/${level} retains the original coarse image`,async()=>{
 const source=await readFile(new URL(`icons/source/${code}-level-${level}.svg`,assets));
 assert.equal(createHash('sha256').update(source).digest('hex'),hash);
 const style=JSON.parse(await readFile(new URL(`style-${level}.json`,assets)));
 const layer=style.layers.find(l=>l['source-layer']===`dm_${code}_point` && l.type==='symbol');
 assert.equal(layer.metadata['dm:icon-base'],`dm-${code}-level-${level}`);
});
