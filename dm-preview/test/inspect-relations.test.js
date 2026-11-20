import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {DatabaseSync} from "node:sqlite";
import os from "node:os";
import path from "node:path";
import {test} from "node:test";
import {GpkgFeatureStore} from "../src/node/gpkg-features.js";
import * as databaseAdapter from "../src/sqlite/sqlite-adapter.js";
import {relatedQuery, stableFeatureQuery} from "../src/core/inspect-style.js";

const lineBlob = () => {
  const bytes = new Uint8Array(81); const view = new DataView(bytes.buffer);
  bytes[0] = 71; bytes[1] = 80; bytes[40] = 1;
  view.setUint32(41, 2, true); view.setUint32(45, 2, true);
  view.setFloat64(65, 10, true); view.setFloat64(73, 20, true);
  return bytes;
};

const createStore = async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inspect-relations-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const db = new DatabaseSync(path.join(root, "sample.gpkg"));
  db.exec("CREATE TABLE gpkg_contents(table_name TEXT, data_type TEXT); CREATE TABLE gpkg_geometry_columns(table_name TEXT, geometry_type_name TEXT, srs_id INTEGER)");
  for (const [table, generated] of [["dm_1101_line_09_500", false], ["dm_1101_line_08_500", false],
    ["dm_1101_line_09_250", false], ["dm_1101_line_09_500_deco_line", true]]) {
    db.exec(`CREATE TABLE ${table}(fid INTEGER PRIMARY KEY, geom BLOB, USER_ID INTEGER, DMFILE TEXT, LEVEL INTEGER, DMELEMID INTEGER,
      SRC_LAYER TEXT, SRC_USER_ID INTEGER, SRC_DMFILE TEXT, DECORATION TEXT)`);
    db.prepare("INSERT INTO gpkg_contents VALUES (?, 'features')").run(table);
    db.prepare("INSERT INTO gpkg_geometry_columns VALUES (?, 'LINESTRING', ?)").run(table, table.includes("_08_") ? 6676 : 6677);
    if (!generated) {
      db.prepare(`INSERT INTO ${table}(geom,USER_ID,DMFILE,LEVEL,DMELEMID) VALUES (?,1,'a.dm',?,7)`).run(lineBlob(), table.endsWith("250") ? 250 : 500);
    }
  }
  db.prepare("INSERT INTO dm_1101_line_09_500(geom,USER_ID,DMFILE,LEVEL,DMELEMID) VALUES (?,2,'b.dm',500,99)").run(lineBlob());
  const statement = db.prepare("INSERT INTO dm_1101_line_09_500_deco_line(geom,USER_ID,SRC_LAYER,SRC_USER_ID,SRC_DMFILE,DECORATION) VALUES (?,?,?,1,?,'tick')");
  statement.run(lineBlob(), 1, "dm_1101_line_09_500", "a.dm");
  statement.run(lineBlob(), 2, "dm_1101_line_09_500", "a.dm");
  statement.run(lineBlob(), 3, "dm_1101_line_09_500", "b.dm");
  statement.run(lineBlob(), 4, "dm_1101_line_08_500", "a.dm");
  db.close();
  const store = await GpkgFeatureStore.create(root, {layerName: "sample"}, {databaseAdapter});
  context.after(() => store.close());
  return store;
};

test("related features distinguish source table, file and level and support pagination", async (context) => {
  const store = await createStore(context);
  const query = new URLSearchParams({layer: "dm_1101_line", sourceTable: "dm_1101_line_09_500", userId: "1", dmfile: "a.dm", level: "500", pageSize: "1"});
  const first = store.related(query);
  assert.equal(first.source.tableName, "dm_1101_line_09_500");
  assert.equal(first.total, 2); assert.equal(first.features.length, 1);
  assert.equal(first.features[0].properties.USER_ID, 1);
  query.set("page", "2");
  assert.equal(store.related(query).features[0].properties.USER_ID, 2);
  query.delete("sourceTable"); query.set("level", "250");
  assert.equal(store.related(query).source.tableName, "dm_1101_line_09_250");
  query.set("level", "500");
  assert.equal(store.related(query).ambiguous, true);
});

test("stable restoration never substitutes a renumbered USER_ID or an ambiguous element", async (context) => {
  const store = await createStore(context);
  const query = new URLSearchParams({layer: "dm_1101_line", dmfile: "b.dm", level: "500", elementId: "99"});
  assert.equal(store.restore(query).feature.properties.USER_ID, 2);
  query.set("dmfile", "a.dm"); query.set("elementId", "7");
  assert.equal(store.restore(query).ambiguous, true);
  assert.equal(store.restore(query).feature, undefined);
  query.set("elementId", "8");
  assert.equal(store.restore(query).feature, undefined);
  assert.equal(store.restore(query).ambiguous, false);
});

test("listed decorations recover level from source table and do not require original feature columns", () => {
  assert.deepEqual(relatedQuery({sourceLayer: "dm_1101_line_deco_line", properties: {
    SRC_LAYER: "dm_1101_line_09_500", SRC_USER_ID: 1, SRC_DMFILE: "a.dm",
  }}), {layer: "dm_1101_line", sourceTable: "dm_1101_line_09_500", userId: 1, dmfile: "a.dm", level: 500});
  assert.equal(stableFeatureQuery({sourceLayer: "dm_1101_line", properties: {USER_ID: 1}}), undefined);
  assert.deepEqual(stableFeatureQuery({sourceLayer: "dm_1101_line", properties: {DMELEMID: 7, DMFILE: "a.dm", LEVEL: 500}}),
    {layer: "dm_1101_line", elementId: 7, dmfile: "a.dm", level: 500});
});

test("feature lists follow the inspection level and code without treating empty matches as missing layers", async (context) => {
  const store = await createStore(context);
  const query = new URLSearchParams({layer: "dm_1101_line", level: "250", code: "1101"});
  const selected = store.search(query);
  assert.equal(selected.total, 1);
  assert.equal(selected.features[0].properties.LEVEL, 250);
  query.set("code", "2204");
  assert.equal(store.search(query).total, 0);
  query.set("level", "bad");
  assert.throws(() => store.search(query), {name: "ApiInputError"});
});
