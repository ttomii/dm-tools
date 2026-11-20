import assert from "node:assert/strict";
import {test} from "node:test";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";
import {getZoomByScale} from "../src/core/map-scale.js";
import {MM_TO_PX} from "../src/core/pen-width.js";
import {evaluate} from "./helpers/pen-expressions.js";

const assets = new URL("../static/maplibre/", import.meta.url);
const json = async file => JSON.parse(await readFile(new URL(file, assets), "utf8"));

for (const [code, letter] of [[2252, "S"], [2253, "C"]]) for (const level of [250, 500, 1000]) {
  test(`${code}/${level} displays its centered letter in a 2 mm white circle with a 3-pen outline`, async () => {
    const style = await json(`style-${level}.json`);
    const circle = style.layers.find(layer => layer.id === `dm-${code}-point-${level}-circle`);
    const text = style.layers.find(layer => layer.id === `dm-${code}-point-${level}-symbol-point`);
    assert.ok(circle); assert.ok(text);
    assert.equal(circle.type, "circle"); assert.equal(text.type, "symbol");
    assert.equal(circle["source-layer"], `dm_${code}_point`);
    assert.equal(text["source-layer"], `dm_${code}_point`);
    assert.deepEqual(circle.filter, ["==", ["get", "LEVEL"], level]);
    assert.deepEqual(text.filter, circle.filter);
    const zoom = getZoomByScale(level, 36);
    const radius = evaluate(circle.paint["circle-radius"], {}, zoom) / MM_TO_PX;
    const stroke = evaluate(circle.paint["circle-stroke-width"], {}, zoom) / MM_TO_PX;
    assert.ok(Math.abs(2 * (radius + stroke) - 2) < 1e-8);
    assert.ok(Math.abs(stroke - 0.15) < 1e-8);
    assert.equal(circle.paint["circle-color"], "#ffffff");
    assert.equal(circle.paint["circle-stroke-color"], "#000000");
    assert.equal(text.layout["text-field"], letter);
    assert.deepEqual(text.layout["text-font"], ["BIZ UDPGothic Regular"]);
    assert.equal(text.layout["text-anchor"], "center");
    assert.equal(text.layout["text-allow-overlap"], true);
    assert.equal(text.layout["text-ignore-placement"], true);
    assert.equal(text.layout["text-rotate"], 0);
    assert.equal(text.layout["icon-image"], undefined);
    assert.equal(text.paint["text-color"], "#000000");
    assert.ok(style.layers.indexOf(circle) < style.layers.indexOf(text));
    const sizeMm = evaluate(text.layout["text-size"], {}, zoom) / MM_TO_PX;
    assert.ok(Math.abs(sizeMm * 20 / 24 - 1.35) < 1e-8);
    const fallback = style.layers.find(layer => layer.id === `dm-default-point-${level}-symbol`);
    assert.ok(fallback.filter[2][1][2][1].includes(code));
  });
}

test("S and C in the shipped glyph range have the measured cap height and center correctly with the configured offsets", async () => {
  // Decode with the protobuf reader used by the installed MapLibre rather than adding another font parser.
  const require = createRequire(import.meta.url);
  const maplibreRequire = createRequire(require.resolve("maplibre-gl/package.json"));
  const {PbfReader} = await import(pathToFileURL(maplibreRequire.resolve("pbf")).href);
  const glyphs = [];
  const readGlyph = (tag, glyph, reader) => {
    if (tag === 1) glyph.id = reader.readVarint();
    else if (tag === 2) glyph.bitmap = reader.readBytes();
    else if (tag === 3) glyph.width = reader.readVarint();
    else if (tag === 4) glyph.height = reader.readVarint();
    else if (tag === 5) glyph.left = reader.readSVarint();
    else if (tag === 6) glyph.top = reader.readSVarint();
    else if (tag === 7) glyph.advance = reader.readVarint();
  };
  const readStack = (tag, _, reader) => { if (tag === 3) glyphs.push(reader.readMessage(readGlyph, {})); };
  new PbfReader(await readFile(new URL("glyphs/BIZ UDPGothic Regular/0-255.pbf", assets)))
    .readFields((tag, _, reader) => { if (tag === 1) reader.readMessage(readStack, {}); }, {});
  const style = await json("style-500.json");
  for (const [code, letter] of [[2252, "S"], [2253, "C"]]) {
    const glyph = glyphs.find(glyph => glyph.id === letter.codePointAt(0));
    assert.ok(glyph?.bitmap.length); assert.equal(glyph.height, 20);
    const layer = style.layers.find(layer => layer.id === `dm-${code}-point-500-symbol-point`);
    assert.ok(layer);
    const [x, y] = layer.layout["text-offset"];
    assert.ok(Math.abs(glyph.left + glyph.width / 2 - glyph.advance / 2 + x * 24) < 1e-8);
    assert.ok(Math.abs(-17 - glyph.top + glyph.height / 2 + y * 24) < 1e-8);
  }
});

test("2252 and 2253 are not rendered as fallback dots or invented symbols at 2500/5000", async () => {
  for (const level of [2500, 5000]) {
    const style = await json(`style-${level}.json`);
    for (const code of [2252, 2253]) {
      assert.equal(style.layers.some(layer => layer["source-layer"] === `dm_${code}_point`), false);
      assert.ok(style.layers.find(layer => layer.id === `dm-default-point-${level}-symbol`).filter[2][1][2][1].includes(code));
    }
  }
});
