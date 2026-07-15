import {readFile, stat} from "node:fs/promises";
import path from "node:path";
import {
  ApiInputError,
  parseFeatureQuery,
  parseGeometry,
  parseGpkgTable,
  toFeature,
} from "../core/gpkg-feature-policy.js";

export {ApiInputError};

export class GpkgFeatureStore {
  static async create(root, manifest, options = {}) {
    const gpkg = gpkgPath(root, manifest.layerName);
    await stat(gpkg).catch(() => {
      throw new ApiInputError(`GeoPackage is missing: ${path.basename(gpkg)}`, 404);
    });
    const adapter = requiredDatabaseAdapter(options.databaseAdapter);
    const database = await adapter.openDatabase(await readFile(gpkg));
    return new GpkgFeatureStore(database, readLayers(database, manifest.sourceLayers ?? [], adapter), {
      ...options,
      databaseAdapter: adapter,
    });
  }

  constructor(database, layers, options) {
    this.database = database;
    this.databaseAdapter = options.databaseAdapter;
    this.layers = layers;
    this.projectGeometry = options.projectGeometry ?? identityProjection;
  }

  search(query) {
    const {layer, page, pageSize} = parseFeatureQuery(query);
    const tables = this.layers.get(layer);
    if (!tables?.length) throw new ApiInputError(`unknown layer: ${layer}`, 404);
    const total = tables.reduce((sum, table) => sum + this.databaseAdapter.countRows(this.database, table.tableName), 0);
    const features = readPage(this.database, tables, (page - 1) * pageSize, pageSize, {
      databaseAdapter: this.databaseAdapter,
      projectGeometry: this.projectGeometry,
    });
    return {layer, page, pageSize, total, features};
  }
}

export const createLazyFeatureStore = (root, manifest, options = {}) => {
  let storePromise;
  return {
    search: async (query) => {
      storePromise ??= GpkgFeatureStore.create(root, manifest, options);
      return (await storePromise).search(query);
    },
  };
};

const gpkgPath = (root, layerName) => {
  if (typeof layerName !== "string" || !layerName || layerName.includes("/") || layerName.includes("\\")) {
    throw new ApiInputError("manifest layerName cannot be used as a GeoPackage file name", 500);
  }
  return path.join(root, `${layerName}.gpkg`);
};

const readLayers = (database, sourceLayers, databaseAdapter) => {
  const allowed = sourceLayers.length ? new Set(sourceLayers) : undefined;
  const layers = new Map();
  for (const row of databaseAdapter.queryRows(database, `
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

const readPage = (database, tables, offset, limit, options) => {
  const features = [];
  let remainingOffset = offset;
  for (const table of tables) {
    const count = options.databaseAdapter.countRows(database, table.tableName);
    if (remainingOffset >= count) {
      remainingOffset -= count;
      continue;
    }
    const needed = limit - features.length;
    features.push(...readFeatures(database, table, remainingOffset, needed, options));
    remainingOffset = 0;
    if (features.length >= limit) break;
  }
  return features;
};

const readFeatures = (database, table, offset, limit, options) => options.databaseAdapter.queryRows(
  database,
  `SELECT * FROM ${quoteIdentifier(table.tableName)} ORDER BY fid LIMIT ? OFFSET ?`,
  [limit, offset],
).map((row) => {
  const geometry = options.projectGeometry(parseGeometry(row.geom, table.kind), table.zone);
  return toFeature({table, row, geometry});
});

const quoteIdentifier = (identifier) => `"${identifier.replaceAll("\"", "\"\"")}"`;

const identityProjection = (geometry) => geometry;

const requiredDatabaseAdapter = (adapter) => {
  if (adapter?.openDatabase && adapter?.queryRows && adapter?.countRows) return adapter;
  throw new ApiInputError("GeoPackage database adapter is not configured", 500);
};
