import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {getZoomByScale} from '../src/core/map-scale.js';
import {MM_TO_PX} from '../src/core/pen-width.js';
import {evaluate} from './helpers/pen-expressions.js';
const read=async level=>JSON.parse(await readFile(new URL(`../static/maplibre/style-${level}.json`,import.meta.url)));
const texts=new Map([[6211,['(空)',3]],[6212,['(駐)',3]],[6213,['(花)',2]],[6231,['採石場',2.5]],[6232,['土取場',2.5]],[6233,['採鉱地',2.5]],[6340,['S',1.5]],[6341,['S',1.5]],[6342,['G',1.5]]]);
for(const level of [250,500,1000]){
 test(`enclosure patterns have generated layers and correct baselines ${level}`,async()=>{
  const s=await read(level);
  for(const code of [6133,6134,6136,6137,6140,6141,6142,7108,7199])assert.ok(s.layers.some(l=>l.metadata?.['dm:pattern-code']===code),String(code));
  for(const code of [6134,6141,6142,7105,7106]){const l=s.layers.find(l=>l.id===`dm-${code}-line-${level}-line`);assert.ok(l);assert.equal(l.paint['line-dasharray'],undefined);}
  assert.equal(s.layers.find(l=>l.id===`dm-6136-line-${level}-line`).layout.visibility,'none');
  assert.equal(s.layers.find(l=>l.id===`dm-7108-line-${level}-line`).layout.visibility,'none');
  const dash=s.layers.find(l=>l.id===`dm-7108-line-${level}-depression_dash`);assert.ok(dash);assert.equal(dash.paint['line-dasharray'],undefined);
 });
 test(`land use labels have literal text and actual ink height ${level}`,async()=>{
  const s=await read(level);
  for(const [code,[text,height]]of texts){const l=s.layers.find(l=>l.id===`dm-${code}-point-${level}-text`);assert.ok(l,String(code));assert.equal(l.layout['text-field'],text);assert.deepEqual(l.layout['text-font'],['BIZ UDPGothic Regular']);assert.equal(l.layout['text-rotate'],0);const em=evaluate(l.layout['text-size'],{},getZoomByScale(level,36))/MM_TO_PX;assert.ok(Math.abs(em*l.metadata['dm:glyph-height-at-24px']/24-height)<1e-9);}
  for(const c of [6340,6341,6342])assert.deepEqual(s.layers.find(l=>l.id===`dm-${c}-point-${level}-text`).layout['text-offset'],[1/48,5/24]);
 });
 test(`native solar panel and grass icons exist ${level}`,async()=>{
  const s=await read(level);for(const code of [6217,6322])assert.ok(s.layers.some(l=>l.id===`dm-${code}-point-${level}-symbol-point`));
 });
}

test('shipped glyphs determine the ink height and centered S/G placement',async()=>{
 const {createRequire}=await import('node:module');const {pathToFileURL}=await import('node:url');
 const require=createRequire(import.meta.url), maplibre=createRequire(require.resolve('maplibre-gl/package.json'));
 const {PbfReader}=await import(pathToFileURL(maplibre.resolve('pbf')).href);
 const metrics=new Map();
 for(const char of new Set([...texts.values()].flatMap(([text])=>[...text]))){
  const id=char.codePointAt(0),first=Math.floor(id/256)*256;
  const data=await readFile(new URL(`../static/maplibre/glyphs/BIZ UDPGothic Regular/${first}-${first+255}.pbf`,import.meta.url));
  new PbfReader(data).readFields((tag,_,r)=>{if(tag===1)r.readMessage((tag,_,r)=>{if(tag===3){const glyph=r.readMessage((tag,g,r)=>{if(tag===1)g.id=r.readVarint();else if(tag===3)g.width=r.readVarint();else if(tag===4)g.height=r.readVarint();else if(tag===5)g.left=r.readSVarint();else if(tag===6)g.top=r.readSVarint();else if(tag===7)g.advance=r.readVarint();},{});if(glyph.id===id)metrics.set(char,glyph);}},{});},{});
  assert.ok(metrics.has(char),char);
 }
 const s=await read(500);
 for(const[code,[text,height]]of texts){
  const l=s.layers.find(l=>l.id===`dm-${code}-point-500-text`),gs=[...text].map(c=>metrics.get(c));
  const top=Math.min(...gs.map(g=>-g.top)),bottom=Math.max(...gs.map(g=>-g.top+g.height));
  assert.equal(bottom-top,code>=6340?20:23);
  const em=evaluate(l.layout['text-size'],{},getZoomByScale(500,36))/MM_TO_PX;
  assert.ok(Math.abs(em*(bottom-top)/24-height)<1e-9);
  assert.ok(Math.abs(-17+(top+bottom)/2+l.layout['text-offset'][1]*24)<1e-9);
  if(code>=6340){const g=gs[0];assert.ok(Math.abs(g.left+g.width/2-g.advance/2+l.layout['text-offset'][0]*24)<1e-9);}
 }
});
