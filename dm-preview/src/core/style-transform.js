import {expandDefaultStyleLayers} from "./dm-source-layers.js";

const GSI_PALE_TILE_URL = "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png";
const GSI_ATTRIBUTION = "<a href=\"https://maps.gsi.go.jp/development/ichiran.html\" target=\"_blank\" rel=\"noopener\">地理院タイル</a>";

export const createRuntimeStyle = (baseStyle, manifest, options) => {
  const style = structuredClone(baseStyle);
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
  const bundled = structuredClone(style);
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
