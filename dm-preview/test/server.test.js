import assert from "node:assert/strict";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {DatabaseSync} from "node:sqlite";
import os from "node:os";
import path from "node:path";
import {test} from "node:test";
import {parseGeometry} from "../src/core/gpkg-feature-policy.js";
import {projectGeometry} from "../src/proj4/gpkg-projection.js";
import {parseRange, startServer} from "../src/server.js";
import * as databaseAdapter from "../src/sqlite/sqlite-adapter.js";

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

test("GeoPackage geometry rejects coordinate counts larger than the remaining bytes", () => {
  const blob = new Uint8Array(49);
  const view = new DataView(blob.buffer);
  blob[0] = "G".charCodeAt(0);
  blob[1] = "P".charCodeAt(0);
  blob[40] = 1;
  view.setUint32(41, 2, true);
  view.setUint32(45, 0xffffffff, true);

  assert.throws(() => parseGeometry(blob, "line"), /invalid GeoPackage coordinate count/);
});

test("server handles output files, ranges, methods, and traversal", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const output = path.join(root, "output");
  const assets = path.join(root, "assets");
  await mkdir(output);
  await mkdir(assets);
  await mkdir(path.join(assets, "core"));
  await writeFile(`${output}/sample.pmtiles`, "0123456789");
  await writeFile(`${assets}/index.html`, "preview");
  await writeFile(`${assets}/app.js`, "");
  await writeFile(`${assets}/app.css`, "");
  await writeFile(path.join(assets, "core", "dm-source-layers.js"), "");
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
  assert.equal((await fetch(`${origin}/preview/assets/core/dm-source-layers.js`)).status, 200);
  assert.equal((await fetch(`${origin}/preview/assets/core/%2e%2e/secret`)).status, 404);
  assert.equal(await (await fetch(url)).text(), "preview");
});

test("server fails before listening when the preview index is missing", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const output = path.join(root, "output");
  await mkdir(output);

  await assert.rejects(
    startServer(output, {appAssets: path.join(root, "missing-assets"), vendorFiles: new Map()}),
    /required preview asset is missing/,
  );
});

test("server reports asset roots and static 404s in verbose mode", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const output = path.join(root, "output");
  await mkdir(output);
  const diagnostics = [];
  const {server, url} = await startServer(output, {
    diagnosticLog: (event) => diagnostics.push(event),
    verbose: true,
  });
  context.after(() => server.close());

  assert.equal((await fetch(`${new URL(url).origin}/preview/maplibre/missing.json`)).status, 404);
  assert.equal(diagnostics[0].event, "startup");
  assert.equal(diagnostics[0].output, output);
  assert.deepEqual(diagnostics[1], {
    event: "not-found",
    pathname: "/preview/maplibre/missing.json",
    output,
    appAssets: diagnostics[0].assetRoots.appAssets,
    maplibreAssets: diagnostics[0].assetRoots.maplibreAssets,
  });
});

test("server serves bundled maplibre style, sprite, and glyph assets", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const output = path.join(root, "output");
  const maplibre = path.join(root, "maplibre");
  const fontstack = "Test Font";
  await mkdir(output);
  const assets = path.join(root, "assets");
  await mkdir(path.join(maplibre, "sprite"), {recursive: true});
  await mkdir(path.join(maplibre, "glyphs", fontstack), {recursive: true});
  await mkdir(assets);
  await writeFile(path.join(assets, "index.html"), "preview");
  await writeFile(path.join(maplibre, "style-2500.json"), JSON.stringify({version: 8}));
  await writeFile(path.join(maplibre, "sprite", "sprite.json"), "{}");
  await writeFile(path.join(maplibre, "sprite", "sprite.png"), "png");
  await writeFile(path.join(maplibre, "glyphs", fontstack, "0-255.pbf"), "pbf");
  const {server, url} = await startServer(output, {
    appAssets: assets,
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
  const {server, url} = await startServer(output, {databaseAdapter, manifest, projectGeometry});
  context.after(() => server.close());
  const origin = new URL(url).origin;

  assert.match(await (await fetch(url)).text(), /DM MapLibre Preview/);
  assert.deepEqual(await (await fetch(`${origin}/preview/pmtiles-manifest.json`)).json(), manifest);
  assert.equal(await (await fetch(`${origin}/preview/style.json`)).text(), "{}");
  assert.equal((await fetch(`${origin}/preview/maplibre/style-2500.json`)).status, 200);
  assert.equal((await fetch(`${origin}/preview/sprite.json`)).status, 200);
  assert.equal((await fetch(`${origin}/preview/glyphs/Test%20Font/0-255.pbf`)).status, 200);
});

test("style editor API reads and writes bundled style assets", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const output = path.join(root, "output");
  await mkdir(path.join(output, "sprite"), {recursive: true});
  const style = {
    version: 8,
    sources: {dm: {type: "vector", url: "pmtiles://./dm.pmtiles"}},
    layers: [
      {
        id: "dm-1000-line-2500-line",
        type: "line",
        source: "dm",
        "source-layer": "dm_1000_line",
        paint: {"line-color": "#000000"},
      },
      {
        id: "dm-3001-polygon-2500-outline",
        type: "line",
        source: "dm",
        "source-layer": "dm_3001_polygon",
        paint: {"line-color": "#000000"},
      },
      {
        id: "dm-default-point-2500-symbol",
        type: "circle",
        source: "dm",
        "source-layer": "dm_default_point",
        paint: {"circle-color": "rgba(0, 0, 0, 0)", "circle-stroke-color": "#000000"},
      },
    ],
  };
  await writeFile(path.join(output, "style.json"), JSON.stringify(style));
  await writeFile(path.join(output, "sprite", "sprite.json"), "{}");
  await writeFile(path.join(output, "sprite", "sprite@2x.json"), "{}");
  await writeFile(path.join(output, "sprite", "sprite.png"), "png");
  await writeFile(path.join(output, "sprite", "sprite@2x.png"), "png2x");
  const {server, url} = await startServer(output);
  context.after(() => server.close());
  const origin = new URL(url).origin;

  const state = await fetch(`${origin}/preview/api/style-editor/state`);
  assert.equal(state.status, 200);
  const body = await state.json();
  assert.equal(body.writable, true);
  assert.deepEqual(body.editableKinds, ["line", "polygon", "icon"]);
  assert.equal(body.editableLayers[0].id, "dm-1000-line-2500-line");
  assert.equal(body.editableLayers[1].colorKind, "polygon");
  assert.equal(body.editableLayers[2].colorKind, "icon");
  assert.deepEqual(body.editableLayers[2].colorProperties, ["circle-stroke-color"]);

  const nextStyle = {...style, name: "edited"};
  const save = await fetch(`${origin}/preview/api/style-editor/state`, {
    method: "PUT",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      style: nextStyle,
      sprites: {
        "sprite.json": {"dm-test": {width: 1, height: 1, x: 0, y: 0, pixelRatio: 1}},
        "sprite.png": "data:image/png;base64,cG5n",
      },
    }),
  });
  assert.equal(save.status, 200, await save.text());
  assert.equal(JSON.parse(await readFile(path.join(output, "style.json"), "utf8")).name, "edited");
  assert.deepEqual(JSON.parse(await readFile(path.join(output, "sprite", "sprite.json"), "utf8")), {
    "dm-test": {width: 1, height: 1, x: 0, y: 0, pixelRatio: 1},
  });
  assert.equal(await readFile(path.join(output, "sprite", "sprite.png"), "utf8"), "png");
});

test("style editor API creates bundled style assets on first save", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const output = path.join(root, "output");
  const maplibre = path.join(root, "maplibre");
  await mkdir(output);
  await mkdir(path.join(maplibre, "sprite"), {recursive: true});
  await mkdir(path.join(maplibre, "glyphs", "Test Font"), {recursive: true});
  await writeFile(path.join(maplibre, "sprite", "sprite.json"), "{}");
  await writeFile(path.join(maplibre, "sprite", "sprite.png"), "png");
  await writeFile(path.join(maplibre, "glyphs", "Test Font", "0-255.pbf"), "pbf");
  const {server, url} = await startServer(output, {maplibreAssets: maplibre, vendorFiles: new Map()});
  context.after(() => server.close());
  const origin = new URL(url).origin;

  const state = await fetch(`${origin}/preview/api/style-editor/state`);
  assert.equal(state.status, 200);
  assert.equal((await state.json()).writable, true);

  const save = await fetch(`${origin}/preview/api/style-editor/state`, {
    method: "PUT",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({style: {version: 8, sources: {dm: {type: "vector", url: "pmtiles://./dm.pmtiles"}}, layers: []}}),
  });
  assert.equal(save.status, 200);
  assert.equal(JSON.parse(await readFile(path.join(output, "style.json"), "utf8")).version, 8);
  assert.equal(await readFile(path.join(output, "sprite", "sprite.png"), "utf8"), "png");
  assert.equal(await readFile(path.join(output, "glyphs", "Test Font", "0-255.pbf"), "utf8"), "pbf");
});

test("style editor leaves the current style unchanged when required assets cannot be staged", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const output = path.join(root, "output");
  await mkdir(output);
  const style = {version: 8, sources: {dm: {}}, layers: [], name: "current"};
  await writeFile(path.join(output, "style.json"), JSON.stringify(style));
  const {server, url} = await startServer(output, {vendorFiles: new Map()});
  context.after(() => server.close());

  const response = await fetch(`${new URL(url).origin}/preview/api/style-editor/state`, {
    method: "PUT",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({style: {version: 8, sources: {dm: {}}, layers: []}}),
  });

  assert.equal(response.status, 500);
  assert.equal(JSON.parse(await readFile(path.join(output, "style.json"), "utf8")).name, "current");
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
  const {server, url} = await startServer(output, {databaseAdapter, manifest, projectGeometry});
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

test("feature API reads text source layers stored as point geometries", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const output = path.join(root, "output");
  await mkdir(output);
  await writeFeatureGpkg(path.join(output, "dm-sample.gpkg"));
  const manifest = {
    layerName: "dm-sample",
    sourceLayers: ["dm_8110_text"],
  };
  const {server, url} = await startServer(output, {databaseAdapter, manifest, projectGeometry});
  context.after(() => server.close());
  const origin = new URL(url).origin;

  const response = await fetch(`${origin}/preview/api/features?layer=dm_8110_text`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.total, 1);
  assert.equal(body.features[0].sourceLayer, "dm_8110_text");
  assert.equal(body.features[0].geometry.type, "Point");
  assert.equal(body.features[0].properties.TEXT, "大阪市");
});

test("feature API rejects invalid query values", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const output = path.join(root, "output");
  await mkdir(output);
  await writeFeatureGpkg(path.join(output, "dm-sample.gpkg"));
  const {server, url} = await startServer(output, {
    databaseAdapter,
    manifest: {layerName: "dm-sample", sourceLayers: ["dm_7100_point"]},
    projectGeometry,
  });
  context.after(() => server.close());
  const origin = new URL(url).origin;

  assert.equal((await fetch(`${origin}/preview/api/features?layer=dm_7100_point;DROP TABLE x`)).status, 400);
  assert.equal((await fetch(`${origin}/preview/api/features?layer=dm_7100_point&page=0`)).status, 400);
  assert.equal((await fetch(`${origin}/preview/api/features?layer=dm_7100_point&pageSize=101`)).status, 400);
  assert.equal((await fetch(`${origin}/preview/api/features?layer=dm_9999_point`)).status, 404);
});

const writeFeatureGpkg = async (file) => {
  const database = new DatabaseSync(file);
  database.exec(`
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
    CREATE TABLE dm_8110_text_09_2500 (
      fid INTEGER PRIMARY KEY AUTOINCREMENT,
      geom BLOB NOT NULL,
      USER_ID INTEGER NOT NULL,
      DMCODE INTEGER,
      DMFILE TEXT NOT NULL,
      TEXT TEXT NOT NULL
    );
  `);
  const run = (sql, params) => database.prepare(sql).run(...params);
  run(
    "INSERT INTO gpkg_contents (table_name, data_type, identifier, srs_id) VALUES (?, 'features', ?, ?)",
    ["dm_7100_point_09_2500", "dm_7100_point_09_2500", 6677],
  );
  run(
    "INSERT INTO gpkg_contents (table_name, data_type, identifier, srs_id) VALUES (?, 'features', ?, ?)",
    ["dm_8110_text_09_2500", "dm_8110_text_09_2500", 6677],
  );
  run(
    "INSERT INTO gpkg_geometry_columns VALUES (?, 'geom', 'POINT', ?, 0, 0)",
    ["dm_7100_point_09_2500", 6677],
  );
  run(
    "INSERT INTO gpkg_geometry_columns VALUES (?, 'geom', 'POINT', ?, 0, 0)",
    ["dm_8110_text_09_2500", 6677],
  );
  run(
    "INSERT INTO dm_7100_point_09_2500 (geom, USER_ID, DMCODE, DMFILE, ANGLE) VALUES (?, 101, 7100, 'a.dm', 0)",
    [pointBlob(0, 0)],
  );
  run(
    "INSERT INTO dm_7100_point_09_2500 (geom, USER_ID, DMCODE, DMFILE, ANGLE) VALUES (?, 102, 7100, 'b.dm', 90)",
    [pointBlob(10, 20)],
  );
  run(
    "INSERT INTO dm_8110_text_09_2500 (geom, USER_ID, DMCODE, DMFILE, TEXT) VALUES (?, 201, 8110, 'c.dm', '大阪市')",
    [pointBlob(30, 40)],
  );
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
