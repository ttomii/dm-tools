import assert from 'node:assert/strict';import{test}from'node:test';import{readFile}from'node:fs/promises';
import{getZoomByScale}from'../src/core/map-scale.js';import{MM_TO_PX}from'../src/core/pen-width.js';import{evaluate}from'./helpers/pen-expressions.js';
const read=async n=>JSON.parse(await readFile(new URL(`../static/maplibre/style-${n}.json`,import.meta.url)));
for(const level of [250,500,1000]){
 test(`water and terrain native decorations exist at ${level}`,async()=>{const style=await read(level);for(const code of [4262,4265,5202,5211,5212,5226,5231,5232,6101,6102,6110,6111,6112,6113,6121,6122,6123,6130,6131,6132])assert.ok(style.layers.some(l=>l.metadata?.['dm:pattern-code']===code),`${code}/${level}`);
 for(const code of [5213,5214,5235,5237]){const l=style.layers.find(l=>l.id===`dm-${code}-line-${level}-line`);assert.ok(l);const mm=code===5235?[3,.5]:[3,1];assert.deepEqual(l.metadata['dm:dash-mm'],mm);const width=evaluate(l.paint['line-width'],{DMFIGTYPE:11},getZoomByScale(level,36))/MM_TO_PX;l.paint['line-dasharray'].forEach((v,i)=>assert.ok(Math.abs(v*width-mm[i])<1e-6));}
 });
 test(`upper and lower figure classes have separate line styles at ${level}`,async()=>{const style=await read(level);for(const [code,fig]of[[5226,12],[5227,11],[6101,12],[6102,12]]){const l=style.layers.find(l=>l.id===`dm-${code}-line-${level}-figtype-${fig}`);assert.ok(l);assert.deepEqual(l.metadata['dm:dash-mm'],[1,1]);assert.ok(JSON.stringify(l.filter).includes('DMFIGTYPE'));}});
 test(`floating pier text has calibrated 2 mm height at ${level}`,async()=>{const style=await read(level);const l=style.layers.find(l=>l.id===`dm-5204-point-${level}-text`);assert.ok(l);assert.equal(l.layout['text-field'],'(');const letter=style.layers.find(x=>x.id===l.id+'-letter');assert.equal(letter.layout['text-field'],'浮');assert.deepEqual(l.layout['text-offset'],[-18/24,5.5/24]);assert.deepEqual(letter.layout['text-offset'],[0,5/24]);assert.deepEqual(l.layout['text-font'],['BIZ UDPGothic Regular']);const size=evaluate(l.layout['text-size'],{},getZoomByScale(level,36))/MM_TO_PX;assert.ok(Math.abs(size*23/24-2)<1e-8);});
}
for(const level of [250,500,1000,2500,5000])test(`pipe and pier decorations have actual source layers at ${level}`,async()=>{const s=await read(level);assert.ok(s.layers.some(l=>l['source-layer']==='dm_4262_polygon_deco_polygon'));for(const c of [4265,5202,5211])assert.ok(s.layers.some(l=>l.metadata?.['dm:pattern-code']===c));const w=s.layers.find(l=>l.id===`dm-5105-point-${level}-symbol-point`);assert.ok(w);assert.equal(w.metadata['dm:icon-dimensions-mm'].fontFamily,'sans-serif');assert.equal(w.metadata['dm:icon-dimensions-mm'].width,2);assert.equal(w.metadata['dm:icon-dimensions-mm'].height,1.5);});

test('the actual sans-serif W image measures 2 by 1.5 mm',async()=>{
 const {Resvg}=await import('@resvg/resvg-js');const svg=await readFile(new URL('../static/maplibre/icons/source/5105.svg',import.meta.url),'utf8');
 assert.equal(svg.includes('<text'),false);const image=new Resvg(svg).render();const pixels=image.pixels;const xs=[],ys=[];
 for(let y=0;y<96;y++)for(let x=0;x<96;x++){const i=(y*96+x)*4;if(pixels[i+3]>128&&pixels[i]<128){xs.push(x);ys.push(y);}}
 assert.equal((Math.max(...xs)-Math.min(...xs)+1)/24,2);assert.equal((Math.max(...ys)-Math.min(...ys)+1)/24,1.5);
});
test('floating pier text is calibrated to the shipped glyph metrics',async()=>{
 const {createRequire}=await import('node:module');const{pathToFileURL}=await import('node:url');const require=createRequire(import.meta.url);const m=createRequire(require.resolve('maplibre-gl/package.json'));const{PbfReader}=await import(pathToFileURL(m.resolve('pbf')).href);const found=[];
 const glyph=(tag,g,r)=>{if(tag===1)g.id=r.readVarint();else if(tag===4)g.height=r.readVarint();else if(tag===6)g.top=r.readSVarint();else if(tag===7)g.advance=r.readVarint();};
 for(const range of ['0-255','12288-12543','27904-28159'])new PbfReader(await readFile(new URL(`../static/maplibre/glyphs/BIZ UDPGothic Regular/${range}.pbf`,import.meta.url))).readFields((tag,_,r)=>{if(tag===1)r.readMessage((tag,_,r)=>{if(tag===3)found.push(r.readMessage(glyph,{}));},{});},{});
 assert.equal(found.find(g=>g.id===12288)?.advance,16);
 const text=found.filter(g=>[40,41,28014].includes(g.id));assert.equal(text.length,3);const top=Math.min(...text.map(g=>-g.top));const bottom=Math.max(...text.map(g=>-g.top+g.height));assert.equal(bottom-top,23);
});

test('the two coastal waves have 3 mm wavelength and a 1.5 mm row phase offset',async()=>{
 const spec=JSON.parse(await readFile(new URL('../static/maplibre/symbol-spec.json',import.meta.url)));
 const wave=spec.symbols.find(s=>s.code===5106);assert.equal(wave.dimensionsMm.wavelength,3);assert.equal(wave.dimensionsMm.waveHeight,.5);
 const start=path=>path.d.match(/-?\d+(?:\.\d+)?/g).slice(0,2).map(Number);const a=start(wave.paths[0]),b=start(wave.paths[1]);assert.equal(b[0]-a[0],1.5);assert.equal(b[1]-a[1],1);
});
