import assert from "node:assert/strict";
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {test} from "node:test";
import initSqlJs from "sql.js";
import {parseRange, startServer} from "../src/server.js";

test("parseRange supports explicit, open, and suffix ranges", () => {
  assert.deepEqual(parseRange("bytes=10-19", 100), {start: 10, end: 19, status: 206});
  assert.deepEqual(parseRange("bytes=90-", 100), {start: 90, end: 99, status: 206});
  assert.deepEqual(parseRange("bytes=-10", 100), {start: 90, end: 99, status: 206});
});

test("parseRange rejects multiple and out-of-bounds ranges", () => {
  assert.throws(() => parseRange("bytes=0-1,4-5", 100));
  assert.throws(() => parseRange("bytes=0-1-2", 100));
  assert.throws(() => parseRange("bytes=100-", 100));
});

test("server handles output files, ranges, methods, and traversal", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const output = path.join(root, "output");
  const assets = path.join(root, "assets");
  await mkdir(output);
  await mkdir(assets);
  await writeFile(`${output}/sample.pmtiles`, "0123456789");
  await writeFile(`${assets}/index.html`, "preview");
  await writeFile(`${assets}/app.js`, "");
  await writeFile(`${assets}/app.css`, "");
  const {server, url} = await startServer(output, {appAssets: assets, vendorFiles: new Map()});
  context.after(() => server.close());
  const origin = new URL(url).origin;

  const range = await fetch(`${origin}/sample.pmtiles`, {headers: {Range: "bytes=2-5"}});
  assert.equal(range.status, 206);
  assert.equal(range.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(await range.text(), "2345");

  assert.equal((await fetch(`${origin}/sample.pmtiles`, {method: "HEAD"})).status, 200);
  assert.equal((await fetch(`${origin}/sample.pmtiles`, {method: "POST"})).status, 405);
  assert.equal((await fetch(`${origin}/missing`)).status, 404);
  assert.equal((await fetch(`${origin}/%2e%2e/secret`)).status, 404);
  assert.equal(await (await fetch(url)).text(), "preview");
});

test("server serves bundled maplibre style, sprite, and glyph assets", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const output = path.join(root, "output");
  const maplibre = path.join(root, "maplibre");
  const fontstack = "Test Font";
  await mkdir(output);
  await mkdir(path.join(maplibre, "sprite"), {recursive: true});
  await mkdir(path.join(maplibre, "glyphs", fontstack), {recursive: true});
  await writeFile(path.join(maplibre, "style-2500.json"), JSON.stringify({version: 8}));
  await writeFile(path.join(maplibre, "sprite", "sprite.json"), "{}");
  await writeFile(path.join(maplibre, "sprite", "sprite.png"), "png");
  await writeFile(path.join(maplibre, "glyphs", fontstack, "0-255.pbf"), "pbf");
  const {server, url} = await startServer(output, {
    appAssets: path.join(root, "missing-assets"),
    vendorFiles: new Map(),
    maplibreAssets: maplibre,
  });
  context.after(() => server.close());
  const origin = new URL(url).origin;

  const style = await fetch(`${origin}/maplibre/style-2500.json`);
  assert.equal(style.status, 200);
  assert.match(style.headers.get("content-type"), /application\/json/);
  assert.equal((await fetch(`${origin}/preview/maplibre/style-2500.json`)).status, 200);

  assert.equal((await fetch(`${origin}/sprite.json`)).status, 200);
  assert.equal((await fetch(`${origin}/preview/sprite.json`)).status, 200);
  assert.equal((await fetch(`${origin}/sprite.png`)).status, 200);

  const glyph = await fetch(`${origin}/glyphs/${encodeURIComponent(fontstack)}/0-255.pbf`);
  assert.equal(glyph.status, 200);
  assert.equal(glyph.headers.get("content-type"), "application/x-protobuf");
  assert.equal((await fetch(`${origin}/preview/glyphs/${encodeURIComponent(fontstack)}/0-255.pbf`)).status, 200);

  assert.equal((await fetch(`${origin}/maplibre/%2e%2e/secret`)).status, 404);
  assert.equal((await fetch(`${origin}/glyphs/%2e%2e/secret`)).status, 404);
  assert.equal((await fetch(`${origin}/sprite@3x.png`)).status, 404);
});

test("server serves style bundle assets from output directory", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const output = path.join(root, "output");
  await mkdir(path.join(output, "sprite"), {recursive: true});
  await mkdir(path.join(output, "glyphs", "Test Font"), {recursive: true});
  await writeFile(path.join(output, "style.json"), "{}");
  await writeFile(path.join(output, "sprite", "sprite.json"), "{}");
  await writeFile(path.join(output, "glyphs", "Test Font", "0-255.pbf"), "pbf");
  const manifest = {
    version: 1,
    layerName: "dm-sample",
    pmtiles: "dm-sample.pmtiles",
    levels: [2500],
    sourceLayers: ["dm_7100_point"],
    bounds: [130, 30, 140, 40],
    center: [135, 35, 15],
    styles: ["style.json"],
  };
  const {server, url} = await startServer(output, {manifest});
  context.after(() => server.close());
  const origin = new URL(url).origin;

  assert.match(await (await fetch(url)).text(), /DM MapLibre Preview/);
  assert.deepEqual(await (await fetch(`${origin}/preview/pmtiles-manifest.json`)).json(), manifest);
  assert.equal(await (await fetch(`${origin}/preview/style.json`)).text(), "{}");
  assert.equal((await fetch(`${origin}/preview/sprite.json`)).status, 200);
  assert.equal((await fetch(`${origin}/preview/glyphs/Test%20Font/0-255.pbf`)).status, 200);
});

test("feature API reads paged GeoPackage features", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const output = path.join(root, "output");
  await mkdir(output);
  await writeFeatureGpkg(path.join(output, "dm-sample.gpkg"));
  const manifest = {
    layerName: "dm-sample",
    sourceLayers: ["dm_7100_point"],
  };
  const {server, url} = await startServer(output, {manifest});
  context.after(() => server.close());
  const origin = new URL(url).origin;

  const response = await fetch(`${origin}/preview/api/features?layer=dm_7100_point&page=2&pageSize=1`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.total, 2);
  assert.equal(body.features.length, 1);
  assert.equal(body.features[0].fid, 2);
  assert.equal(body.features[0].sourceLayer, "dm_7100_point");
  assert.deepEqual(body.features[0].properties.USER_ID, 102);
  assert.equal(body.features[0].geometry.type, "Point");
  assert.ok(Number.isFinite(body.features[0].center[0]));
  assert.ok(Number.isFinite(body.features[0].center[1]));
});

test("feature API rejects invalid query values", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const output = path.join(root, "output");
  await mkdir(output);
  await writeFeatureGpkg(path.join(output, "dm-sample.gpkg"));
  const {server, url} = await startServer(output, {
    manifest: {layerName: "dm-sample", sourceLayers: ["dm_7100_point"]},
  });
  context.after(() => server.close());
  const origin = new URL(url).origin;

  assert.equal((await fetch(`${origin}/preview/api/features?layer=dm_7100_point;DROP TABLE x`)).status, 400);
  assert.equal((await fetch(`${origin}/preview/api/features?layer=dm_7100_point&page=0`)).status, 400);
  assert.equal((await fetch(`${origin}/preview/api/features?layer=dm_7100_point&pageSize=101`)).status, 400);
  assert.equal((await fetch(`${origin}/preview/api/features?layer=dm_9999_point`)).status, 404);
});

const writeFeatureGpkg = async (file) => {
  const SQL = await initSqlJs();
  const database = new SQL.Database();
  database.run(`
    CREATE TABLE gpkg_contents (
      table_name TEXT NOT NULL PRIMARY KEY,
      data_type TEXT NOT NULL,
      identifier TEXT UNIQUE,
      description TEXT DEFAULT '',
      last_change DATETIME,
      min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE,
      srs_id INTEGER
    );
    CREATE TABLE gpkg_geometry_columns (
      table_name TEXT NOT NULL,
      column_name TEXT NOT NULL,
      geometry_type_name TEXT NOT NULL,
      srs_id INTEGER NOT NULL,
      z TINYINT NOT NULL,
      m TINYINT NOT NULL,
      PRIMARY KEY (table_name, column_name)
    );
    CREATE TABLE dm_7100_point_09_2500 (
      fid INTEGER PRIMARY KEY AUTOINCREMENT,
      geom BLOB NOT NULL,
      USER_ID INTEGER NOT NULL,
      DMCODE INTEGER,
      DMFILE TEXT NOT NULL,
      ANGLE REAL
    );
  `);
  database.run(
    "INSERT INTO gpkg_contents (table_name, data_type, identifier, srs_id) VALUES (?, 'features', ?, ?)",
    ["dm_7100_point_09_2500", "dm_7100_point_09_2500", 6677],
  );
  database.run(
    "INSERT INTO gpkg_geometry_columns VALUES (?, 'geom', 'POINT', ?, 0, 0)",
    ["dm_7100_point_09_2500", 6677],
  );
  database.run(
    "INSERT INTO dm_7100_point_09_2500 (geom, USER_ID, DMCODE, DMFILE, ANGLE) VALUES (?, 101, 7100, 'a.dm', 0)",
    [pointBlob(0, 0)],
  );
  database.run(
    "INSERT INTO dm_7100_point_09_2500 (geom, USER_ID, DMCODE, DMFILE, ANGLE) VALUES (?, 102, 7100, 'b.dm', 90)",
    [pointBlob(10, 20)],
  );
  await writeFile(file, database.export());
  database.close();
};

const pointBlob = (x, y) => {
  const blob = new Uint8Array(61);
  const view = new DataView(blob.buffer);
  blob[0] = "G".charCodeAt(0);
  blob[1] = "P".charCodeAt(0);
  blob[40] = 1;
  view.setUint32(41, 1, true);
  view.setFloat64(45, x, true);
  view.setFloat64(53, y, true);
  return blob;
};
