import {ApiInputError, parseFeatureQuery, parseGeometry, toFeature} from "../core/gpkg-feature-policy.js";

export const findRelatedFeatures = (store, query) => {
  const identity = parseIdentity(query);
  const {page, pageSize} = parseFeatureQuery(query);
  const tables = [...store.layers.values()].flat();
  const source = identity.sourceTable
    ? tables.filter((table) => table.tableName === identity.sourceTable)
    : tables.filter((table) => table.sourceLayer === identity.layer && !table.tableName.includes("_deco_"));
  const matching = source.flatMap((table) => readRows(store, table,
    "USER_ID = ? AND DMFILE = ? AND LEVEL = ?", [identity.userId, identity.dmfile, identity.level], 2));
  if (matching.length !== 1) return {features: [], ambiguous: matching.length > 1, page, pageSize, total: 0};
  const origin = matching[0];
  const params = [origin.tableName, origin.properties.USER_ID, origin.properties.DMFILE];
  const where = "SRC_LAYER = ? AND SRC_USER_ID = ? AND SRC_DMFILE = ?";
  const generated = tables.filter((table) => table.tableName.includes("_deco_"));
  return {source: origin, ambiguous: false, page, pageSize, ...readRelatedPage(store, generated, where, params, page, pageSize)};
};

const readRelatedPage = (store, tables, where, params, page, pageSize) => {
  const features = [];
  let offset = (page - 1) * pageSize;
  let total = 0;
  for (const table of tables) {
    const count = Number(store.databaseAdapter.queryRows(store.database,
      `SELECT COUNT(*) AS count FROM "${table.tableName}" WHERE ${where}`, params)[0].count);
    total += count;
    if (offset >= count) { offset -= count; continue; }
    if (features.length < pageSize) features.push(...readRows(store, table, where, params, pageSize - features.length, offset));
    offset = 0;
  }
  return {features, total};
};

const parseIdentity = (query) => {
  const userId = Number(query.get("userId"));
  const level = Number(query.get("level"));
  const layer = query.get("layer");
  const sourceTable = query.get("sourceTable") || undefined;
  const dmfile = query.get("dmfile");
  if (!Number.isSafeInteger(userId) || userId < 1 || !Number.isSafeInteger(level) || level < 1 || !dmfile
    || !/^dm_\d+_(point|line|polygon|text)(?:_deco_(point|line|polygon))?$/.test(layer ?? "")
    || (sourceTable && !/^dm_\d+_(point|line|polygon|text)_\d{2}_\d+$/.test(sourceTable))) {
    throw new ApiInputError("invalid feature identity");
  }
  return {userId, level, layer, sourceTable, dmfile};
};

const readRows = (store, table, where, params, limit, offset = 0) => store.databaseAdapter.queryRows(store.database,
  `SELECT * FROM "${table.tableName}" WHERE ${where} ORDER BY fid LIMIT ? OFFSET ?`, [...params, limit, offset],
).map((row) => toFeature({table, row, geometry: store.projectGeometry(parseGeometry(row.geom, table.kind), table.zone)}));

export const findStableFeature = (store, query) => {
  const layer = query.get("layer");
  const elementId = Number(query.get("elementId"));
  const level = Number(query.get("level"));
  const dmfile = query.get("dmfile");
  if (!/^dm_\d+_(point|line|polygon|text)$/.test(layer ?? "") || !Number.isSafeInteger(elementId)
    || elementId < 1 || !Number.isSafeInteger(level) || level < 1 || !dmfile) throw new ApiInputError("invalid stable identity");
  const values = [dmfile, elementId, level];
  const candidates = (store.layers.get(layer) ?? []).flatMap((table) => readRows(store, table,
    "DMFILE = ? AND DMELEMID = ? AND LEVEL = ?", values, 2));
  return {feature: candidates.length === 1 ? candidates[0] : undefined, ambiguous: candidates.length > 1};
};
