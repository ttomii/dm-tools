import {readFile, stat} from "node:fs/promises";
import path from "node:path";
import {
  ApiInputError,
  parseFeatureQuery,
  parseGeometry,
  parseGpkgTable,
  toFeature,
} from "../core/gpkg-feature-policy.js";
import {projectGeometry} from "./gpkg-projection.js";
import {openDatabase, queryRows} from "./sqljs-adapter.js";

export {ApiInputError};

export class GpkgFeatureStore {
  static async create(root, manifest) {
    const gpkg = gpkgPath(root, manifest.layerName);
    await stat(gpkg).catch(() => {
      throw new ApiInputError(`GeoPackage is missing: ${path.basename(gpkg)}`, 404);
    });
    const database = await openDatabase(await readFile(gpkg));
    return new GpkgFeatureStore(database, readLayers(database, manifest.sourceLayers ?? []));
  }

  constructor(database, layers) {
    this.database = database;
    this.layers = layers;
  }

  search(query) {
    const {layer, page, pageSize} = parseFeatureQuery(query);
    const tables = this.layers.get(layer);
    if (!tables?.length) throw new ApiInputError(`unknown layer: ${layer}`, 404);
    const total = tables.reduce((sum, table) => sum + countRows(this.database, table.tableName), 0);
    const features = readPage(this.database, tables, (page - 1) * pageSize, pageSize);
    return {layer, page, pageSize, total, features};
  }
}

const gpkgPath = (root, layerName) => {
  if (typeof layerName !== "string" || !layerName || layerName.includes("/") || layerName.includes("\\")) {
    throw new ApiInputError("manifest layerName cannot be used as a GeoPackage file name", 500);
  }
  return path.join(root, `${layerName}.gpkg`);
};

const readLayers = (database, sourceLayers) => {
  const allowed = sourceLayers.length ? new Set(sourceLayers) : undefined;
  const layers = new Map();
  for (const row of queryRows(database, `
    SELECT c.table_name, g.geometry_type_name, g.srs_id
    FROM gpkg_contents c
    JOIN gpkg_geometry_columns g ON g.table_name = c.table_name
    WHERE c.data_type = 'features'
    ORDER BY c.table_name
  `)) {
    const table = parseGpkgTable(row.table_name, row.geometry_type_name, row.srs_id);
    if (!table || (allowed && !allowed.has(table.sourceLayer))) continue;
    const tables = layers.get(table.sourceLayer) ?? [];
    tables.push(table);
    layers.set(table.sourceLayer, tables);
  }
  return layers;
};

const countRows = (database, tableName) => {
  const result = database.exec(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`);
  return result[0]?.values[0]?.[0] ?? 0;
};

const readPage = (database, tables, offset, limit) => {
  const features = [];
  let remainingOffset = offset;
  for (const table of tables) {
    const count = countRows(database, table.tableName);
    if (remainingOffset >= count) {
      remainingOffset -= count;
      continue;
    }
    const needed = limit - features.length;
    features.push(...readFeatures(database, table, remainingOffset, needed));
    remainingOffset = 0;
    if (features.length >= limit) break;
  }
  return features;
};

const readFeatures = (database, table, offset, limit) => queryRows(
  database,
  `SELECT * FROM ${quoteIdentifier(table.tableName)} ORDER BY fid LIMIT ? OFFSET ?`,
  [limit, offset],
).map((row) => {
  const geometry = projectGeometry(parseGeometry(row.geom, table.kind), table.zone);
  return toFeature({table, row, geometry});
});

const quoteIdentifier = (identifier) => `"${identifier.replaceAll("\"", "\"\"")}"`;
