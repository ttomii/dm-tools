import {getZoomByScale} from "../../src/core/map-scale.js";
import {MM_TO_PX, penWidthExpression} from "../../src/core/pen-width.js";

const escapeXml = value => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

export const symbolSvg = (symbol, variant = symbol) => {
  const half = symbol.canvasMm / 2;
  const stroke = symbol.pen * 0.05;
  const anchor = variant.anchorMm ?? symbol.anchorMm ?? [0, 0];
  const paths = variant.paths.map(path => `<path d="${escapeXml(path.d)}" fill="${path.fill ?? "none"}" stroke="${path.stroke ?? "#000000"}" stroke-width="${path.strokeWidthMm ?? stroke}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="${-half} ${-half} ${symbol.canvasMm} ${symbol.canvasMm}" data-dm-reference-stroke="${stroke}">\n<title>${symbol.code} ${escapeXml(symbol.name)}</title>\n<desc>座標単位mm。入力位置: ${anchor.join(",")}。図式p.${symbol.page}。${escapeXml(symbol.anchorDescription ?? "記号の中心")}</desc>\n${paths.join("\n")}\n</svg>\n`;
};

export const symbolLayer = (symbol, level) => {
  const variant = symbol.variants?.find(item => item.level === level);
  const base = `dm-${symbol.code}${variant ? `-level-${level}` : ""}`;
  const canvas = symbol.canvasMm * (symbol.scaleByLevel?.[level] ?? 1);
  const anchor = variant?.anchorMm ?? symbol.anchorMm ?? [0, 0];
  const nominal = canvas * MM_TO_PX / 32;
  const baseline = getZoomByScale(level, 36);
  return {
    id: `dm-${symbol.code}-point-${level}-symbol-point`, source: "dm", type: "symbol",
    "source-layer": `dm_${symbol.code}_point`, minzoom: 14,
    filter: ["==", ["get", "LEVEL"], level],
    metadata: {"dm:style-origin": "individual", "dm:size-reference-latitude": 36,
      "dm:icon-dimensions-mm": variant?.dimensionsMm ?? symbol.dimensionsMm,
      "dm:icon-canvas-mm": canvas, "dm:icon-reference-page": symbol.page,
      "dm:icon-anchor-mm": anchor,
      "dm:icon-anchor": symbol.anchorDescription ?? "記号の中心",
      ...(symbol.usage ? {"dm:icon-usage": symbol.usage} : {})},
    layout: {"icon-image": base, "icon-size": ["interpolate", ["exponential", 2], ["zoom"],
      14, nominal * 2 ** (14 - baseline), 24, nominal * 2 ** (24 - baseline)],
    "icon-rotate": symbol.directional ? ["coalesce", ["get", "ROTATION"], 0] : 0,
    "icon-offset": anchor.map(value => -value * 32 / symbol.canvasMm),
    "icon-allow-overlap": true, ...(symbol.directional ? {"icon-rotation-alignment": "map"} : {})},
  };
};

export const symbolOutlineLayer = (symbol, level) => ({
  id: `dm-${symbol.code}-polygon-${level}-line`, source: "dm", type: "line",
  "source-layer": `dm_${symbol.code}_polygon`, minzoom: 14,
  filter: ["==", ["get", "LEVEL"], level],
  metadata: {"dm:style-origin": "individual", "dm:size-reference-latitude": 36},
  paint: {"line-color": "#000000", "line-width": penWidthExpression(symbol.pen, level, 36)},
});

export const excludeSymbolFallbacks = (filter, codes) => {
  if (!Array.isArray(filter)) return filter;
  if (filter[0] === "in" && filter[1]?.[0] === "get" && filter[1]?.[1] === "DMCODE" && filter[2]?.[0] === "literal") {
    return [filter[0], filter[1], ["literal", [...new Set([...filter[2][1], ...codes])]]];
  }
  return filter.map(item => excludeSymbolFallbacks(item, codes));
};
