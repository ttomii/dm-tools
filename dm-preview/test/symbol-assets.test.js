import assert from "node:assert/strict";
import {test} from "node:test";
import {symbolSvg, symbolLayer, symbolOutlineLayer, excludeSymbolFallbacks} from "../scripts/maplibre-assets/symbols.mjs";
import {iconEntry} from "../src/core/sprite-policy.js";

const symbol = {code: 3508, name: 'A<&"', page: 66, pen: 4, canvasMm: 6, paths: [{d: "M0 0L1 1"}],
  dimensionsMm: {width: 2.5, height: 3}, variants: [{level: 1000, paths: [{d: "M0 0L1 2", fill: "#fff", stroke: "none", strokeWidthMm: .15}], dimensionsMm: {width: 1.5, height: 2}}]};

test("SVG masters retain millimetre coordinates, anchors, variants and explicit thin strokes", () => {
  const base = symbolSvg(symbol);
  assert.match(base, /viewBox="-3 -3 6 6"/);
  assert.match(base, /data-dm-reference-stroke="0.2"/);
  assert.match(base, /A&lt;&amp;&quot;/);
  assert.match(base, /stroke-width="0.2"/);
  const variant = symbolSvg({...symbol, anchorDescription: 'input <center>'}, symbol.variants[0]);
  assert.match(variant, /input &lt;center>/);
  assert.match(variant, /stroke-width="0.15"/);
  assert.match(variant, /fill="#fff" stroke="none"/);
});

test("native-level symbol layers select distinct artwork and size, and rotate only directional records", () => {
  const base = symbolLayer(symbol, 500);
  assert.equal(base.layout["icon-image"], "dm-3508");
  assert.equal(base.layout["icon-rotate"], 0);
  assert.deepEqual(base.metadata["dm:icon-dimensions-mm"], {width: 2.5, height: 3});
  const variant = symbolLayer({...symbol, directional: true, usage: "river", anchorDescription: "pole", scaleByLevel: {1000: 2/3}}, 1000);
  assert.equal(variant.layout["icon-image"], "dm-3508-level-1000");
  assert.equal(variant.metadata["dm:icon-canvas-mm"], 4);
  assert.equal(variant.metadata["dm:icon-usage"], "river");
  assert.equal(variant.metadata["dm:icon-anchor"], "pole");
  assert.deepEqual(variant.metadata["dm:icon-dimensions-mm"], {width: 1.5, height: 2});
  assert.deepEqual(variant.layout["icon-rotate"], ["coalesce", ["get", "ROTATION"], 0]);
});

test("new point symbols are excluded from fallback without mutating or reordering existing codes", () => {
  const filter = ["all", ["==", ["get", "LEVEL"], 500], ["!", ["in", ["get", "DMCODE"], ["literal", [3509, 3503]]]]];
  const before = JSON.stringify(filter);
  const result = excludeSymbolFallbacks(filter, [3503, 3508]);
  assert.deepEqual(result[2][1][2][1], [3509, 3503, 3508]);
  assert.equal(JSON.stringify(filter), before);
  assert.equal(excludeSymbolFallbacks(undefined, []), undefined);
});

test("level-specific SVG sources map to a single DM code and a distinct sprite ID", () => {
  assert.deepEqual(iconEntry("3508-level-1000.svg"), {relative: "3508-level-1000.svg", dmcode: "3508", spriteId: "dm-3508-level-1000", status: "supported", note: ""});
  assert.equal(iconEntry("3508.svg").spriteId, "dm-3508");
  assert.equal(iconEntry("custom-level-1000.svg").status, "unused");
});

test("true-shape polygon input gets only an outline layer rather than a point symbol or fill", () => {
  const layer = symbolOutlineLayer({...symbol, code: 2261, pen: 3}, 500);
  assert.equal(layer.id, "dm-2261-polygon-500-line");
  assert.equal(layer["source-layer"], "dm_2261_polygon");
  assert.equal(layer.type, "line");
  assert.equal(layer.paint["line-color"], "#000000");
  assert.deepEqual(layer.filter, ["==", ["get", "LEVEL"], 500]);
  assert.equal(layer.layout, undefined);
});

test("a recorded acquisition point offsets the icon in sprite pixels and supports native-level anchor variants", () => {
  const anchored = {...symbol, anchorMm: [1, 2.5], variants: [{...symbol.variants[0], anchorMm: [0, -0.5]}]};
  const base = symbolLayer(anchored, 500);
  assert.deepEqual(base.metadata["dm:icon-anchor-mm"], [1, 2.5]);
  assert.deepEqual(base.layout["icon-offset"], [-32/6, -2.5*32/6]);
  const variant = symbolLayer(anchored, 1000);
  assert.equal(variant.layout["icon-offset"][1], 0.5*32/6);
  assert.deepEqual(variant.metadata["dm:icon-anchor-mm"], [0, -0.5]);
  assert.match(symbolSvg(anchored), /入力位置: 1,2.5/);
  assert.match(symbolSvg(anchored, anchored.variants[0]), /入力位置: 0,-0.5/);
});
