import assert from "node:assert/strict";
import {test} from "node:test";
import {DatabaseSync} from "node:sqlite";
import {mkdtemp, mkdir, writeFile, rm, symlink, readdir} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {readManifest, parseManifest} from "../src/node/manifest.js";
import {createLazyFeatureStore} from "../src/node/gpkg-features.js";
import {startServer} from "../src/node/server.js";
import {prepareDistribution} from "../src/node/distribution.js";
import * as databaseAdapter from "../src/sqlite/sqlite-adapter.js";
const manifest = {version: 1, layerName: "sample", pmtiles: "sample.pmtiles", levels: [2500], sourceLayers: ["dm_1101_line", "dm_annotation", "dm_1101_line_deco_line"], bounds: [138, 34, 139, 36], center: [138.5, 35, 15]};
const entries = [{level: 2500, dmCode: 1101, kind: "line", sourceLayer: "dm_1101_line", count: 2, decoration: null, srcLayer: null}];
const fixture = async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-inventory-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  await writeFile(path.join(root, "sample.pmtiles"), "pmtiles");
  return root;
};

test("inventory references validate paths, missing files and symlink boundaries", async (t) => {
  for (const value of ["../outside", "/absolute", "a\\b", "", null]) assert.throws(() => parseManifest({...manifest, featureInventory: value}));
  const root = await fixture(t);
  const value = {...manifest, featureInventory: "feature-inventory.json"};
  await writeFile(path.join(root, "pmtiles-manifest.json"), JSON.stringify(value));
  await assert.rejects(readManifest(root));
  await writeFile(path.join(root, "feature-inventory.json"), JSON.stringify({version: 1, entries}));
  assert.equal((await readManifest(root)).manifest.featureInventory, "feature-inventory.json");
  const store = createLazyFeatureStore(root, value);
  assert.deepEqual((await store.inventory()).entries, entries);
  await rm(path.join(root, "feature-inventory.json"));
  const other = await fixture(t);
  await writeFile(path.join(other, "private.json"), "{}");
  await symlink(path.join(other, "private.json"), path.join(root, "feature-inventory.json"));
  await assert.rejects(readManifest(root));
  await assert.rejects(store.inventory());
});

test("old GeoPackages supply actual level/code/annotation and generated shape inventories", async (t) => {
  const root = await fixture(t);
  const database = new DatabaseSync(path.join(root, "sample.gpkg"));
  database.exec(`CREATE TABLE gpkg_contents(table_name TEXT, data_type TEXT);
    CREATE TABLE gpkg_geometry_columns(table_name TEXT, geometry_type_name TEXT, srs_id INTEGER);`);
  for (const [name, kind] of [["dm_1101_line_08_2500", "LINESTRING"], ["dm_8101_text_08_2500", "POINT"], ["dm_1101_line_08_2500_deco_line", "LINESTRING"]]) {
    database.prepare("INSERT INTO gpkg_contents VALUES (?, 'features')").run(name);
    database.prepare("INSERT INTO gpkg_geometry_columns VALUES (?, ?, 6676)").run(name, kind);
  }
  database.exec(`CREATE TABLE dm_1101_line_08_2500(DMCODE INTEGER);
    INSERT INTO dm_1101_line_08_2500 VALUES (1101), (1101);
    CREATE TABLE dm_8101_text_08_2500(DMCODE INTEGER);
    INSERT INTO dm_8101_text_08_2500 VALUES (8101);
    CREATE TABLE dm_1101_line_08_2500_deco_line(SRC_DMCODE INTEGER, DECORATION TEXT, SRC_LAYER TEXT);
    INSERT INTO dm_1101_line_08_2500_deco_line VALUES (1101, 'bridge_end', 'dm_1101_line_08_2500');`);
  database.close();
  const store = createLazyFeatureStore(root, manifest, {databaseAdapter});
  t.after(() => store.close());
  const data = await store.inventory();
  assert.deepEqual(data.entries, [
    ...entries,
    {level: 2500, dmCode: 1101, kind: "line", sourceLayer: "dm_1101_line_deco_line", count: 1, decoration: "bridge_end", srcLayer: "dm_1101_line_08_2500"},
    {level: 2500, dmCode: 8101, kind: "text", sourceLayer: "dm_annotation", count: 1, decoration: null, srcLayer: null},
  ]);
});

test("server exposes source inventory independently of distribution and DMI", async (t) => {
  const root = await fixture(t);
  const output = path.join(root, "public");
  await mkdir(output);
  await writeFile(path.join(output, manifest.pmtiles), "public-pmtiles");
  const featureManifest = {...manifest, featureInventory: "feature-inventory.json"};
  await writeFile(path.join(root, "pmtiles-manifest.json"), JSON.stringify(featureManifest));
  await writeFile(path.join(root, "feature-inventory.json"), JSON.stringify({version: 1, entries}));
  const {server, url} = await startServer(output, {manifest, featureManifest, featureRoot: root});
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const served = await (await fetch(new URL("pmtiles-manifest.json", url))).json();
  assert.equal(served.featureInventory, "api/feature-inventory");
  assert.equal(served.dmiInfo, undefined);
  const response = await fetch(new URL(served.featureInventory, url));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).entries, entries);
  assert.equal((await fetch(new URL(served.featureInventory, url), {method: "POST"})).status, 405);
  const head = await fetch(new URL(served.featureInventory, url), {method: "HEAD"});
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  await writeFile(path.join(root, "feature-inventory.json"), JSON.stringify({version: 99, entries}));
  assert.equal((await fetch(new URL(served.featureInventory, url))).status, 500);
  await writeFile(path.join(root, "feature-inventory.json"), JSON.stringify({version: 1, entries}));
  const prepared = await prepareDistribution(root, featureManifest, output);
  assert.equal(prepared.manifest.featureInventory, undefined);
  assert.deepEqual(await readdir(output), ["sample.pmtiles"]);
});

test("missing GeoPackage produces incomplete inventory instead of claiming no data", async (t) => {
  const root = await fixture(t);
  const store = createLazyFeatureStore(root, manifest, {databaseAdapter});
  assert.deepEqual(await store.inventory(), {version: 1, entries: [], complete: false});
  store.close();
});
