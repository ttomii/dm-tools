import assert from "node:assert/strict";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {DatabaseSync} from "node:sqlite";
import os from "node:os";
import path from "node:path";
import {test} from "node:test";
import {GpkgFeatureStore} from "../src/node/gpkg-features.js";
import {closeDatabase, openDatabase, queryRows} from "../src/sqlite/sqlite-adapter.js";

test("SQLite adapter reads a database file without loading its bytes", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const file = path.join(root, "features.gpkg");
  const writer = new DatabaseSync(file);
  writer.exec("CREATE TABLE features (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
  writer.prepare("INSERT INTO features (name) VALUES (?)").run("sample");
  writer.close();

  const database = await openDatabase(file);
  try {
    assert.deepEqual(queryRows(database, "SELECT id, name FROM features"), [{id: 1, name: "sample"}]);
    assert.throws(() => queryRows(database, "INSERT INTO features (name) VALUES ('other')"));
  } finally {
    closeDatabase(database);
  }
});

test("GeoPackage store passes the database path to its adapter", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const file = path.join(root, "dm-sample.gpkg");
  await writeFile(file, "not a database");
  let openedFile;
  let closed = false;
  const adapter = {
    openDatabase: async (value) => {
      openedFile = value;
      return {};
    },
    closeDatabase: () => {
      closed = true;
    },
    queryRows: () => [],
    countRows: () => 0,
  };

  const store = await GpkgFeatureStore.create(root, {layerName: "dm-sample"}, {databaseAdapter: adapter});
  assert.equal(openedFile, file);
  store.close();
  assert.equal(closed, true);
});
