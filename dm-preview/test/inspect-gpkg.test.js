import assert from "node:assert/strict";
import {test} from "node:test";
import {DatabaseSync} from "node:sqlite";
import {mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as databaseAdapter from "../src/sqlite/sqlite-adapter.js";
import {projectGeometry} from "../src/proj4/gpkg-projection.js";
import {writeInspectGpkgMetadata} from "../src/node/inspect-gpkg.js";
import {GpkgFeatureStore} from "../src/node/gpkg-features.js";
import {createGeojsonCatalogStyle, createRuntimeStyle} from "../src/core/style-transform.js";
import {getDmSourceLayers} from "../src/core/dm-source-layers.js";
import {INSPECT_LEVELS} from "../src/core/inspect-catalog.js";

const point = (x, y) => {
  const blob = Buffer.alloc(61); blob.write("GP"); blob[3] = 3; blob.writeInt32LE(6677, 4);
  blob[40] = 1; blob.writeUInt32LE(1, 41); blob.writeDoubleLE(x, 45); blob.writeDoubleLE(y, 53);
  return blob;
};

test("catalog GeoPackage stores code labels and yields projected GeoJSON with original attributes", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-gpkg-label-test-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const database = new DatabaseSync(path.join(root, "inspect.gpkg"));
  database.exec(`CREATE TABLE gpkg_contents(table_name TEXT PRIMARY KEY, data_type TEXT, identifier TEXT, srs_id INTEGER, min_x REAL, min_y REAL, max_x REAL, max_y REAL);
    CREATE TABLE gpkg_geometry_columns(table_name TEXT, column_name TEXT, geometry_type_name TEXT, srs_id INTEGER, z INTEGER, m INTEGER);`);
  for (const level of INSPECT_LEVELS) {
    const table = `dm_3553_point_09_${level}`;
    database.exec(`CREATE TABLE ${table}(fid INTEGER PRIMARY KEY, geom BLOB, DMCODE INTEGER, LEVEL INTEGER, ANGLE REAL);
      INSERT INTO gpkg_contents VALUES ('${table}', 'features', '${table}', 6677, 5, 100, 5, 100);
      INSERT INTO gpkg_geometry_columns VALUES ('${table}', 'geom', 'POINT', 6677, 0, 0);`);
    database.prepare(`INSERT INTO ${table} VALUES (1, ?, 3553, ?, 30)`).run(point(5, 100), level);
  }
  database.exec(`CREATE TABLE dm_3553_point_09_500_deco_point(fid INTEGER PRIMARY KEY, geom BLOB, SRC_LAYER TEXT, SRC_DMCODE INTEGER, DECORATION TEXT);
    INSERT INTO gpkg_contents VALUES ('dm_3553_point_09_500_deco_point', 'features', 'decoration', 6677, 5, 100, 5, 100);
    INSERT INTO gpkg_geometry_columns VALUES ('dm_3553_point_09_500_deco_point', 'geom', 'POINT', 6677, 0, 0);`);
  database.prepare("INSERT INTO dm_3553_point_09_500_deco_point VALUES (1, ?, 'dm_3553_point_09_500', 3553, 'pattern')").run(point(5, 100));
  database.close();
  const cases = [2204, 3553, 3554].map((code, row) => ({code, row, rows: 3, slot: 0}));
  const dependencies = {databaseAdapter, projectGeometry};
  const manifest = await writeInspectGpkgMetadata(root, cases, dependencies);
  assert.equal(manifest.geojson, "api/inspect/geojson"); assert.equal(manifest.pmtiles, undefined);
  assert.deepEqual(manifest.levels, INSPECT_LEVELS);
  const store = await GpkgFeatureStore.create(root, manifest, dependencies);
  t.after(() => store.close());
  const json = store.geojson();
  assert.equal(json.type, "FeatureCollection"); assert.equal(json.features.length, 19);
  const labels = json.features.filter(feature => feature.properties.DM_SOURCE_LAYER === "inspect_labels");
  assert.equal(labels.length, 13);
  assert.deepEqual(labels.filter(feature => feature.properties.DMCODE === 2204).map(feature => feature.properties.LEVEL), [250, 500, 1000]);
  for (const level of INSPECT_LEVELS) {
    const first = labels.find(feature => feature.properties.LEVEL === level && feature.properties.DMCODE === 3553);
    const next = labels.find(feature => feature.properties.LEVEL === level && feature.properties.DMCODE === 3554);
    assert.equal(first.properties.TEXT, `3553  1:${level}`);
    assert.ok(first.geometry.coordinates[1] > next.geometry.coordinates[1]);
    assert.ok(first.geometry.coordinates[0] > 139 && first.geometry.coordinates[0] < 141);
  }
  const decoration = json.features.find(feature => feature.properties.DECORATION === "pattern");
  assert.equal(decoration.properties.LEVEL, 500);
  assert.equal(decoration.properties.DMCODE, 3553);
  assert.equal(decoration.properties.SRC_DMCODE, 3553);
  assert.equal(decoration.properties.ZONE, 9);
  const shape = json.features.find(feature => feature.properties.DM_SOURCE_LAYER === "dm_3553_point");
  assert.equal(shape.properties.ROTATION, 60); assert.equal(shape.properties.ANGLE, 30);
  assert.deepEqual(shape.geometry, projectGeometry({type: "Point", coordinates: [5, 100]}, 9));
  assert.equal(store.inventory().entries.length, 6);
});

test("GeoJSON styling preserves source-layer identity and filters each layer while adding code annotations", () => {
  const original = {sources: {dm: {type: "vector", url: "pmtiles://old"}}, layers: [
    {id: "road", source: "dm", type: "line", "source-layer": "dm_2106_line", filter: ["==", ["get", "LEVEL"], 500]},
  ]};
  const style = createGeojsonCatalogStyle(original, "http://127.0.0.1:1234/preview/api/inspect/geojson");
  assert.equal(style.sources.dm.type, "geojson"); assert.equal(style.sources.dm.url, undefined);
  assert.equal(style.layers[0]["source-layer"], undefined);
  assert.equal(style.layers[0].metadata["dm:source-layer"], "dm_2106_line");
  assert.deepEqual(style.layers[0].filter, ["all", ["==", ["get", "DM_SOURCE_LAYER"], "dm_2106_line"], original.layers[0].filter]);
  assert.deepEqual(getDmSourceLayers(style), ["dm_2106_line"]);
  assert.equal(style.layers.at(-1).id, "inspect-code-labels");
  assert.equal(original.sources.dm.type, "vector");
  const runtime = createRuntimeStyle(original, {geojson: "api/inspect/geojson", levels: [500], sourceLayers: ["dm_2106_line"], center: [139, 36, 18]}, {
    resourceUrl: value => { assert.equal(typeof value, "string"); return `http://127.0.0.1:1234/preview/${value}`; }, dmVisible: true,
  });
  assert.equal(runtime.sources.dm.type, "geojson");
  assert.equal(runtime.sources.dm.data, "http://127.0.0.1:1234/preview/api/inspect/geojson");
});

test("catalog labels name each geometry and class once at its own compact slot", async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"dm-layout-label-test-"));t.after(()=>rm(root,{recursive:true,force:true}));
  const db=new DatabaseSync(path.join(root,"inspect.gpkg"));
  db.exec(`CREATE TABLE gpkg_contents(table_name TEXT PRIMARY KEY,data_type TEXT,identifier TEXT,srs_id INTEGER,min_x REAL,min_y REAL,max_x REAL,max_y REAL);
    CREATE TABLE gpkg_geometry_columns(table_name TEXT,column_name TEXT,geometry_type_name TEXT,srs_id INTEGER,z INTEGER,m INTEGER);`);db.close();
  const cases=[{code:6132,kind:"line",figtype:26,row:0,rows:1,levels:[500],slots:{500:0},slot:0},
    {code:6132,kind:"line",figtype:27,row:0,rows:1,levels:[500],slots:{500:1},slot:1}];
  const manifest=await writeInspectGpkgMetadata(root,cases,{databaseAdapter,projectGeometry});
  assert.equal(manifest.catalogLayout,3);
  const store=await GpkgFeatureStore.create(root,manifest,{databaseAdapter,projectGeometry});t.after(()=>store.close());
  const labels=store.geojson().features;assert.deepEqual(labels.map(f=>f.properties.TEXT),["6132  1:500","線 区分26","線 区分27"]);
  assert.ok(labels.every(f=>f.properties.LEVEL===500));
  assert.ok(labels[2].geometry.coordinates[0]>labels[1].geometry.coordinates[0]);
});
