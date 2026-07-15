let driverPromise;

export const openDatabase = async (file) => {
  const {driver, runtime} = await loadDriver();
  const database = runtime === "bun"
    ? new driver.Database(file, {readonly: true})
    : new driver.DatabaseSync(file, {readOnly: true, allowExtension: false});
  return {database, runtime};
};

export const closeDatabase = ({database}) => database.close();

export const queryRows = ({database, runtime}, sql, params = []) => {
  const rows = runtime === "bun"
    ? database.query(sql).all(...params)
    : database.prepare(sql).all(...params);
  return rows.map((row) => ({...row}));
};

export const countRows = (database, tableName) => {
  const result = queryRows(database, `SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`);
  return result[0]?.count ?? 0;
};

const loadDriver = async () => {
  driverPromise ??= import(isBunRuntime() ? "bun:sqlite" : "node:sqlite").then((driver) => ({
    driver,
    runtime: isBunRuntime() ? "bun" : "node",
  }));
  return driverPromise;
};

const isBunRuntime = () => typeof process.versions.bun === "string";

const quoteIdentifier = (identifier) => `"${identifier.replaceAll("\"", "\"\"")}"`;
