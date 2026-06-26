import path from "node:path";
import {fileURLToPath} from "node:url";
import initSqlJs from "sql.js";

let sqlModule;

export const openDatabase = async (bytes) => {
  sqlModule ??= await initSqlJs({
    locateFile: (file) => path.join(path.dirname(fileURLToPath(import.meta.resolve("sql.js"))), file),
  });
  return new sqlModule.Database(bytes);
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
