import {expandDefaultStyleLayers} from "./dm-source-layers.js";

const GSI_PALE_TILE_URL = "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png";
const GSI_ATTRIBUTION = "<a href=\"https://maps.gsi.go.jp/development/ichiran.html\" target=\"_blank\" rel=\"noopener\">地理院タイル</a>";

export const createRuntimeStyle = (baseStyle, manifest, options) => {
  const style = structuredClone(baseStyle);
  style.sources.dm.url = `pmtiles://${options.resourceUrl(manifest.pmtiles)}`;
  style.sprite = options.resourceUrl("sprite");
  style.glyphs = `${options.resourceUrl("glyphs")}/{fontstack}/{range}.pbf`;
  style.layers = expandDefaultStyleLayers(style.layers, manifest.sourceLayers ?? []);
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

export const createBundledStyle = (style, manifest) => {
  const bundled = structuredClone(style);
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
      url: `pmtiles://./${manifest.pmtiles}`,
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
