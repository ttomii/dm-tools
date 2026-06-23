import {readFile, stat} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import proj4 from "proj4";
import initSqlJs from "sql.js";

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 100;
const WKB_OFFSET = 40;
const ORIGINS = [
  [33.0, 129.5],
  [33.0, 131.0],
  [36.0, 132.166666666667],
  [33.0, 133.5],
  [36.0, 134.333333333333],
  [36.0, 136.0],
  [36.0, 137.166666666667],
  [36.0, 138.5],
  [36.0, 139.833333333333],
  [40.0, 140.833333333333],
  [44.0, 140.25],
  [44.0, 142.25],
  [44.0, 144.25],
  [26.0, 142.0],
  [26.0, 127.5],
  [26.0, 124.0],
  [26.0, 131.0],
  [20.0, 136.0],
  [26.0, 154.0],
];

let sqlModule;

export class ApiInputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ApiInputError";
    this.status = status;
  }
}

export class GpkgFeatureStore {
  static async create(root, manifest) {
    const gpkg = gpkgPath(root, manifest.layerName);
    await stat(gpkg).catch(() => {
      throw new ApiInputError(`GeoPackage is missing: ${path.basename(gpkg)}`, 404);
    });
    const database = await openDatabase(gpkg);
    return new GpkgFeatureStore(database, readLayers(database, manifest.sourceLayers ?? []));
  }

  constructor(database, layers) {
    this.database = database;
    this.layers = layers;
  }

  search(query) {
    const layer = parseLayer(query.get("layer"));
    const page = parsePositiveInteger(query.get("page"), "page", 1);
    const pageSize = parsePositiveInteger(query.get("pageSize"), "pageSize", PAGE_SIZE_DEFAULT);
    if (pageSize > PAGE_SIZE_MAX) throw new ApiInputError(`pageSize must be ${PAGE_SIZE_MAX} or less`);
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

const openDatabase = async (gpkg) => {
  sqlModule ??= await initSqlJs({
    locateFile: (file) => path.join(path.dirname(fileURLToPath(import.meta.resolve("sql.js"))), file),
  });
  return new sqlModule.Database(await readFile(gpkg));
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
    const table = parseTable(row.table_name, row.geometry_type_name, row.srs_id);
    if (!table || (allowed && !allowed.has(table.sourceLayer))) continue;
    const tables = layers.get(table.sourceLayer) ?? [];
    tables.push(table);
    layers.set(table.sourceLayer, tables);
  }
  return layers;
};

const parseTable = (tableName, geometryType, srsId) => {
  const match = /^dm_(\d+)_(polygon|line|point|text)_(\d{2})_(\d+)(?:_deco_(polygon|line|point))?$/.exec(tableName);
  if (!match) return;
  const kind = match[5] ?? match[2];
  if (kind !== geometryKind(geometryType)) return;
  const zone = zoneFromSrsId(srsId);
  if (!zone) throw new ApiInputError(`unsupported GeoPackage layer SRS: ${tableName}`, 500);
  const sourceLayer = match[5] ? `dm_${match[1]}_${match[2]}_deco_${match[5]}` : `dm_${match[1]}_${match[2]}`;
  return {tableName, sourceLayer, kind, zone};
};

const geometryKind = (name) => ({
  POLYGON: "polygon",
  LINESTRING: "line",
  POINT: "point",
}[String(name).toUpperCase()]);

const zoneFromSrsId = (srsId) => {
  const zone = Number(srsId) - 6668;
  return Number.isInteger(zone) && zone >= 1 && zone <= 19 ? zone : undefined;
};

const parseLayer = (value) => {
  if (!value || !/^dm_[0-9]+_(point|line|polygon|text)(?:_deco_(?:point|line|polygon))?$/.test(value)) {
    throw new ApiInputError("layer is required");
  }
  return value;
};

const parsePositiveInteger = (value, name, fallback) => {
  if (!value) return fallback;
  if (!/^[1-9]\d*$/.test(value)) throw new ApiInputError(`${name} must be a positive integer`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) throw new ApiInputError(`${name} is too large`);
  return parsed;
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
).map((row) => toFeature(table, row));

const toFeature = (table, row) => {
  const geometry = projectGeometry(parseGeometry(row.geom, table.kind), table.zone);
  const bbox = bounds(geometry.coordinates);
  const properties = Object.fromEntries(Object.entries(row).filter(([key]) => key !== "geom"));
  return {
    id: `${table.tableName}:${row.fid}`,
    tableName: table.tableName,
    fid: row.fid,
    sourceLayer: table.sourceLayer,
    geometry,
    bbox,
    center: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
    properties,
  };
};

const queryRows = (database, sql, params = []) => {
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

const parseGeometry = (blob, kind) => {
  const reader = new BlobReader(blob);
  reader.offset = WKB_OFFSET;
  if (reader.length < WKB_OFFSET + 5 || reader.string(0, 2) !== "GP" || reader.u8() !== 1) {
    throw new ApiInputError("invalid GeoPackage geometry", 500);
  }
  const type = reader.u32();
  if (type !== expectedWkbType(kind)) throw new ApiInputError("unexpected GeoPackage geometry type", 500);
  if (type === 1) return {type: "Point", coordinates: reader.coordinate()};
  if (type === 2) return {type: "LineString", coordinates: reader.coordinates()};
  if (reader.u32() !== 1) throw new ApiInputError("multiple polygon rings are not supported", 500);
  return {type: "Polygon", coordinates: [reader.coordinates()]};
};

const expectedWkbType = (kind) => kind === "polygon" ? 3 : kind === "line" ? 2 : 1;

const projectGeometry = (geometry, zone) => {
  if (geometry.type === "Point") return {...geometry, coordinates: projectPoint(geometry.coordinates, zone)};
  if (geometry.type === "LineString") {
    return {...geometry, coordinates: geometry.coordinates.map((point) => projectPoint(point, zone))};
  }
  return {
    ...geometry,
    coordinates: geometry.coordinates.map((ring) => ring.map((point) => projectPoint(point, zone))),
  };
};

const projectPoint = (point, zone) => {
  const [lat0, lon0] = ORIGINS[zone - 1];
  return proj4(
    `+proj=tmerc +lat_0=${lat0} +lon_0=${lon0} +k=0.9999 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +type=crs`,
    "WGS84",
    point,
  );
};

const bounds = (coordinates) => flatCoordinates(coordinates).reduce(
  (bbox, point) => [
    Math.min(bbox[0], point[0]),
    Math.min(bbox[1], point[1]),
    Math.max(bbox[2], point[0]),
    Math.max(bbox[3], point[1]),
  ],
  [Infinity, Infinity, -Infinity, -Infinity],
);

const flatCoordinates = (coordinates) => typeof coordinates[0] === "number"
  ? [coordinates]
  : coordinates.flatMap(flatCoordinates);

const quoteIdentifier = (identifier) => `"${identifier.replaceAll("\"", "\"\"")}"`;

class BlobReader {
  constructor(blob) {
    this.blob = blob;
    this.view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
    this.length = blob.byteLength;
    this.offset = 0;
  }

  string(start, end) {
    return String.fromCharCode(...this.blob.slice(start, end));
  }

  u8() {
    return this.view.getUint8(this.offset++);
  }

  u32() {
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  f64() {
    const value = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }

  coordinate() {
    return [this.f64(), this.f64()];
  }

  coordinates() {
    return Array.from({length: this.u32()}, () => this.coordinate());
  }
}
