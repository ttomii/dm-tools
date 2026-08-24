import {ANNOTATION_SOURCE_LAYER, expandDefaultStyleLayers, getDmCode, isAnnotationSourceLayer} from "./dm-source-layers.js";

const GSI_PALE_TILE_URL = "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png";
const GSI_ATTRIBUTION = "<a href=\"https://maps.gsi.go.jp/development/ichiran.html\" target=\"_blank\" rel=\"noopener\">地理院タイル</a>";

export const createRuntimeStyle = (baseStyle, manifest, options) => {
  const style = usesCommonAnnotationSourceLayer(manifest) && options.mergeAnnotationLayers !== false
    ? mergeAnnotationStyleLayers(baseStyle)
    : structuredClone(baseStyle);
  style.sources.dm.url = `pmtiles://${options.resourceUrl(manifest.pmtiles)}`;
  style.sprite = options.resourceUrl("sprite");
  style.glyphs = `${options.resourceUrl("glyphs")}/{fontstack}/{range}.pbf`;
  const layers = shouldExpandDefaultStyleLayers(manifest, options)
    ? expandDefaultStyleLayers(style.layers, manifest.sourceLayers ?? [])
    : style.layers;
  style.layers = hideHiddenDmFeatures(layers);
  style.sources.gsi = {
    type: "raster",
    tiles: [GSI_PALE_TILE_URL],
    tileSize: 256,
    maxzoom: 18,
    attribution: GSI_ATTRIBUTION,
  };
  const backgroundIndex = style.layers.findIndex((layer) => layer.id === "background");
  style.layers.splice(backgroundIndex + 1, 0, {
    id: "gsi-pale",
    type: "raster",
    source: "gsi",
    layout: {visibility: options.basemapVisible ? "visible" : "none"},
  });
  for (const layer of style.layers) {
    if (layer.source === "dm") {
      layer.layout = {
        ...layer.layout,
        visibility: options.dmVisible ? layer.layout?.visibility ?? "visible" : "none",
      };
    }
  }
  return style;
};

export const createBundledStyle = (style, manifest, options = {}) => {
  const pmtiles = options.pmtiles ?? manifest.pmtiles;
  const bundled = usesCommonAnnotationSourceLayer(manifest)
    ? mergeAnnotationStyleLayers(style)
    : structuredClone(style);
  bundled.layers = hideHiddenDmFeatures(
    expandDefaultStyleLayers(bundled.layers ?? [], manifest.sourceLayers ?? []),
  );
  bundled.metadata = {
    ...bundled.metadata,
    "dm:bounds": manifest.bounds,
    "dm:center": manifest.center,
    "dm:sourceLayers": manifest.sourceLayers,
  };
  bundled.sources = {
    ...bundled.sources,
    dm: {
      ...bundled.sources.dm,
      url: `pmtiles://./${pmtiles}`,
    },
  };
  bundled.sprite = "./sprite/sprite";
  bundled.glyphs = "./glyphs/{fontstack}/{range}.pbf";
  return bundled;
};

export const splitAnnotationStyleLayers = (style) => {
  const splitStyle = structuredClone(style);
  if (!Array.isArray(splitStyle.layers)) return splitStyle;
  splitStyle.layers = splitStyle.layers.flatMap(splitAnnotationStyleLayer);
  return splitStyle;
};

export const mergeAnnotationStyleLayers = (style) => {
  const mergedStyle = structuredClone(style);
  if (!Array.isArray(mergedStyle.layers)) return mergedStyle;

  const groups = new Map();
  const layers = [];
  for (const layer of mergedStyle.layers) {
    const dmCodes = annotationDmCodes(layer);
    if (!dmCodes.length) {
      layers.push(layer);
      continue;
    }

    const signature = annotationStyleSignature(layer);
    let group = groups.get(signature);
    if (!group) {
      group = {layer: {...layer, "source-layer": ANNOTATION_SOURCE_LAYER}, dmCodes: new Set()};
      groups.set(signature, group);
      layers.push(group.layer);
    }
    for (const dmCode of dmCodes) group.dmCodes.add(dmCode);
    group.layer.filter = withAnnotationDmCodeFilter(layer.filter, group.dmCodes);
  }
  mergedStyle.layers = layers;
  return mergedStyle;
};

const splitAnnotationStyleLayer = (layer) => {
  const dmCodes = annotationDmCodes(layer);
  if (!dmCodes.length) return [layer];
  return dmCodes.map((dmCode, index) => {
    const splitLayer = structuredClone(layer);
    splitLayer.id = index === 0 ? layer.id : `${layer.id}-${dmCode}`;
    splitLayer["source-layer"] = ANNOTATION_SOURCE_LAYER;
    splitLayer.filter = withAnnotationDmCodeFilter(layer.filter, [dmCode]);
    return splitLayer;
  });
};

export const styleLabel = (styleUrl, manifest) => {
  const level = /^maplibre\/style-(\d+)\.json$/.exec(styleUrl)?.[1]
    ?? (manifest.styles?.length === 1 ? manifest.levels[0] : undefined);
  return level ? `Level ${level}` : styleUrl;
};

const DMSKIP_VISIBLE_FILTER = ["!=", ["get", "DMSKIP"], 1];
const DM6101_VISIBLE_FILTER = ["!=", ["get", "DMFIGTYPE"], 12];

const shouldExpandDefaultStyleLayers = (manifest, options) => {
  if (options.styleUrl) return options.styleUrl !== "style.json";
  return !manifest.styles?.includes("style.json");
};

const usesCommonAnnotationSourceLayer = (manifest) => (
  manifest.sourceLayers?.includes(ANNOTATION_SOURCE_LAYER) ?? false
);

const annotationDmCodes = (layer) => {
  if (!isAnnotationLayer(layer)) return [];
  const sourceLayerCode = getDmCode(layer["source-layer"]);
  const filterCodes = findAnnotationDmCodes(layer.filter);
  return [...new Set([
    ...(sourceLayerCode === undefined ? [] : [sourceLayerCode]),
    ...filterCodes,
  ])];
};

const isAnnotationLayer = (layer) => (
  layer?.source === "dm" &&
  layer.type === "symbol" &&
  isAnnotationSourceLayer(layer["source-layer"]) &&
  layer.layout?.["text-field"] !== undefined
);

const findAnnotationDmCodes = (filter) => {
  if (!Array.isArray(filter)) return [];
  if (filter[0] === "==" && isDmCodeGetExpression(filter[1]) && Number.isInteger(filter[2])) {
    return [filter[2]];
  }
  if (
    filter[0] === "in" &&
    isDmCodeGetExpression(filter[1]) &&
    Array.isArray(filter[2]) &&
    filter[2][0] === "literal" &&
    Array.isArray(filter[2][1])
  ) {
    return filter[2][1].filter(Number.isInteger);
  }
  return filter.flatMap(findAnnotationDmCodes);
};

const isDmCodeGetExpression = (value) => (
  Array.isArray(value) && value.length === 2 && value[0] === "get" && value[1] === "DMCODE"
);

const annotationStyleSignature = (layer) => {
  const {id: _id, filter, "source-layer": _sourceLayer, ...rendering} = layer;
  return stableStringify({...rendering, filter: withoutAnnotationDmCodeFilter(filter)});
};

const withoutAnnotationDmCodeFilter = (filter) => {
  if (isAnnotationDmCodeFilter(filter)) return undefined;
  if (!Array.isArray(filter) || filter[0] !== "all") return filter;
  const conditions = filter.slice(1).filter((condition) => !isAnnotationDmCodeFilter(condition));
  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return ["all", ...conditions];
};

const isAnnotationDmCodeFilter = (filter) => (
  Array.isArray(filter) &&
  ((filter[0] === "==" && isDmCodeGetExpression(filter[1]) && Number.isInteger(filter[2])) ||
    (filter[0] === "in" && isDmCodeGetExpression(filter[1]) &&
      Array.isArray(filter[2]) && filter[2][0] === "literal"))
);

const withAnnotationDmCodeFilter = (filter, dmCodes) => {
  const condition = ["in", ["get", "DMCODE"], ["literal", [...dmCodes].sort((left, right) => left - right)]];
  const baseFilter = withoutAnnotationDmCodeFilter(filter);
  if (!baseFilter) return condition;
  if (Array.isArray(baseFilter) && baseFilter[0] === "all") return [...baseFilter, condition];
  return ["all", baseFilter, condition];
};

const stableStringify = (value) => JSON.stringify(stableValue(value));

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
};

const hideHiddenDmFeatures = (layers) => layers.map((layer) => {
  if (layer.source !== "dm") return layer;
  return {
    ...layer,
    filter: withDmVisibilityFilters(layer),
  };
});

const withDmVisibilityFilters = (layer) => {
  const filters = [DMSKIP_VISIBLE_FILTER];
  if (layer["source-layer"] === "dm_6101_line") filters.push(DM6101_VISIBLE_FILTER);
  return filters.reduce((filter, visibilityFilter) => withFilter(filter, visibilityFilter), layer.filter);
};

const withFilter = (filter, required) => {
  if (containsFilter(filter, required)) return filter;
  if (!filter) return required;
  if (Array.isArray(filter) && filter[0] === "all") return [...filter, required];
  return ["all", filter, required];
};

const containsFilter = (filter, required) => {
  if (!Array.isArray(filter)) return false;
  if (JSON.stringify(filter) === JSON.stringify(required)) return true;
  return filter[0] === "all" && filter.slice(1).some((part) => JSON.stringify(part) === JSON.stringify(required));
};

const isRecord = (value) => typeof value === "object" && Boolean(value) && !Array.isArray(value);
