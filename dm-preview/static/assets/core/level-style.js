import {getZoomByScale} from "./map-scale.js";

export const presentationLevel = (level) => Math.min(level, 5000);

// The denominator at the boundary belongs to the coarser dataset. MapLibre's
// minzoom is inclusive, so move the boundary one floating-point step upward.
const after = (value) => value + Number.EPSILON * Math.max(1, Math.abs(value));
const SIZE_PROPERTIES = new Set([
  "line-width", "line-gap-width", "line-offset", "line-blur",
  "circle-radius", "circle-stroke-width", "text-size", "text-halo-width",
  "text-halo-blur", "icon-size", "icon-halo-width", "icon-halo-blur",
]);

export const createLevelStyle = (templates, manifest) => {
  const levels = [...new Set(manifest.levels)].sort((a, b) => a - b);
  const style = structuredClone(templates[presentationLevel(levels[0])]);
  if (levels.length > 1) style.name = "DM";
  style.metadata = {...style.metadata, "dm:levels": levels};
  if (levels.length === 1) style.metadata["dm:map-level"] = levels[0];
  else delete style.metadata["dm:map-level"];
  style.layers = style.layers.filter((layer) => layer.source !== "dm");
  for (const [index, level] of levels.entries()) {
    const base = presentationLevel(level);
    const layers = structuredClone(templates[base].layers).filter((layer) => layer.source === "dm");
    for (const layer of layers) {
      layer.id = `${layer.id}-level-${level}`;
      layer.filter = replaceLevel(layer.filter, level);
      const zoomShift = Math.log2(level / base);
      if (layer.minzoom !== undefined) layer.minzoom = Math.max(0, layer.minzoom - zoomShift - 1);
      if (layer.maxzoom !== undefined) layer.maxzoom -= zoomShift;
      for (const group of [layer.paint, layer.layout]) {
        for (const property of Object.keys(group ?? {})) {
          if (SIZE_PROPERTIES.has(property)) group[property] = scaleSize(group[property], level / base);
        }
      }
      if (levels[index + 1]) {
        layer.minzoom = Math.max(layer.minzoom ?? 0, after(getZoomByScale(presentationLevel(levels[index + 1]), manifest.center[1])));
      }
      if (index > 0) {
        layer.maxzoom = Math.min(layer.maxzoom ?? 24, after(getZoomByScale(base, manifest.center[1])));
      }
      style.layers.push(layer);
    }
  }
  return style;
};

const replaceLevel = (value, level) => {
  if (!Array.isArray(value)) return value;
  if (value[0] === "==" && value[1]?.[0] === "get" && value[1][1] === "LEVEL") {
    return ["==", ["get", "LEVEL"], level];
  }
  return value.map((item) => replaceLevel(item, level));
};

const scaleSize = (value, ratio) => {
  if (typeof value === "number") return value * ratio;
  if (value[0] === "interpolate" && value[2]?.[0] === "zoom") {
    // Shift the zoom stops as well as the visibility range so sizes continue
    // scaling below the template's original minimum zoom.
    const shifted = value.map((item, index) => index >= 3 && index % 2 === 1 ? item - Math.log2(ratio) : item);
    shifted.splice(3, 0, shifted[3] - 1, scaleSize(value[4], 0.5));
    if (ratio > 1) shifted.push(value.at(-2), scaleSize(value.at(-1), ratio));
    return shifted;
  }
  return ratio === 1 ? value : ["*", value, ratio];
};
