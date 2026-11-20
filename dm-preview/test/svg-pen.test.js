import assert from "node:assert/strict";
import {test} from "node:test";
import {Resvg} from "@resvg/resvg-js";
import {normalizeSvgPen, hasSvgStrokes} from "../src/core/svg-pen.js";

const svg = '<svg width="250" height="250" viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg"><path d="M200 30 V370" fill="none" stroke="black" stroke-width="20px"/></svg>';
test("SVG stroke normalization renders the requested width at 1x and 2x", () => {
  assert.equal(hasSvgStrokes(svg), true);
  assert.equal(hasSvgStrokes('<path fill="black" stroke-width="param(outline-width) 0"/>'), false);
  for (const ratio of [1, 2]) {
    const width = 32 * ratio;
    const normalized = normalizeSvgPen(svg, {pixelStroke: 3.5 * ratio, width, height: width});
    const image = new Resvg(normalized, {fitTo: {mode: "zoom", value: width / 250}}).render();
    const pixels = image.pixels; const row = Math.floor(image.height / 2);
    let area = 0; for (let x = 0; x < image.width; x++) area += pixels[(row * image.width + x) * 4 + 3] / 255;
    assert.ok(Math.abs(area - 3.5 * ratio) < 0.2, `${ratio}x stroke: ${area}`);
  }
  assert.throws(() => normalizeSvgPen('<svg width="10%" height="20"/>', {pixelStroke: 1, width: 32, height: 32}));
});


test("implicit SVG stroke width one is normalized after canonicalization", () => {
  const input = '<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg"><path stroke="black" fill="none" d="M16 2 V30"/></svg>';
  const canonical = new Resvg(input).toString();
  assert.equal(hasSvgStrokes(canonical), true);
  const result = new Resvg(normalizeSvgPen(canonical, {pixelStroke: 4, width: 32, height: 32})).render();
  let alpha = 0; for (let x = 0; x < 32; x++) alpha += result.pixels[(16 * 32 + x) * 4 + 3] / 255;
  assert.ok(Math.abs(alpha - 4) < 0.2);
});

test("explicit reference stroke preserves thinner internal lines in a 4-pen symbol", () => {
  const original = '<svg width="96" height="96" viewBox="-3 -3 6 6" xmlns="http://www.w3.org/2000/svg"><path fill="none" stroke="black" stroke-width=".2" d="M-2 -1L2 -1"/><path fill="none" stroke="black" stroke-width=".15" d="M-2 1L2 1"/></svg>';
  const canonical = new Resvg(original).toString();
  const normalized = normalizeSvgPen(canonical, {pixelStroke: 4, width: 96, height: 96, referenceStroke: 0.2});
  const image = new Resvg(normalized).render();
  const rowCoverage = y => Array.from({length: 96}, (_, x) => image.pixels[(y * 96 + x) * 4 + 3] / 255).reduce((a, b) => a + b, 0);
  const columnCoverage = center => Array.from({length: 15}, (_, index) => image.pixels[((center - 7 + index) * 96 + 48) * 4 + 3] / 255).reduce((a, b) => a + b, 0);
  assert.ok(rowCoverage(32) > 10);
  assert.ok(Math.abs(columnCoverage(32) - 4) < 0.05);
  assert.ok(Math.abs(columnCoverage(64) - 3) < 0.05);
});
