const explicitStroke = (tag) => /\bstroke=["'](?!none["'])[^"']+["']/.test(tag);
const widthValue = (tag) => tag.match(/stroke-width(?:=["']|:\s*)([^"'\s;>]+)/)?.[1];
export const hasSvgStrokes = (svg) => {
  const normalized = svg.replaceAll(/param\([^)]+\)\s+([^"'\s;]+)/g, "$1");
  return [...normalized.matchAll(/<[^>]+>/g)].some(([tag]) => {
    const width = widthValue(tag);
    return width === undefined ? explicitStroke(tag) : parseFloat(width) > 0;
  });
};

const pixels = (value) => {
  const match = /^([\d.]+)(mm|cm|pt|in|px)?$/.exec(value ?? "");
  if (!match) throw new Error(`unsupported SVG viewport: ${value}`);
  return Number(match[1]) * ({mm: 96 / 25.4, cm: 96 / 2.54, pt: 96 / 72, in: 96, px: 1}[match[2]] ?? 1);
};

export const normalizeSvgPen = (svg, {pixelStroke, width, height, referenceStroke}) => {
  const root = svg.match(/<svg\b[^>]*>/s)?.[0] ?? "";
  const size = (name) => pixels(root.match(new RegExp(`\\b${name}=["']([^"']+)`))?.[1]);
  const viewBox = root.match(/viewBox=["']([^"']+)/)?.[1].trim().split(/[ ,]+/).map(Number);
  const sourceWidth = size("width"); const sourceHeight = size("height");
  const viewWidth = viewBox?.[2] ?? sourceWidth; const viewHeight = viewBox?.[3] ?? sourceHeight;
  const scale = Math.min(sourceWidth / viewWidth, sourceHeight / viewHeight) * Math.min(width / sourceWidth, height / sourceHeight);
  const stroke = pixelStroke / scale;
  const scaledStroke = value => stroke * (referenceStroke ? parseFloat(value) / referenceStroke : 1);
  return svg.replaceAll(/\s+vector-effect=["'][^"']*["']/g, "")
    .replaceAll(/stroke-width=["']([^"']+)["']/g, (all, value) => parseFloat(value) > 0
      ? `stroke-width="${scaledStroke(value)}px"` : all)
    .replaceAll(/stroke-width:\s*([^;"']+)/g, (all, value) => parseFloat(value) > 0
      ? `stroke-width:${scaledStroke(value)}px` : all)
    .replaceAll(/<(?:path|circle|line|rect|ellipse|polyline|polygon)\b[^>]*>/g, (tag) =>
      explicitStroke(tag) && widthValue(tag) === undefined ? tag.replace(/\/?>(?=$)/, (end) => ` stroke-width="${stroke}px"${end}`) : tag);
};
