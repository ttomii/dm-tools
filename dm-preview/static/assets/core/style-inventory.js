import {getDmCode, getSourceLayerKind} from "./dm-source-layers.js";
import {styleOrigin} from "./style-origin.js";

export const INVENTORY_GROUPS = ["個別定義なし", "個別定義あり／自動生成図形あり", "判定不明"];
export const STYLE_STATES = {individual: "個別定義", default: "デフォルト", missing: "描画定義なし", mixed: "一部個別定義", unknown: "判定不明"};

export const parseFeatureInventory = (value) => {
  if (value?.version !== 1 || !Array.isArray(value.entries)) throw new Error("未対応のデータ内訳形式です");
  for (const entry of value.entries) {
    if (!Number.isSafeInteger(entry.level) || entry.level <= 0 || !Number.isSafeInteger(entry.dmCode) || entry.dmCode < 0 ||
      !["point", "line", "polygon", "text"].includes(entry.kind) || !Number.isSafeInteger(entry.count) || entry.count <= 0 ||
      !(entry.sourceLayer === "dm_annotation" || /^dm_\d+_(point|line|polygon|text)(?:_deco_(point|line|polygon))?$/.test(entry.sourceLayer)) ||
      (entry.decoration != null && (typeof entry.decoration !== "string" || !entry.decoration)) ||
      (entry.srcLayer != null && typeof entry.srcLayer !== "string")) throw new Error("データ内訳の項目が不正です");
  }
  return {version: 1, entries: value.entries, complete: value.complete !== false};
};

export const createStyleInventory = (inventory, style, manifest) => {
  const complete = inventory?.complete !== false && Boolean(inventory);
  const entries = complete ? inventory.entries : inferredEntries(manifest);
  const groups = new Map();
  for (const entry of entries) {
    const key = `${entry.level}:${entry.dmCode}`;
    const row = groups.get(key) ?? {level: entry.level, dmCode: entry.dmCode, entries: [], complete};
    row.entries.push({...entry, ...entryStyle(entry, style)});
    groups.set(key, row);
  }
  return [...groups.values()].map(classifyRow).sort((a, b) => a.group - b.group || a.level - b.level || a.dmCode - b.dmCode);
};

const inferredEntries = (manifest) => (manifest.sourceLayers ?? []).flatMap((sourceLayer) => {
  const dmCode = getDmCode(sourceLayer);
  if (dmCode === undefined) return [];
  return manifest.levels.map((level) => ({level, dmCode, sourceLayer, kind: getSourceLayerKind(sourceLayer),
    count: undefined, decoration: undefined, generated: sourceLayer.includes("_deco_")}));
});

const classifyRow = (row) => {
  const individual = row.entries.some((entry) => entry.hasIndividual);
  const generated = row.entries.some((entry) => entry.decoration != null || entry.generated);
  const group = row.complete && (individual || generated) ? 1
    : !row.complete || row.entries.some((entry) => entry.status === "unknown") ? 2 : 0;
  const partial = individual && row.entries.some((entry) => entry.status !== "individual");
  return {...row, generated, group, partial};
};

const entryStyle = (entry, style) => {
  const candidates = (style?.layers ?? []).filter((layer) => layer.source === "dm" && sourceMatches(layer, entry));
  const layers = candidates.filter((layer) => filterMatches(layer.filter, entry) !== false);
  const origins = new Set(layers.map(styleOrigin));
  const uncertain = layers.some((layer) => filterMatches(layer.filter, entry) === undefined);
  const status = uncertain || origins.has("unknown") ? "unknown" : origins.has("individual")
    ? origins.size > 1 ? "mixed" : "individual" : origins.has("default") ? "default" : "missing";
  return {status, hasIndividual: layers.some((layer) => styleOrigin(layer) === "individual" && filterMatches(layer.filter, entry) === true), layers: layers.map((layer) => ({id: layer.id, origin: styleOrigin(layer), sourceLayer: layer["source-layer"] ?? layer.metadata?.["dm:source-layer"]}))};
};

const sourceMatches = (layer, entry) => {
  const source = layer["source-layer"] ?? layer.metadata?.["dm:source-layer"];
  return source === entry.sourceLayer || (!entry.decoration && !entry.generated && source === `dm_default_${entry.kind}`);
};

// Evaluate code/level/decoration restrictions only; other properties describe
// subtypes within an entry (e.g. horizontal and vertical annotation).
const filterMatches = (filter, entry) => {
  if (!Array.isArray(filter)) return filter === false ? false : true;
  const [op, ...args] = filter;
  if (op === "all" || op === "any") {
    const results = args.map((part) => filterMatches(part, entry));
    if (op === "all" && results.includes(false)) return false;
    if (op === "any" && results.includes(true)) return true;
    return results.includes(undefined) ? undefined : op === "all";
  }
  if (!hasInventoryProperty(filter)) return true;
  if (op === "!") {
    const result = filterMatches(args[0], entry);
    return result === undefined ? undefined : !result;
  }
  const left = expressionValue(args[0], entry);
  const right = expressionValue(args[1], entry);
  if (left === undefined || right === undefined) return undefined;
  if (op === "==") return left === right;
  if (op === "!=") return left !== right;
  if (op === "in" && Array.isArray(right)) return right.includes(left);
  return undefined;
};

const hasInventoryProperty = (value) => Array.isArray(value) &&
  ((value[0] === "get" && ["LEVEL", "DMCODE", "DECORATION"].includes(value[1])) || value.some(hasInventoryProperty));

const expressionValue = (value, entry) => {
  if (!Array.isArray(value)) return value;
  if (value[0] === "literal") return value[1];
  if (value[0] === "get") return ({LEVEL: entry.level, DMCODE: entry.dmCode, DECORATION: entry.decoration})[value[1]];
  return undefined;
};
