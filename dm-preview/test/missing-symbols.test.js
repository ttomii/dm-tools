import assert from "node:assert/strict";
import {test} from "node:test";
import {readFile} from "node:fs/promises";
import {Resvg} from "@resvg/resvg-js";
import {getZoomByScale} from "../src/core/map-scale.js";
import {MM_TO_PX} from "../src/core/pen-width.js";

const assets = new URL("../static/maplibre/", import.meta.url);
const json = async name => JSON.parse(await readFile(new URL(name, assets), "utf8"));
const expectedCodes = [2241, 2242, 2243, 2244, 2246, 2247, 2251, 2255, 2256, 2261, 2262, 2263, 2401, 3508, 3512, 3513, 3518, 3523, 3527, 3528, 3529, 3552, 3553, 3556, 3557, 3559, 4101, 4111, 4119, 4121, 4131, 4132, 4141, 4142, 4151, 4161, 4206, 4208, 4211, 4215, 4216, 4217, 4223, 4224, 4226, 4227, 4228, 4231, 4232, 4233, 4237, 4238, 4242, 4245, 4252, 4253, 4254, 4255, 4256, 5105, 5106, 5219, 5255, 5256, 6217, 6223, 6224, 6312, 6316, 6322, 6345, 7306, 7307, 7309];
const spec = await json("symbol-spec.json");
const pens = await json("pen-spec.json");
const styles = new Map(await Promise.all([250,500,1000,2500,5000].map(async level => [level, await json(`style-${level}.json`)])));
const atlases = await Promise.all(["sprite/sprite.json", "sprite/sprite@2x.json"].map(json));

test("all 74 catalog symbols have source SVGs, calibrated styles, both sprite resolutions and no fallback duplicates", async () => {
  assert.deepEqual(spec.symbols.map(symbol => symbol.code), expectedCodes);
  for (const symbol of spec.symbols) {
    for (const level of [250,500,1000,2500,5000]) {
      const style = styles.get(level);
      const layer = style.layers.find(item => item.id === `dm-${symbol.code}-point-${level}-symbol-point`);
      const basis = level === 250 ? 500 : level;
      assert.equal(Boolean(layer), symbol.levels.includes(basis), `${symbol.code}/${level} applicability`);
      const fallback = style.layers.find(item => item.id === `dm-default-point-${level}-symbol`);
      assert.ok(JSON.stringify(fallback.filter).includes(String(symbol.code)), `${symbol.code}/${level} fallback`);
      if (!layer) continue;
      assert.equal(layer["source-layer"], `dm_${symbol.code}_point`);
      assert.equal(layer.layout["icon-allow-overlap"], true);
      assert.deepEqual(layer.layout["icon-rotate"], symbol.directional ? ["coalesce", ["get", "ROTATION"], 0] : 0);
      if (symbol.directional) assert.equal(layer.layout["icon-rotation-alignment"], "map");
      const size = layer.layout["icon-size"];
      const nominalSize = size[4] * 2 ** (getZoomByScale(level, 36) - size[3]);
      const expectedCanvas = symbol.canvasMm * (symbol.scaleByLevel?.[basis] ?? 1);
      assert.ok(Math.abs(32 * nominalSize / MM_TO_PX - expectedCanvas) < 1e-8, `${symbol.code}/${level} mm`);
      for (const [index, atlas] of atlases.entries()) {
        const frame = atlas[layer.layout["icon-image"]];
        assert.ok(frame, `${symbol.code}/${level}/${index + 1}x sprite`);
        assert.equal(frame.pixelRatio, index + 1);
      }
    }
    for (const suffix of ["", ...(symbol.variants ?? []).map(variant => `-level-${variant.level}`)]) {
      const svg = await readFile(new URL(`icons/source/${symbol.code}${suffix}.svg`, assets), "utf8");
      assert.ok(!/<text\b/.test(svg), `${symbol.code} must not include dimension labels`);
      const image = new Resvg(svg, {fitTo: {mode: "zoom", value: 32 / 96}}).render();
      const pixels = image.pixels;
      let ink = 0;
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        const alpha = pixels[(y * 32 + x) * 4 + 3];
        ink += alpha;
        if (x === 0 || y === 0 || x === 31 || y === 31) assert.equal(alpha, 0, `${symbol.code} clipped edge`);
      }
      assert.ok(ink > 1000, `${symbol.code} empty SVG`);
    }
  }
});

test("corrected PDF dimensions distinguish milestones, hydrants, wave stations and level-specific customs symbols", () => {
  const byCode = code => spec.symbols.find(symbol => symbol.code === code);
  assert.equal(byCode(2255).dimensionsMm.square, 2);
  assert.equal(byCode(2256).dimensionsMm.square, 2);
  assert.equal(byCode(4216).dimensionsMm.width, 2);
  assert.equal(byCode(4216).dimensionsMm.circleDiameter, 1);
  assert.deepEqual(byCode(4255).dimensionsMm, {width: 3, height: 1});
  assert.equal(byCode(3508).dimensionsMm.width, 2.5);
  assert.equal(byCode(3508).dimensionsMm.height, 3);
  assert.deepEqual(byCode(3508).variants[0].dimensionsMm, {width: 1.5, height: 2, tickSpacing: 1, tickLength: 0.5});
  const river = byCode(3557);
  assert.equal(river.usage, "river");
  assert.equal(river.paths.filter(path => path.strokeWidthMm === 0.15).length, 2);
  assert.equal(river.variants[0].dimensionsMm.baseWidth, 3);
  assert.equal(river.variants[0].dimensionsMm.topRay, 0.5);
  assert.equal(byCode(6223).variants[0].dimensionsMm.width, 2.5);
  assert.equal(byCode(4206).directional, true);
  assert.equal(byCode(4206).paths.length, 4);
});

test("true-shape alternatives retain polygon outlines and are represented by E1 catalog samples", async () => {
  const {readInspectCatalogCases} = await import("../src/node/inspect-catalog.js");
  const samples = await readInspectCatalogCases();
  for (const symbol of spec.symbols) for (const level of [250, 500, 1000]) {
    const basis = level === 250 ? 500 : level;
    if (!pens.codes[symbol.code].rules.some(rule => rule.kind === "polygon" && rule.levels.includes(basis))) continue;
    const style = styles.get(level);
    const layer = style.layers.find(item => item.id === `dm-${symbol.code}-polygon-${level}-line`);
    assert.ok(layer, `${symbol.code}/${level} true outline`);
    assert.equal(layer.type, "line");
    assert.ok(samples.some(sample => sample.code === symbol.code && sample.kind === "polygon"));
    const fallback = style.layers.find(item => item.id === `dm-default-polygon-${level}-outline`);
    assert.ok(JSON.stringify(fallback.filter).includes(String(symbol.code)));
  }
});

test("acquisition anchors follow the PDF rather than the image bounding-box center", async () => {
  const expected = new Map([[4233, [1, 2.5]], [5256, [0, 1.5]], [6223, [0, -0.7]]]);
  for (const [code, anchor] of expected) for (const level of [250, 500, 1000]) {
    const layer = styles.get(level).layers.find(item => item.id === `dm-${code}-point-${level}-symbol-point`);
    const reference = code === 6223 && level === 1000 ? [0, -0.5] : anchor;
    assert.deepEqual(layer.metadata["dm:icon-anchor-mm"], reference);
    const size = layer.layout["icon-size"];
    const nominal = size[4] * 2 ** (getZoomByScale(level, 36) - size[3]);
    for (let index = 0; index < 2; index++) assert.ok(Math.abs(layer.layout["icon-offset"][index] * nominal / MM_TO_PX + reference[index]) < 1e-8);
  }
  const tomb = spec.symbols.find(symbol => symbol.code === 6224);
  assert.ok(Math.abs(tomb.anchorMm[1] + 0.802113) < 1e-5);
  const tidal = await readFile(new URL("icons/source/6345.svg", assets), "utf8");
  assert.equal([...tidal.matchAll(/<path\b/g)].length, 2, "a tidal-flat point symbol is one pair, not three lines");
});

  // Bounds include the actual stroke: a 2 mm closed frame with pen 3 is 2.15 mm wide.
  // Butt-ended open lines do not grow in their tangential direction.
const paperDimensionExamples = [
    [2242, "", 1.65, 2.075], [2244, "", 1.15, 2.575], [2247, "", 1.15, 2.15],
    [2251, "", 2.65, 2.65], [2255, "", 2.15, 2.15], [2256, "", 2.15, 2.15],
    [2261, "", 2.65, 2.65], [2262, "", 2.65, 2.65], [2263, "", 2.15, 2.15],
    [3508, "", 2.5, 3.1], [3508, "-level-1000", 1.5, 2.1],
    [3553, "", 4.5, 2.4], [3553, "-level-1000", 3, 1.6],
    [3557, "", 4.5, 2.4], [3557, "-level-1000", 3, 1.6],
    [4206, "", 1.15, 2.15], [4211, "", 2.15, 2.15], [4216, "", 2.15, 1.15],
    [4232, "", 2.15, 3], [4233, "", 3, 3], [4237, "", 2.15, 2.15],
    [4242, "", 2.95, 4.15], [4252, "", 2.65, 2.65], [4254, "", 2.65, 2.65],
    [4256, "", 2.65, 2.65], [5255, "", 2.15, 2.15], [5256, "", 2.075, 3.15],
    [6223, "", 4, 3.15], [6223, "-level-1000", 2.5, 2.15],
    [6312, "", 2.1, 2.05], [6316, "", 1.55, 2.1], [6345, "", 3, 1.6],
  ];
for (const [code, suffix, expectedWidth, expectedHeight] of paperDimensionExamples) test(`rasterized ${code}${suffix} has the PDF paper dimensions including stroke edges`, async () => {
    const pixelsPerMm = 80;
    const symbol = spec.symbols.find(symbol => symbol.code === code);
    const svg = await readFile(new URL(`icons/source/${code}${suffix}.svg`, assets), "utf8");
    const image = new Resvg(svg, {fitTo: {mode: "zoom", value: symbol.canvasMm * pixelsPerMm / 96}}).render();
    const pixels = image.pixels;
    let left = image.width, right = -1, top = image.height, bottom = -1;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      if (!pixels[(y * image.width + x) * 4 + 3]) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    const width = (right - left + 1) / pixelsPerMm;
    const height = (bottom - top + 1) / pixelsPerMm;
    assert.ok(Math.abs(width - expectedWidth) <= 0.0251, `${code}${suffix}: width ${width} mm, expected ${expectedWidth}`);
    assert.ok(Math.abs(height - expectedHeight) <= 0.0251, `${code}${suffix}: height ${height} mm, expected ${expectedHeight}`);
});
