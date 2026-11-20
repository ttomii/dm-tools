export const diagnosticStyle = (manifest) => ({
  version: 8, name: "原形状", sources: {dm: {type: "vector", url: "__PMTILES_URL__"}},
  glyphs: "__GLYPHS_URL__", sprite: "__SPRITE_URL__",
  layers: [{id: "background", type: "background", paint: {"background-color": "#ffffff"}},
    ...(manifest.sourceLayers ?? []).map((sourceLayer) => {
      const kind = sourceLayer.split("_").at(-1);
      const type = kind === "point" || kind === "text" || sourceLayer === "dm_annotation" ? "circle" : kind === "polygon" ? "fill" : "line";
      const paint = type === "circle" ? {"circle-radius": 3, "circle-color": "#222222"}
        : type === "fill" ? {"fill-color": "#8b9ba8", "fill-opacity": 0.25} : {"line-color": "#222222", "line-width": 1.5};
      return {id: `inspect-${sourceLayer}`, source: "dm", "source-layer": sourceLayer, type, paint,
        metadata: {"dm:style-origin": "default"}};
    })],
});

export const applyInspectMode = (style, {mode = "normal", level, levels, code} = {}) => {
  const result = structuredClone(style);
  for (const layer of result.layers.filter((layer) => layer.source === "dm")) {
    const generated = layer["source-layer"]?.includes("_deco_");
    const filters = layer.filter ? [layer.filter] : [];
    if (levels) filters.push(["in", ["get", "LEVEL"], ["literal", levels]]);
    if (level) filters.push(["==", ["get", "LEVEL"], Number(level)]);
    if (code) filters.push(["==", ["get", "DMCODE"], Number(code)]);
    if (mode === "original" && generated) filters.push(["==", 1, 0]);
    if (filters.length) layer.filter = ["all", ...filters];
    if (mode === "generated" && generated) {
      const color = layer.type === "line" ? "line-color" : layer.type === "fill" ? "fill-color" : layer.type === "circle" ? "circle-color" : undefined;
      if (color) layer.paint = {...layer.paint, [color]: "#e00070"};
    }
  }
  return result;
};

export const relatedQuery = (feature) => {
  if (!feature) return undefined;
  const props = feature.properties;
  const generated = props.SRC_LAYER !== undefined;
  const layer = feature.sourceLayer ?? feature.source?.layer ?? feature.properties.sourceLayer;
  const table = props.SRC_LAYER ?? feature.tableName;
  const level = props.LEVEL ?? Number(table?.match(/_(\d{2})_(\d+)$/)?.[2]);
  const dmfile = generated ? props.SRC_DMFILE : props.DMFILE;
  if (!layer || !dmfile || !level) return undefined;
  return {layer: generated ? layer.replace(/_deco_(point|line|polygon)$/, "") : layer,
    sourceTable: generated ? props.SRC_LAYER : "", userId: generated ? props.SRC_USER_ID : props.USER_ID,
    dmfile, level};
};

export const stableFeatureQuery = (feature) => {
  const props = feature?.properties;
  if (!props || props.SRC_LAYER || !Number.isSafeInteger(props.DMELEMID) || props.DMELEMID < 1) return undefined;
  const layer = feature.sourceLayer;
  if (!layer || !props.DMFILE || !props.LEVEL) return undefined;
  return {layer, dmfile: props.DMFILE, level: props.LEVEL, elementId: props.DMELEMID};
};
