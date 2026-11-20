import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {getZoomByScale} from "../src/core/map-scale.js";
import {MM_TO_PX, penForCode, penWidthExpression, rebasePenWidths, defaultPenExpression} from "../src/core/pen-width.js";
const spec = JSON.parse(readFileSync(new URL("../static/maplibre/pen-spec.json", import.meta.url)));
const style = (level) => JSON.parse(readFileSync(new URL(`../static/maplibre/style-${level}.json`, import.meta.url)));

import {evaluate} from "./helpers/pen-expressions.js";

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test("PDF pen table: 2102 is six at every shipped level, including 250", () => {
  for (const level of [250, 500, 1000, 2500, 5000]) {
    assert.equal(penForCode(spec, 2102, level, "line").pen, 6);
    const line = style(level).layers.find(layer => layer["source-layer"] === "dm_2102_line");
    assert.equal(line.metadata["dm:pen-number"], 6);
    close(evaluate(line.paint["line-width"], {}, getZoomByScale(level, 36)) / MM_TO_PX, 0.30);
  }
  assert.equal(style(250).metadata["dm:figure-basis-level"], 500);
});

test("PDF level and geometry qualifiers determine rail, slope, wall and bridge pens", () => {
  for (const [code, low, high] of [[2301, 8, 10], [2303, 8, 6], [6101, 3, 2], [6130, 3, 4], [6201, 3, 2]]) {
    assert.equal(penForCode(spec, code, 500, "line").pen, low);
    assert.equal(penForCode(spec, code, 2500, "line").pen, high);
  }
  assert.equal(penForCode(spec, 6141, 500, "line").pen, 6);
  assert.equal(penForCode(spec, 7102, 500, "line").pen, 2);
  assert.equal(penForCode(spec, 7301, 500, "point").pen, 4);
  const bridge = penForCode(spec, 2401, 500, "line").pen;
  assert.equal(evaluate(bridge, {DMFIGTYPE: 11}), 6);
  assert.equal(evaluate(bridge, {DMFIGTYPE: 22}), 3);
  assert.equal(penForCode(spec, 5188, 2500, "line").pen, 3);
});

test("every shipped stroke is calibrated to its declared pen at the native scale", () => {
  for (const level of [250, 500, 1000, 2500, 5000]) for (const layer of style(level).layers) {
    const pen = layer.metadata?.["dm:pen-number"]; if (pen === undefined) continue;
    for (const DMFIGTYPE of [11, 12, 21, 22, 23]) {
      const props = {DMFIGTYPE, DMCODE: Number(layer["source-layer"].split("_")[1]) || 2102};
      for (const delta of [-1, 0, 1]) {
        const mm = evaluate(layer.paint[layer.metadata["dm:pen-property"]], props, getZoomByScale(level, 36) + delta) / MM_TO_PX;
        close(mm, evaluate(pen, props) * 0.05 * 2 ** delta);
      }
    }
    if (layer.metadata["dm:dash-mm"]) {
      const penNumber = evaluate(pen, {DMFIGTYPE: 11});
      layer.paint["line-dasharray"].forEach((dash, i) => assert.ok(Math.abs(dash * penNumber * 0.05 - layer.metadata["dm:dash-mm"][i]) < 1e-6));
    }
  }
});

test("latitude calibration and rebundling preserve paper line widths without double scaling", () => {
  const original = style(250); const snapshot = JSON.stringify(original);
  for (const latitude of [26, 36, 44]) {
    const rebased = rebasePenWidths(original, latitude);
    const again = rebasePenWidths(rebased, latitude);
    const line = again.layers.find(layer => layer["source-layer"] === "dm_2102_line");
    close(evaluate(line.paint["line-width"], {}, getZoomByScale(250, latitude)) / MM_TO_PX, 0.30);
    assert.deepEqual(rebased, again);
  }
  assert.equal(JSON.stringify(original), snapshot);
  close(evaluate(penWidthExpression(6, 250, 36), {}, getZoomByScale(250, 36)) / MM_TO_PX, 0.30);
});


test("fallback source layers select the audited pen by DM code and subtype", () => {
  const expression = defaultPenExpression(spec, 250, "line");
  assert.equal(evaluate(expression, {DMCODE: 2102, DMFIGTYPE: 11}), 6);
  assert.equal(evaluate(expression, {DMCODE: 2401, DMFIGTYPE: 22}), 3);
  assert.equal(evaluate(expression, {DMCODE: 9999}), 3);
  assert.equal(defaultPenExpression({aliases: [], codes: {}}, 500, "line"), 3);
  assert.equal(penForCode(spec, 9999, 500, "line").origin, "default");
});
