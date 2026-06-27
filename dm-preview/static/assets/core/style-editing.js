import {getSourceLayerKind} from "./dm-source-layers.js";

export const editableKinds = (style) => [...new Set(editableLayers(style)
  .flatMap((layer) => layer.colorKind ? [layer.colorKind] : []))];

export const editableLayers = (style) => (Array.isArray(style.layers) ? style.layers : [])
  .filter((layer) => isRecord(layer) && layer.source === "dm" && typeof layer.id === "string")
  .map((layer) => {
    const colorProperties = editableColorProperties(layer);
    return {
      id: layer.id,
      sourceLayer: layer["source-layer"],
      type: layer.type,
      colorKind: colorKind(layer),
      colorProperties,
      visibility: layer.layout?.visibility === "none" ? "none" : "visible",
      editableColor: colorProperties.length > 0,
      editableVisibility: true,
    };
  })
  .filter((layer) => layer.editableColor || layer.editableVisibility);

export const editableColorProperties = (layer) => {
  if (layer.type === "symbol" && layer.layout?.["icon-image"]) return ["icon-image"];
  if (layer.type === "symbol" && layer.layout?.["text-field"] && layer.paint?.["text-color"] !== undefined) return ["text-color"];
  if (layer.type === "line" && layer.paint?.["line-color"] !== undefined) return ["line-color"];
  if (layer.type === "circle") {
    if (layer.paint?.["circle-stroke-color"] !== undefined) return ["circle-stroke-color"];
    if (layer.paint?.["circle-color"] !== undefined) return ["circle-color"];
  }
  if (layer.type === "fill") {
    return ["fill-color", "fill-outline-color"].filter((property) => layer.paint?.[property] !== undefined);
  }
  return [];
};

export const colorKind = (layer) => {
  const sourceKind = getSourceLayerKind(layer["source-layer"]);
  if (layer.type === "symbol" && layer.layout?.["icon-image"]) return "icon";
  if (layer.type === "symbol" && layer.layout?.["text-field"]) return "text";
  if (layer.type === "circle") return "icon";
  if (layer.type === "line") return sourceKind === "polygon" ? "polygon" : "line";
  if (layer.type === "fill") return "polygon";
  return undefined;
};

export const toHexColor = (value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;

export const findLayerById = (style, id) => style?.layers?.find((layer) => layer.id === id);

export const findBaseLayerForRuntime = (style, id) => style?.layers?.find((layer) => layer.id === id || id.startsWith(`${layer.id}-`));

export const runtimeLayerIds = (style, id) => style.layers
  .filter((layer) => layer.id === id || layer.id.startsWith(`${id}-`))
  .map((layer) => layer.id);

export const layerVisibility = (layer) => layer?.layout?.visibility === "none" ? "none" : "visible";

export const runtimeVisibility = ({dmVisible, layerVisible}) => dmVisible && layerVisible ? "visible" : "none";

const isRecord = (value) => typeof value === "object" && Boolean(value) && !Array.isArray(value);
