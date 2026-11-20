import {readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {getZoomByScale} from "../src/core/map-scale.js";
import {MM_TO_PX, penForCode, defaultPenExpression, penWidthExpression} from "../src/core/pen-width.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../static/maplibre");
const spec = JSON.parse(await readFile(path.join(root, "pen-spec.json"), "utf8"));
const changes = [];
const number = (value) => Math.round(value * 1e6) / 1e6;
const paperNumber = (value) => Math.round(value * 1e3) / 1e3;
const penNumbers = (pen) => typeof pen === "number" ? [pen] : [
  ...pen.filter((_, index) => index >= (pen[0] === "case" ? 2 : 3) && index % 2 === (pen[0] === "case" ? 0 : 1) && index < pen.length - 1).flatMap(penNumbers),
  ...penNumbers(pen.at(-1)),
];
const smallestPen = (pen) => Math.min(...penNumbers(pen));
const basePen = (pen) => typeof pen === "number" ? pen : pen.at(-1);
const oldMm = (width, level) => typeof width === "number" ? width / MM_TO_PX
  : typeof width?.[4] === "number" ? width[4] * 2 ** (getZoomByScale(level, 36) - width[3]) / MM_TO_PX : undefined;

const normalizeLayer = (layer, level) => {
  const property = layer.type === "line" ? "line-width" : layer.paint?.["circle-stroke-width"] ? "circle-stroke-width" : undefined;
  if (!property) return layer.source === "dm" ? {...layer, metadata: {...layer.metadata, "dm:size-reference-latitude": 36}} : layer;
  const match = /^dm_(\d+)_(line|polygon|point|text)/.exec(layer["source-layer"] ?? "");
  const kind = layer.type === "circle" ? "point" : match?.[2] ?? layer["source-layer"]?.split("_").at(-1);
  const resolved = match ? penForCode(spec, Number(match[1]), level, kind) : {pen: defaultPenExpression(spec, level, kind), pages: [], origin: "default-by-code"};
  const override = layer.metadata?.["dm:pen-number-override"];
  const result = override === undefined ? resolved : {...resolved, pen: override, origin: "decoration-spec"};
  const previousMm = oldMm(layer.paint[property], level);
  const minimum = layer.type === "line" ? Math.max(14, Math.floor(getZoomByScale(level, 36) - Math.log2(smallestPen(result.pen)))) : 14;
  const metadata = {...layer.metadata, "dm:size-reference-latitude": 36,
    ...(previousMm !== undefined ? {"dm:pen-original-mm": layer.metadata?.["dm:pen-original-mm"] ?? previousMm} : {}), "dm:pen-number": result.pen, "dm:pen-level": level, "dm:pen-property": property,
    "dm:pen-pages": result.pages, "dm:pen-origin": result.origin};
  const paint = {...layer.paint, [property]: penWidthExpression(result.pen, level, 36, minimum)};
  if (paint["line-dasharray"] && typeof result.pen !== "number") throw new Error(`split subtype-specific dashed strokes: ${layer.id}`);
  if (paint["line-dasharray"] && previousMm) {
    const specifiedMm = match?.[1] === "2106" && [250, 500].includes(level) ? [2, 1]
      : match?.[1] === "2237" && [250, 500, 1000].includes(level) ? [4, 1] : undefined;
    const mm = (specifiedMm ?? metadata["dm:dash-mm"] ?? paint["line-dasharray"].map((value) => value * previousMm)).map(paperNumber);
    metadata["dm:dash-mm"] = mm;
    paint["line-dasharray"] = mm.map((value) => number(value / (basePen(result.pen) * 0.05)));
  }
  if (match && metadata["dm:pen-original-mm"] !== undefined) changes.push({level, code: Number(match[1]), id: layer.id, property,
    beforeMm: number(metadata["dm:pen-original-mm"]), pen: result.pen, pages: result.pages, kind, origin: result.origin});
  return {...layer, ...(layer.type === "line" ? {minzoom: minimum} : {}), metadata, paint};
};

const normalizeStyle = (style, level) => ({...style, name: `DM ${level}`,
  metadata: {...style.metadata, "dm:map-level": level, "dm:pen-reference-latitude": 36,
    ...(level === 250 ? {"dm:figure-basis-level": 500} : {})},
  layers: style.layers.flatMap((layer) => {
    if (!layer.paint?.["fill-outline-color"]) return [normalizeLayer(layer, level)];
    const paint = {...layer.paint}; const color = paint["fill-outline-color"]; delete paint["fill-outline-color"];
    return [{...layer, paint}, normalizeLayer({id: `${layer.id}-outline`, source: layer.source,
      "source-layer": layer["source-layer"], filter: layer.filter, type: "line", metadata: layer.metadata,
      paint: {"line-color": color, "line-width": 1}}, level)];
  }),
});

const sizeProperties = new Set(["line-width", "line-gap-width", "line-offset", "line-blur", "circle-radius", "circle-stroke-width",
  "text-size", "text-halo-width", "text-halo-blur", "icon-size", "icon-halo-width", "icon-halo-blur"]);
const halfSize = (value) => {
  if (typeof value === "number") return value / 2;
  if (value[0] === "interpolate" && value[2]?.[0] === "zoom") return value.map((item, index) => index >= 4 && index % 2 === 0 ? halfSize(item) : item);
  return ["*", value, 0.5];
};
const retarget = (value) => {
  if (!Array.isArray(value)) return value;
  if (value[0] === "==" && value[1]?.[0] === "get" && value[1][1] === "LEVEL" && value[2] === 500) return ["==", value[1], 250];
  if (value[0] === "in" && value[1]?.[0] === "get" && value[1][1] === "LEVEL" && value[2]?.[0] === "literal") {
    return ["in", value[1], ["literal", value[2][1].map((level) => level === 500 ? 250 : level)]];
  }
  return value.map(retarget);
};
const create250 = (style) => ({...structuredClone(style), layers: style.layers.map((original) => {
  const layer = structuredClone(original); layer.id = layer.id.replace(/-500(?=-|$)/g, "-250"); layer.filter = retarget(layer.filter);
  for (const group of [layer.layout, layer.paint]) for (const property of Object.keys(group ?? {})) if (sizeProperties.has(property)) group[property] = halfSize(group[property]);
  if (layer.metadata) { delete layer.metadata["dm:dash-mm"]; }
  return layer;
})});

const styles = new Map();
for (const level of [500, 1000, 2500, 5000]) styles.set(level, normalizeStyle(JSON.parse(await readFile(path.join(root, `style-${level}.json`), "utf8")), level));
styles.set(250, normalizeStyle(create250(styles.get(500)), 250));
for (const [level, style] of styles) await writeFile(path.join(root, `style-${level}.json`), JSON.stringify(style, undefined, 2) + "\n");
await writeFile(path.join(root, "pen-audit.json"), JSON.stringify({source: spec.source, policy250: "adopt-level-500", lines: changes}, undefined, 2) + "\n");
console.log(`Audited ${changes.length} stroke layers across 250/500/1000/2500/5000`);
