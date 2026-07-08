import assert from "node:assert/strict";
import path from "node:path";
import {test} from "node:test";
import {openDatabase, queryRows, resolveSqlWasmPath} from "../src/sqljs/sqljs-adapter.js";

test("resolveSqlWasmPath resolves the installed sql.js wasm asset", () => {
  const wasm = resolveSqlWasmPath("sql-wasm.wasm");

  assert.equal(path.basename(wasm), "sql-wasm.wasm");
  assert.match(wasm, /sql\.js[/\\]dist[/\\]sql-wasm\.wasm$/);
});

test("openDatabase initializes sql.js without runtime package resolution", async () => {
  const database = await openDatabase();
  try {
    assert.deepEqual(queryRows(database, "SELECT 1 AS value"), [{value: 1}]);
  } finally {
    database.close();
  }
});
