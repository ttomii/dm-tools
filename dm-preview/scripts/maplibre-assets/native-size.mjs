import {Resvg} from '@resvg/resvg-js';

const identity = [1, 0, 0, 1, 0, 0];
const multiply = (a, b) => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];
const matrix = tag => {
  const value = tag.match(/transform="matrix\(([^)]+)\)"/);
  return value ? value[1].split(/[ ,]+/).map(Number) : identity;
};
const point = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const strokeWidth = (tag, width) => {
  if (!/stroke="(?!none)[^"]+"/.test(tag)) return tag;
  return /stroke-width="[^"]+"/.test(tag)
    ? tag.replace(/stroke-width="[^"]+"/, `stroke-width="${width}"`)
    : tag.replace('/>', ` stroke-width="${width}"/>`);
};
const transformPath = (d, m) => {
  const tokens = d.match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) || [];
  const sizes = {M: 2, L: 2, C: 6, Q: 4, Z: 0}, out = [];
  let i = 0, command;
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) command = tokens[i++];
    if (!(command in sizes)) throw new Error(`unsupported canonical SVG path command: ${command}`);
    out.push(command);
    if (command === 'Z') { command = undefined; continue; }
    for (let j = 0; j < sizes[command]; j += 2) {
      const p = point(m, Number(tokens[i++]), Number(tokens[i++]));
      if (!p.every(Number.isFinite)) throw new Error('invalid canonical path');
      out.push(...p.map(n => Number(n.toFixed(9))));
    }
    if (command === 'M') command = 'L';
  }
  return out.join(' ');
};

const geometryBounds = canonical => {
  const thin = canonical.replaceAll(/<path\b[^>]*>/g, tag => {
    const p = strokeWidth(tag, 0.000001).replaceAll(/fill="#ffffff"/gi, 'fill="none"');
    return /fill="none"/.test(p) && (!/stroke="/.test(p) || /stroke="none"/.test(p)) ? '' : p;
  });
  const bounds = new Resvg(thin).getBBox();
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) throw new Error('empty native SVG');
  return bounds;
};
const paperScale = (bounds, dimensions) => {
  const reference = dimensions.referenceLength ? dimensions.referenceLength.paper / dimensions.referenceLength.source : undefined;
  if (![dimensions.width, dimensions.height, reference].some(v => Number.isFinite(v) && v > 0)) throw new Error('native dimension must be positive');
  const sx = dimensions.width ? dimensions.width / bounds.width : dimensions.height ? dimensions.height / bounds.height : reference;
  const sy = dimensions.height ? dimensions.height / bounds.height : sx;
  return {sx, sy, width: dimensions.width ?? bounds.width * sx, height: dimensions.height ?? bounds.height * sy};
};
const nativePaths = (canonical, normalize, pen, referenceStroke) => {
  const stack = [identity], paths = [];
  for (const match of canonical.matchAll(/<\/?(?:g|path)\b[^>]*>/g)) {
    const tag = match[0];
    if (tag.startsWith('</g')) { stack.pop(); continue; }
    const m = multiply(stack.at(-1), matrix(tag));
    if (tag.startsWith('<g')) { if (!tag.endsWith('/>')) stack.push(m); continue; }
    const d = tag.match(/\bd="([^"]+)"/)?.[1];
    if (!d) continue;
    const originalWidth = Number(tag.match(/stroke-width="([^"]+)"/)?.[1] ?? 1);
    const width = pen * .05 * (referenceStroke ? originalWidth / referenceStroke : 1);
    paths.push(strokeWidth(tag.replace(/\s+transform="[^"]*"/g, ''), width)
      .replace(/\bd="[^"]+"/, `d="${transformPath(d, multiply(normalize, m))}"`));
  }
  return paths;
};

// Flatten canonical vectors into paper-mm coordinates before pen normalization.
// Transparent padding and white backgrounds do not define a symbol's dimensions.
export const calibratedNativeSvg = (source, dimensions, pen) => {
  const canonical = new Resvg(source.replaceAll(/param\([^)]+\)\s+([^"'\s;]+)/g, '$1')).toString();
  if (/<(?:image|use|clipPath|mask)\b|url\(#/.test(canonical)) throw new Error('native calibration requires unclipped vector paths');
  const bounds = geometryBounds(canonical);
  const {sx, sy, width, height} = paperScale(bounds, dimensions);
  const canvas = Math.max(width, height) + 1;
  const normalize = [sx, 0, 0, sy, -(bounds.x + bounds.width / 2) * sx, -(bounds.y + bounds.height / 2) * sy];
  const referenceStroke = Number(source.match(/data-dm-reference-stroke="([^"]+)"/)?.[1]);
  const paths = nativePaths(canonical, normalize, pen, referenceStroke);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="${-canvas / 2} ${-canvas / 2} ${canvas} ${canvas}" data-dm-reference-stroke="${pen * .05}">\n${paths.join('\n')}\n</svg>`;
  const box = canonical.match(/viewBox="([^"]+)"/)[1].split(/[ ,]+/).map(Number);
  return {svg, canvas, width, height, anchor: [(box[0] + box[2] / 2 - bounds.x - bounds.width / 2) * sx, (box[1] + box[3] / 2 - bounds.y - bounds.height / 2) * sy]};
};
