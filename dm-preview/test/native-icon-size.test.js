import assert from 'node:assert/strict';import{test}from'node:test';import{readFile}from'node:fs/promises';import{Resvg}from'@resvg/resvg-js';import{calibratedNativeSvg}from'../scripts/maplibre-assets/native-size.mjs';
test('3560 has a 4.5 by 3 mm shape independent of the SVG transparent padding',async()=>{const source=await readFile(new URL('../static/maplibre/icons/source/3560.svg',import.meta.url),'utf8');const r=calibratedNativeSvg(source,{width:4.5,height:3},4);assert.equal(r.width,4.5);assert.ok(Math.abs(r.height-3)<1e-10);assert.equal(r.canvas,5.5);const bbox=new Resvg(r.svg.replaceAll(/stroke-width="[^"]+"/g,'stroke-width="0.000001"')).getBBox();assert.ok(Math.abs(bbox.width-4.5)<1e-5);assert.ok(Math.abs(bbox.height-3)<1e-5);assert.equal(/<text/.test(r.svg),false);});
test('single-axis dimensions retain aspect ratio and invalid vector paths fail explicitly',()=>{const source='<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 12 12"><path d="M 2 2 L 6 2 L 6 4 L 2 4 Z" fill="black"/></svg>';const a=calibratedNativeSvg(source,{width:4},3),b=calibratedNativeSvg(source,{height:2},3);assert.equal(a.width,4);assert.equal(a.height,2);assert.equal(b.width,4);assert.equal(b.height,2);assert.throws(()=>calibratedNativeSvg('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"/>',{width:2},3),/empty/);});
test('native 3560 styles use a calibrated paper canvas at both reference scales',async()=>{const{getZoomByScale}=await import('../src/core/map-scale.js');const{evaluate}=await import('./helpers/pen-expressions.js');for(const level of [500,1000]){const style=JSON.parse(await readFile(new URL(`../static/maplibre/style-${level}.json`,import.meta.url)));const l=style.layers.find(l=>l['source-layer']==='dm_3560_point');assert.equal(l.metadata['dm:icon-native-size'].width,4.5);assert.equal(l.metadata['dm:icon-native-size'].height,3);assert.ok(Math.abs(evaluate(l.layout['icon-size'],{},getZoomByScale(level,36))*32/(96/25.4)-5.5)<1e-8);}});
test('white SVG backgrounds and default stroke widths do not distort calibration',()=>{
 const s='<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path fill="white" d="M0 0 L100 0 L100 100 L0 100 Z"/><path fill="none" stroke="black" d="M20 20 L40 20 L40 30 L20 30 Z"/></svg>';
 const r=calibratedNativeSvg(s,{width:2},3);assert.ok(Math.abs(r.height-1)<1e-6);assert.match(r.svg,/stroke-width="0.15000000000000002"/);
 const reference=calibratedNativeSvg(s,{referenceLength:{source:20,paper:2}},3);assert.ok(Math.abs(reference.width-2)<1e-5);
 assert.throws(()=>calibratedNativeSvg(s,{},3),/positive/);
});
test('6318 contains three hollow circles whose outer diameter is 0.4 mm',async()=>{
 const source=await readFile(new URL('../static/maplibre/icons/source/6318-native.svg',import.meta.url),'utf8'),r=calibratedNativeSvg(source,{width:2.3},2);
 const paths=[...r.svg.matchAll(/<path\b[^>]*>/g)];assert.equal(paths.length,3);
 for(const [path]of paths){const b=new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="-2 -2 4 4">${path}</svg>`).getBBox();assert.ok(Math.abs(b.width-.4)<1e-5);assert.ok(Math.abs(b.height-.4)<1e-5);assert.match(path,/fill="none"/);}
});
const nativeSpec=JSON.parse(await readFile(new URL('../static/maplibre/native-icon-sizes.json',import.meta.url)));
for(const [code,spec]of Object.entries(nativeSpec.codes))for(const level of [500,1000])test(`native icon ${code}/${level} uses its own PDF paper dimensions`,async()=>{
 const {getZoomByScale}=await import('../src/core/map-scale.js');const {evaluate}=await import('./helpers/pen-expressions.js');
 const style=JSON.parse(await readFile(new URL(`../static/maplibre/style-${level}.json`,import.meta.url)));
 const layer=style.layers.find(l=>l['source-layer']===`dm_${code}_point`);assert.ok(layer);
 const dims=layer.metadata['dm:icon-native-size'];assert.ok(dims);
 for(const axis of ['width','height'])if(spec[level][axis])assert.ok(Math.abs(dims[axis]-spec[level][axis])<1e-9);
 const canvas=layer.metadata['dm:icon-canvas-mm'];assert.ok(Math.abs(evaluate(layer.layout['icon-size'],{},getZoomByScale(level,36))*32/(96/25.4)-canvas)<1e-8);
 const variants=JSON.parse(await readFile(new URL('../static/maplibre/pen-icon-variants.json',import.meta.url))).variants;
 const variant=variants.find(v=>v.id===layer.layout['icon-image']);assert.deepEqual(variant.nativeSize,spec[level]);
 const index=JSON.parse(await readFile(new URL('../static/maplibre/sprite/sprite.json',import.meta.url)));assert.ok(index[variant.id]);
});
