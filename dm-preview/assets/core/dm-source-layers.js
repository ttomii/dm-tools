const DEFAULT_SOURCE_LAYERS = {
  dm_default_line: "line",
  dm_default_point: "point",
  dm_default_polygon: "polygon",
};

export const expandDefaultStyleLayers = (layers, sourceLayers) => {
  if (sourceLayers.length === 0) return layers;
  const sourceLayersByKind = groupDefaultSourceLayers(sourceLayers);
  return layers.flatMap((layer) => {
    const kind = DEFAULT_SOURCE_LAYERS[layer["source-layer"]];
    if (!kind) return [layer];
    const expanded = sourceLayersByKind.get(kind) ?? [];
    return expanded
      .filter((sourceLayer) => !isExcludedDefaultCode(layer, sourceLayer))
      .map((sourceLayer) => ({
        ...layer,
        id: `${layer.id}-${getDmCode(sourceLayer)}`,
        "source-layer": sourceLayer,
      }));
  });
};

export const getDmSourceLayers = (style) => [...new Set((style.layers ?? [])
  .filter(isDmLayer)
  .map((layer) => layer["source-layer"]))]
  .sort(compareLayerName);

export const getSourceLayerKind = (sourceLayer) => {
  const match = /^dm_(?:default|\d+)_(point|line|polygon|text)(?:_deco_(point|line|polygon))?$/.exec(sourceLayer ?? "");
  return match?.[2] ?? match?.[1];
};

export const getDmCode = (sourceLayer) => {
  const match = /^dm_(\d+)_/.exec(sourceLayer);
  return match ? Number(match[1]) : undefined;
};

export const compareLayerName = (a, b) => a.localeCompare(b, "ja", {numeric: true});

const groupDefaultSourceLayers = (sourceLayers) => {
  const grouped = new Map([["line", []], ["point", []], ["polygon", []]]);
  for (const sourceLayer of sourceLayers) {
    const match = /^dm_\d+_(line|point|polygon)$/.exec(sourceLayer);
    if (match) grouped.get(match[1]).push(sourceLayer);
  }
  return grouped;
};

const isExcludedDefaultCode = (layer, sourceLayer) => {
  const dmcode = getDmCode(sourceLayer);
  const excluded = findLiteralNumberArray(layer.filter);
  return dmcode !== undefined && excluded.includes(dmcode);
};

const findLiteralNumberArray = (value) => {
  if (!Array.isArray(value)) return [];
  if (value[0] === "literal" && Array.isArray(value[1]) && value[1].every(Number.isInteger)) {
    return value[1];
  }
  for (const item of value) {
    const found = findLiteralNumberArray(item);
    if (found.length) return found;
  }
  return [];
};

const isDmLayer = (layer) => layer.source === "dm" && layer["source-layer"];
