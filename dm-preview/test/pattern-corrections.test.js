import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {getZoomByScale} from '../src/core/map-scale.js';
import {MM_TO_PX} from '../src/core/pen-width.js';
import {evaluate} from './helpers/pen-expressions.js';
const read=async level=>JSON.parse(await readFile(new URL(`../static/maplibre/style-${level}.json`,import.meta.url)));
for(const level of [250,500,1000,2500,5000])test(`corrected circle patterns and drawing classes at ${level}`,async()=>{
 const s=await read(level),find=id=>s.layers.find(l=>l.id===`dm-${id.replaceAll('{n}',level)}`),z=getZoomByScale(level,36);
 const power=find('4265-line-{n}-power_line_circle');assert.equal(power.metadata['dm:normal-offset-mm'],.45);
 for(const code of [5232,5226]){
  const circle=find(code===5232?'5232-polygon-{n}-inner_boundary_circle':'5226-line-{n}-waterfall_circle_03');assert.ok(circle);
  const diameter=code===5232&&level>1000?.5:.3;
  assert.ok(Math.abs((evaluate(circle.paint['circle-radius'],{},z)+evaluate(circle.paint['circle-stroke-width'],{},z))*2/MM_TO_PX-diameter)<1e-8);
 }
 const boundary=find('5232-polygon-{n}-line');assert.equal(boundary.paint['line-opacity'],0);
 if(level>=2500){
  assert.deepEqual(find('5226-line-{n}-line-line').filter,['all',['==',['get','LEVEL'],level],['!=',['get','DMFIGTYPE'],12]]);
  assert.deepEqual(find('5227-line-{n}-figtype-11').metadata['dm:dash-mm'],[1,1]);
 }else{
  const pipe=find('4262-line-{n}-pipe_center_circle');assert.equal(pipe.paint['circle-color'],'#000000');assert.equal(pipe.metadata['dm:circle-diameter-mm'],.3);
  assert.equal(find('6132-line-{n}-guardrail_semicircle')['source-layer'],'dm_6132_line_deco_polygon');assert.equal(find('6132-line-{n}-guardpipe_circle').metadata['dm:circle-diameter-mm'],.3);
  const parentheses=find('5204-point-{n}-text'),letter=find('5204-point-{n}-text-letter');
  assert.equal(parentheses.layout['text-field'],'(');const right=find('5204-point-{n}-text-right-parenthesis');assert.equal(right.layout['text-field'],')');assert.deepEqual(right.layout['text-offset'],[17/24,5.5/24]);assert.deepEqual(parentheses.layout['text-offset'],[-18/24,5.5/24]);assert.equal(letter.layout['text-field'],'浮');
  assert.equal(-5.5+24*parentheses.layout['text-offset'][1],0);assert.equal(-5+24*letter.layout['text-offset'][1],0);
 }
});
test('coastal waves start and end at troughs with three full humps and half-period row shift',async()=>{
 const spec=JSON.parse(await readFile(new URL('../static/maplibre/symbol-spec.json',import.meta.url)));
 const paths=spec.symbols.find(s=>s.code===5106).paths;
 for(const {d} of paths){assert.equal((d.match(/ C /g)||[]).length,6);const values=d.match(/-?\d+(?:\.\d+)?/g).map(Number);assert.equal(values[1],values.at(-1));assert.equal(values.at(-2)-values[0],9);assert.equal(Math.max(...values.filter((_,i)=>i%2))-Math.min(...values.filter((_,i)=>i%2)),.5);}
});
