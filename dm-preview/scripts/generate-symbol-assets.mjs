import {readFile, writeFile} from "node:fs/promises";
import {symbolSvg, symbolLayer, symbolOutlineLayer, excludeSymbolFallbacks} from "./maplibre-assets/symbols.mjs";

const root = new URL("../static/maplibre/", import.meta.url);
const {symbols} = JSON.parse(await readFile(new URL("symbol-spec.json", root), "utf8"));
const pens = JSON.parse(await readFile(new URL("pen-spec.json", root), "utf8"));
const codes = symbols.map(symbol => symbol.code);
for (const symbol of symbols) {
  await writeFile(new URL(`icons/source/${symbol.code}.svg`, root), symbolSvg(symbol));
  for (const variant of symbol.variants ?? []) {
    await writeFile(new URL(`icons/source/${symbol.code}-level-${variant.level}.svg`, root), symbolSvg(symbol, variant));
  }
}
for (const level of [500, 1000, 2500, 5000]) {
  const file = new URL(`style-${level}.json`, root);
  const style = JSON.parse(await readFile(file, "utf8"));
  const polygons = symbols.filter(symbol => pens.codes[symbol.code].rules.some(rule => rule.kind === "polygon" && rule.levels.includes(level)));
  const ids = new Set(codes.flatMap(code => [`dm-${code}-point-${level}-symbol-point`, `dm-${code}-polygon-${level}-line`]));
  style.layers = style.layers.filter(layer => !ids.has(layer.id)).map(layer =>
    layer["source-layer"] === "dm_default_point" ? {...layer, filter: excludeSymbolFallbacks(layer.filter, codes)}
      : layer["source-layer"] === "dm_default_polygon" ? {...layer, filter: excludeSymbolFallbacks(layer.filter, polygons.map(symbol => symbol.code))} : layer);
  style.layers.push(...symbols.filter(symbol => symbol.levels.includes(level)).map(symbol => symbolLayer(symbol, level)));
  style.layers.push(...polygons.map(symbol => symbolOutlineLayer(symbol, level)));
  await writeFile(file, JSON.stringify(style, undefined, 2) + "\n");
}
console.log(`Generated ${symbols.length} DM symbols and their native-level styles; normalize pen styles to derive level 250.`);
