import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readInspectCatalogCases} from '../src/node/inspect-catalog.js';
import {createInspectCatalogDm,inspectCasesForLevel,inspectSampleLabel,inspectCatalogOrigin,INSPECT_LEVELS} from '../src/core/inspect-catalog.js';
const cases=await readInspectCatalogCases();
const at=(code,level)=>inspectCasesForLevel(cases.filter(s=>s.code===code),level);
const headers=dm=>dm.split('\r\n').filter(r=>/^E[12567]/.test(r));
test('ordinary points are one E5 with one coordinate and never a rotated E6',()=>{
 const p=at(3553,500);assert.equal(p.filter(s=>s.kind==='point').length,1);assert.equal(p.filter(s=>s.kind==='direction').length,0);
 const rows=headers(createInspectCatalogDm(p.filter(s=>s.kind==='point'),500));assert.equal(rows.length,1);assert.equal(rows[0].slice(0,2),'E5');assert.equal(Number(rows[0].slice(27,31)),0);assert.equal(Number(rows[0].slice(31,35)),0);
 const [x,y]=inspectCatalogOrigin(p[0],500);assert.equal(Number(rows[0].slice(42,49)),x+2500);assert.equal(Number(rows[0].slice(35,42)),y+200);
});
test('direction points precede lines and polygons and have upright and quarter-turn E6s',()=>{
 const p=at(2419,500);assert.deepEqual(p.map(s=>s.kind),['direction','direction','line','polygon']);assert.deepEqual(p.map(s=>s.slot),[0,1,2,3]);
 assert.deepEqual(p.slice(0,2).map(s=>s.rotation),[0,90]);
 const dm=createInspectCatalogDm(p.slice(0,2),500).split('\r\n');const coords=dm.filter((_,i)=>dm[i-1]?.startsWith('E6')).map(r=>[[Number(r.slice(7,14)),Number(r.slice(0,7))],[Number(r.slice(21,28)),Number(r.slice(14,21))]]);
 assert.equal(coords[0][1][0]-coords[0][0][0],0);assert.equal(coords[0][1][1]-coords[0][0][1],200);
 assert.equal(coords[1][1][0]-coords[1][0][0],200);assert.equal(coords[1][1][1]-coords[1][0][1],0);
});
test('unsupported geometry kinds are absent and missing level-specific kinds leave no gaps',()=>{
 assert.deepEqual(at(2235,500).map(s=>s.kind),['polygon']);
 assert.deepEqual(at(7213,500).map(s=>s.kind),['point','line']);
 assert.deepEqual(at(7213,2500).map(s=>s.kind),['direction','direction','line']);
 assert.deepEqual(at(2401,2500).map(s=>s.slot),[0]);
 for(const level of INSPECT_LEVELS)for(const code of new Set(cases.map(s=>s.code))){const p=at(code,level);assert.deepEqual(p.map(s=>s.slot),p.map((_,i)=>i));}
});
test('all drawing classes with different representations have separately named examples',()=>{
 assert.deepEqual(at(6132,500).map(s=>s.figtype),[26,27]);assert.deepEqual(at(6141,500).map(s=>s.figtype),[0,46]);
 assert.deepEqual(at(2203,500).filter(s=>s.kind==='polygon').map(s=>s.figtype),[21,23]);
 assert.equal(inspectSampleLabel(at(6132,500)[0]),'線 区分26');assert.equal(inspectSampleLabel(at(2419,500)[1]),'方向点 90°');
});
test('paired edge examples retain their companion but the lower-class example has its own cell',()=>{
 const p=at(6101,500),dm=createInspectCatalogDm(p,500).split('\r\n');
 const h=dm.flatMap((r,i)=>r.startsWith('E26101')?[{fig:Number(r.slice(18,20)),x:Number(dm[i+1].slice(7,14))}]:[]);
 assert.deepEqual(h.map(s=>s.fig),[11,12,12]);assert.equal(h[2].x-h[1].x,2500);
 assert.ok(new Set(headers(dm.join('\r\n')).map(r=>r.slice(12,16))).size===3);
});
test('every registered case has bounded unique element IDs and level columns cannot overlap',()=>{
 assert.equal(new Set(cases.map(s=>s.elementId)).size,cases.length);assert.ok(cases.every(s=>s.elementId+1<=9999));
 for(const level of INSPECT_LEVELS){const dm=createInspectCatalogDm(cases,level);assert.ok(dm.split('\r\n').every(r=>!r||r.length===84));}
 const origin=INSPECT_LEVELS.map(l=>inspectCatalogOrigin(cases[0],l));assert.ok(origin.every((p,i)=>!i||p[0]>origin[i-1][0]));
});

test('generated point records are accepted by the converter with distinct E5 and E6 attributes',async t=>{
 const {existsSync}=await import('node:fs');const {fileURLToPath}=await import('node:url');const{spawnSync}=await import('node:child_process');
 const converter=fileURLToPath(new URL('../../dm-converter/target/release/dm-converter',import.meta.url));
 if(!existsSync(converter)){t.skip('release converter is unavailable');return;}
 const{mkdtemp,writeFile,rm}=await import('node:fs/promises');const{tmpdir}=await import('node:os');const{join}=await import('node:path');const{DatabaseSync}=await import('node:sqlite');
 const root=await mkdtemp(join(tmpdir(),'dm-point-layout-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const input=join(root,'sample.dm'),output=join(root,'sample.gpkg');
 await writeFile(input,createInspectCatalogDm(cases.filter(s=>s.code===3553&&s.kind==='point'||s.code===2419&&s.kind==='direction'),500));
 const result=spawnSync(converter,['convert',input,output,'--progress','false'],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 const db=new DatabaseSync(output,{readOnly:true});t.after(()=>db.close());
 const ordinary=db.prepare('SELECT * FROM dm_3553_point_09_500').all();assert.equal(ordinary.length,1);assert.equal(ordinary[0].ANGLE,null);
 const directional=db.prepare('SELECT ANGLE FROM dm_2419_point_09_500 ORDER BY DMELEMID').all();assert.deepEqual(directional.map(r=>r.ANGLE),[90,0]);
});

test('explicit lower-edge class styles remain visible in runtime and bundled output',async()=>{
 const {readFile}=await import('node:fs/promises');const{createRuntimeStyle,createBundledStyle}=await import('../src/core/style-transform.js');
 for(const level of [250,500,1000]){
  const style=JSON.parse(await readFile(new URL(`../static/maplibre/style-${level}.json`,import.meta.url)));
  const manifest={levels:[level],sourceLayers:['dm_6101_line'],pmtiles:'test.pmtiles',center:[139,36,18]};
  const normalized=structuredClone(style);const lowerLayer=normalized.layers.find(l=>l.id===`dm-6101-line-${level}-figtype-12`);
  lowerLayer.filter=['all',['==',['get','LEVEL'],level],['in',['get','DMFIGTYPE'],['literal',[12]]]];
  for(const output of [createRuntimeStyle(style,manifest,{resourceUrl:s=>s,dmVisible:true}),createBundledStyle(style,manifest),createRuntimeStyle(normalized,manifest,{resourceUrl:s=>s,dmVisible:true})]){
   const lower=output.layers.find(l=>l.id===`dm-6101-line-${level}-figtype-12`);assert.ok(lower);
   assert.equal(JSON.stringify(lower.filter).includes(JSON.stringify(['!=',['get','DMFIGTYPE'],12])),false);
   assert.equal(JSON.stringify(lower.filter).includes('DMSKIP'),true);
  }
 }
});
