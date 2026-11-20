import {getZoomByScale} from "./map-scale.js";

export const MM_TO_PX = 96 / 25.4;

export const penWidthExpression = (pen, level, latitude, minzoom = 14, maxzoom = 24) => {
  const base = getZoomByScale(level, latitude);
  const width = (zoom) => scalePen(pen, 0.05 * MM_TO_PX * 2 ** (zoom - base));
  return ["interpolate", ["exponential", 2], ["zoom"], minzoom, width(minzoom), maxzoom, width(maxzoom)];
};
const scalePen = (pen, factor) => typeof pen === "number" ? pen * factor : ["*", pen, factor];

export const penForCode = (spec, code, level, kind) => {
  const alias = spec.aliases.find((entry) => code >= entry.from && code <= entry.to);
  const entry = spec.codes[code] ?? spec.codes[alias?.code];
  if (!entry) return {pen: 3, pages: [], origin: "default"};
  const reference = level === 250 ? 500 : level;
  const relevant = entry.rules.filter((rule) => rule.kind === kind);
  const candidates = relevant.length ? relevant : entry.rules.filter((rule) => rule.kind !== "text");
  const exact = candidates.filter((rule) => rule.levels.includes(reference));
  const rules = exact.length ? exact : candidates.filter((rule) => rule.levels.includes(
    candidates.some((rule) => rule.levels.includes(500)) ? 500 : candidates[0]?.levels[0]));
  if (!rules.length) return {pen: 3, pages: [], origin: "default"};
  const base = rules.find((rule) => !rule.figtypes.length) ?? rules.find((rule) => rule.figtypes.includes(11)) ?? rules[0];
  const variants = [...new Map(rules.flatMap((rule) => rule.figtypes.map((figtype) => [figtype, rule.pen]))).entries()]
    .filter(([, pen]) => pen !== base.pen).sort((a, b) => a[0] - b[0]);
  const pen = variants.length ? ["case", ...variants.flatMap(([figtype, number]) => [["==", ["get", "DMFIGTYPE"], figtype], number]), base.pen] : base.pen;
  return {pen, pages: [...new Set(rules.map((rule) => rule.page))], origin: !relevant.length ? "geometry-extension" : exact.length ? "spec" : "scale-extension"};
};

export const defaultPenExpression = (spec, level, kind) => {
  const groups = new Map();
  for (const code of Object.keys(spec.codes).map(Number)) {
    const pen = penForCode(spec, code, level, kind).pen;
    if (typeof pen !== "number" || pen !== 3) {
      const key = JSON.stringify(pen); const group = groups.get(key) ?? {codes: [], pen};
      group.codes.push(code); groups.set(key, group);
    }
  }
  return groups.size ? ["match", ["get", "DMCODE"], ...[...groups.values()].flatMap(({codes, pen}) => [codes, pen]), 3] : 3;
};

export const scaleZoomSize = (value, factor) => {
  if (typeof value === "number") return value * factor;
  if (value[0] === "interpolate" && value[2]?.[0] === "zoom") return value.map((item, index) =>
    index >= 4 && index % 2 === 0 ? scaleZoomSize(item, factor) : item);
  return factor === 1 ? value : ["*", value, factor];
};

const PAPER_SIZES = new Set(["circle-radius", "line-gap-width", "line-offset", "text-size", "text-halo-width", "icon-size"]);
export const rebasePenWidths = (style, latitude) => ({...style, layers: (style.layers ?? []).map((original) => {
  const reference = original.metadata?.["dm:size-reference-latitude"];
  if (reference === undefined && original.metadata?.["dm:pen-number"] === undefined) return original;
  const layer = {...original, paint: {...original.paint}, layout: {...original.layout}, metadata: {...original.metadata}};
  if (reference !== undefined) {
    const factor = Math.cos(reference * Math.PI / 180) / Math.cos(latitude * Math.PI / 180);
    for (const group of [layer.paint, layer.layout]) for (const property of Object.keys(group)) {
      if (PAPER_SIZES.has(property)) group[property] = scaleZoomSize(group[property], factor);
    }
    layer.metadata["dm:size-reference-latitude"] = latitude;
  }
  const pen = layer.metadata["dm:pen-number"];
  const level = layer.metadata["dm:pen-level"];
  const property = layer.metadata["dm:pen-property"];
  if (pen !== undefined && level && property) {
    layer.paint[property] = penWidthExpression(pen, level, latitude, layer.paint[property][3]);
  }
  return layer;
})});
