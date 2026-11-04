// Preserve provenance through default expansion and annotation merging.
export const styleOrigin = (layer) => {
  const origin = layer.metadata?.["dm:style-origin"];
  if (origin === "individual" || origin === "default") return origin;
  if (/^dm_default_(point|line|polygon)$/.test(layer["source-layer"] ?? "")) return "default";
  if (/^dm-default-(point|line|polygon)-\d+-(line|outline|symbol)(?:-level-\d+)?(?:-\d+)?$/.test(layer.id ?? "")) return "default";
  if (/^dm-\d+-(point|line|polygon|text)-\d+-/.test(layer.id ?? "")) return "individual";
  return "unknown";
};

export const withStyleOrigins = (style) => ({
  ...style,
  layers: (style.layers ?? []).map((layer) => layer.source !== "dm" ? layer : {
    ...layer, metadata: {...layer.metadata, "dm:style-origin": styleOrigin(layer)},
  }),
});
