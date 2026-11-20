import {findRelatedFeatures, findStableFeature} from "./gpkg-relations.js";
import {readFile, realpath, stat} from "node:fs/promises";
import path from "node:path";
import {
  ApiInputError,
  parseFeatureQuery,
  parseGeometry,
  parseGpkgTable,
  toFeature,
} from "../core/gpkg-feature-policy.js";
import {parseFeatureInventory} from "../core/style-inventory.js";
import {resolveOutputPath} from "./manifest.js";
import {ANNOTATION_SOURCE_LAYER} from "../core/dm-source-layers.js";

export {ApiInputError};

export class GpkgFeatureStore {
  static async create(root, manifest, options = {}) {
    const gpkg = gpkgPath(root, manifest.layerName);
    await stat(gpkg).catch(() => {
      throw new ApiInputError(`GeoPackage is missing: ${path.basename(gpkg)}`, 404);
    });
    const adapter = requiredDatabaseAdapter(options.databaseAdapter);
    const database = await adapter.openDatabase(gpkg);
    try {
      return new GpkgFeatureStore(database, readLayers(database, manifest.sourceLayers ?? [], adapter), {
        ...options,
        databaseAdapter: adapter,
      });
    } catch (error) {
      adapter.closeDatabase(database);
      throw error;
    }
  }

  constructor(database, layers, options) {
    this.database = database;
    this.databaseAdapter = options.databaseAdapter;
    this.layers = layers;
    this.projectGeometry = options.projectGeometry ?? identityProjection;
    this.closed = false;
  }

  search(query) {
    const {layer, page, pageSize, level, code} = parseFeatureQuery(query);
    const available = this.layers.get(layer);
    if (!available?.length) throw new ApiInputError(`unknown layer: ${layer}`, 404);
    const tables = available.filter((table) => {
      const match = /^dm_(\d+)_(?:polygon|line|point|text)_\d{2}_(\d+)/.exec(table.tableName);
      if (!match) return level === undefined && code === undefined;
      return (code === undefined || Number(match[1]) === code) && (level === undefined || Number(match[2]) === level);
    });
    const total = tables.reduce((sum, table) => sum + this.databaseAdapter.countRows(this.database, table.tableName), 0);
    const features = readPage(this.database, tables, (page - 1) * pageSize, pageSize, {
      databaseAdapter: this.databaseAdapter,
      projectGeometry: this.projectGeometry,
    });
    return {layer, page, pageSize, total, features};
  }

  restore(query) {
    return findStableFeature(this, query);
  }

  related(query) {
    return findRelatedFeatures(this, query);
  }

  geojson() {
    return {type: "FeatureCollection", features: [...this.layers.values()].flatMap(tables => tables.flatMap(table =>
      readFeatures(this.database, table, 0, this.databaseAdapter.countRows(this.database, table.tableName), {
        databaseAdapter: this.databaseAdapter, projectGeometry: this.projectGeometry,
      }).map(feature => ({type: "Feature", id: feature.id, geometry: feature.geometry,
        properties: {...geojsonProperties(feature.properties, table), DM_SOURCE_LAYER: feature.sourceLayer, DM_TABLE: feature.tableName}})),
    ))};
  }

  inventory() {
    return {version: 1, entries: [...this.layers.values()].flatMap((tables) => tables.flatMap((table) => {
      const match = /^dm_(\d+)_(point|line|polygon|text)_\d{2}_(\d+)(?:_deco_(point|line|polygon))?$/.exec(table.tableName);
      if (!match) return [];
      const generated = Boolean(match[4]);
      const columns = generated ? "SRC_DMCODE, DECORATION, SRC_LAYER" : "DMCODE, NULL AS DECORATION, NULL AS SRC_LAYER";
      const group = generated ? "SRC_DMCODE, DECORATION, SRC_LAYER" : "DMCODE";
      return this.databaseAdapter.queryRows(this.database,
        `SELECT ${columns}, COUNT(*) AS count FROM ${quoteIdentifier(table.tableName)} GROUP BY ${group} ORDER BY ${group}`,
      ).map((row) => ({level: Number(match[3]), dmCode: Number(row[generated ? "SRC_DMCODE" : "DMCODE"]),
        kind: match[4] ?? match[2], sourceLayer: table.sourceLayer, count: Number(row.count),
        decoration: row.DECORATION, srcLayer: row.SRC_LAYER}));
    }))};
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.databaseAdapter.closeDatabase(this.database);
  }
}

export const createLazyFeatureStore = (root, manifest, options = {}) => {
  let storePromise;
  let geojsonPromise;
  return {
    geojson: () => geojsonPromise ??= (async () => {
      storePromise ??= GpkgFeatureStore.create(root, manifest, options);
      return (await storePromise).geojson();
    })(),
    restore: async (query) => {
      storePromise ??= GpkgFeatureStore.create(root, manifest, options);
      return (await storePromise).restore(query);
    },
    related: async (query) => {
      storePromise ??= GpkgFeatureStore.create(root, manifest, options);
      return (await storePromise).related(query);
    },
    search: async (query) => {
      storePromise ??= GpkgFeatureStore.create(root, manifest, options);
      return (await storePromise).search(query);
    },
    inventory: async () => {
      if (manifest.featureInventory) {
        const file = await realpath(resolveOutputPath(root, manifest.featureInventory));
        const canonicalRoot = await realpath(root);
        if (!file.startsWith(`${canonicalRoot}${path.sep}`)) throw new ApiInputError("inventory path is outside output", 400);
        return parseFeatureInventory(JSON.parse(await readFile(file, "utf8")));
      }
      try {
        storePromise ??= GpkgFeatureStore.create(root, manifest, options);
        return (await storePromise).inventory();
      } catch (error) {
        if (error instanceof ApiInputError && error.status === 404) return {version: 1, entries: [], complete: false};
        throw error;
      }
    },
    close: () => {
      storePromise?.then((store) => store.close()).catch(() => {});
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
  const useCommonAnnotationSourceLayer = allowed?.has(ANNOTATION_SOURCE_LAYER) ?? false;
  const layers = new Map();
  for (const row of databaseAdapter.queryRows(database, `
    SELECT c.table_name, g.geometry_type_name, g.srs_id
    FROM gpkg_contents c
    JOIN gpkg_geometry_columns g ON g.table_name = c.table_name
    WHERE c.data_type = 'features'
    ORDER BY c.table_name
  `)) {
    const parsedTable = parseGpkgTable(row.table_name, row.geometry_type_name, row.srs_id);
    const table = useCommonAnnotationSourceLayer && parsedTable?.sourceLayer.endsWith("_text")
      ? {...parsedTable, sourceLayer: ANNOTATION_SOURCE_LAYER}
      : parsedTable;
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
  if (adapter?.openDatabase && adapter?.closeDatabase && adapter?.queryRows && adapter?.countRows) return adapter;
  throw new ApiInputError("GeoPackage database adapter is not configured", 500);
};

const geojsonProperties = (properties, table) => {
  const match = /^dm_(\d+)_(?:point|line|polygon|text)_(\d{2})_(\d+)/.exec(table.tableName);
  const result = {...properties};
  if (match) {
    result.DMCODE ??= result.SRC_DMCODE ?? Number(match[1]);
    result.ZONE ??= Number(match[2]);
    result.LEVEL ??= Number(match[3]);
  }
  if (typeof result.ANGLE === "number") result.ROTATION = ((table.sourceLayer.endsWith("_text") ? -result.ANGLE : 90 - result.ANGLE) % 360 + 360) % 360;
  if (typeof result.TEXT === "string") result.TEXT_VERTICAL = result.TEXT.replaceAll("ー", "︱");
  return result;
};
