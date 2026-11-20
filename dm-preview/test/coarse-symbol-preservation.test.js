import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Resvg} from '@resvg/resvg-js';
const hashes={
  "3556/2500/1": "0fd47eb66ef6567186bad168e48e0135df2fe49b204b0114bbee12033b382def",
  "3556/5000/1": "33f4d734f28e38940595ba0cdeb1e1ab5f1b139b9fda3afa6a95f99b8d580e98",
  "4228/2500/1": "2c64b5f84d290457662c4107f081a26300e9a486e5e0ce22e297c5bf639fe184",
  "4228/5000/1": "357745b905c182ecc2ff03a574c0ef35a500924bdb7da0c6a40750b0dbc2d858",
  "4208/2500/1": "70b90fa61ea9ad956154c5a3c61f9dec62e5c2e9bad06d7dc9c62a50e8355f11",
  "4208/5000/1": "4792a4eb513000bbcd6074b08586e7b7142b0789fc89b37911acab1a59f769bb",
  "3556/2500/2": "bbae6fa025367cff09434282ed161d730a2c10178d2b321bc56c1a6825d549da",
  "3556/5000/2": "99cf0bb0e8c15585918d8b56765f40536648dcaf6f7c5ca25cd03055c49c1cdf",
  "4228/2500/2": "1141ebe21fbcc6ad93a45af540be6e868882a435991f89994b1bf554bf147cdf",
  "4228/5000/2": "9f183f6c5b690e1523329d06194e8162c9d2d30e6f08a24ba6b755c44b8d6573",
  "4208/2500/2": "cb5186a08f7663527a4617ee8ad002a7f143d85a2169f6001698b016b2515a99",
  "4208/5000/2": "b6bef648029101da2d6bbebabe650a1c6a663c81c0bdff9cc3336071ed98e338"
};
const assets=new URL('../static/maplibre/',import.meta.url);
for(const [key,hash] of Object.entries(hashes)) test('original coarse sprite pixels '+key,async()=>{
 const [code,level,ratio]=key.split('/').map(Number);const suffix=ratio===2?'@2x':'';
 const png=await readFile(new URL('sprite/sprite'+suffix+'.png',assets));
 const atlas=JSON.parse(await readFile(new URL('sprite/sprite'+suffix+'.json',assets)));
 const style=JSON.parse(await readFile(new URL('style-'+level+'.json',assets)));
 const layer=style.layers.find(l=>l['source-layer']==='dm_'+code+'_point'&&l.type==='symbol');
 const f=atlas[layer.layout['icon-image']];assert.ok(f);
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+f.width+'" height="'+f.height+'"><image href="data:image/png;base64,'+png.toString('base64')+'" x="'+(-f.x)+'" y="'+(-f.y)+'" width="'+png.readUInt32BE(16)+'" height="'+png.readUInt32BE(20)+'"/></svg>';
 assert.equal(createHash('sha256').update(new Resvg(svg).render().pixels).digest('hex'),hash);
});
