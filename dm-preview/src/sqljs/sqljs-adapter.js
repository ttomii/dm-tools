import {existsSync} from "node:fs";
import {createRequire} from "node:module";
import path from "node:path";
import initSqlJs from "sql.js";

const require = createRequire(import.meta.url);
let sqlModule;

export const openDatabase = async (bytes) => {
  sqlModule ??= await initSqlJs({
    locateFile: resolveSqlWasmPath,
  });
  return new sqlModule.Database(bytes);
};

export const resolveSqlWasmPath = (file) => {
  const packagedPath = path.join(path.dirname(process.execPath), "vendor", file);
  if (existsSync(packagedPath)) return packagedPath;
  return require.resolve(`sql.js/dist/${file}`);
};

export const queryRows = (database, sql, params = []) => {
  const statement = database.prepare(sql);
  try {
    statement.bind(params);
    const rows = [];
    while (statement.step()) rows.push(statement.getAsObject());
    return rows;
  } finally {
    statement.free();
  }
};

export const countRows = (database, tableName) => {
  const result = database.exec(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`);
  return result[0]?.values[0]?.[0] ?? 0;
};

const quoteIdentifier = (identifier) => `"${identifier.replaceAll("\"", "\"\"")}"`;
