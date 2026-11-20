import {getZoomByScale} from "../src/core/map-scale.js";
import {MM_TO_PX} from "../src/core/pen-width.js";
import {evaluate} from "./helpers/pen-expressions.js";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {annotationTextField, verticalLongSoundAnnotationTextField} from "../src/core/style-editing.js";

// Geometry, color and annotation regressions are retained from the original styles.
// Stroke widths are verified in paper millimeters against the audited pen metadata;
// historical pixel constants are not the source of truth for pen numbers.
const MAPLIBRE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "static", "maplibre");
const readJson = (relative) => JSON.parse(readFileSync(path.join(MAPLIBRE, relative), "utf8"));

const STYLE_2500 = readJson("style-2500.json");
const STYLE_5000 = readJson("style-5000.json");
const STYLE_500 = readJson("style-500.json");
const STYLE_1000 = readJson("style-1000.json");
const STYLES = [[STYLE_2500, 2500], [STYLE_5000, 5000]];
const LOW_LEVEL_STYLES = [[STYLE_500, 500, 0.019405275, 19.8710018], [STYLE_1000, 1000, 0.03881055, 39.7420036]];
const ALL_STYLES = [[STYLE_500, 500], [STYLE_1000, 1000], ...STYLES];
const SPRITE = readJson("sprite/sprite.json");

const MIN_ZOOM = 14;

const ANNOTATION_SIZES = [
  [7101, 1.5], [7102, 1.5], [7103, 1.5], [7105, 1.5], [7106, 1.5], [7107, 1.5],
  [7301, 2.0], [7302, 2.0], [7304, 2.0], [7305, 2.0], [7308, 2.0], [7311, 2.0],
  [7312, 1.5],
  [8110, 5.0], [8111, 4.5], [8112, 3.0], [8113, 4.0], [8114, 3.5], [8115, 3.0],
  [8116, 3.0], [8121, 3.0], [8122, 2.5], [8123, 3.0], [8124, 2.5], [8125, 2.5],
  [8126, 2.5], [8131, 2.5], [8142, 2.5], [8151, 3.5], [8152, 2.5], [8162, 2.5],
  [8163, 2.5], [8171, 3.0], [8173, 3.0], [8181, 2.0],
];

const byId = (style, id) => {
  const layer = style.layers.find((candidate) => candidate.id === id);
  assert.ok(layer, `missing layer ${id}`);
  return layer;
};

const annotationLayer = (style, dmcode, vertical = false) => {
  const layer = style.layers.find((candidate) => (
    candidate["source-layer"] === "dm_annotation" &&
    annotationDmCodes(candidate).includes(dmcode) &&
    (candidate.layout?.["text-writing-mode"]?.includes("vertical") ?? false) === vertical
  ));
  assert.ok(layer, `missing ${vertical ? "vertical" : "horizontal"} annotation layer for ${dmcode}`);
  return layer;
};

const annotationDmCodes = (layer) => {
  const find = (value) => {
    if (!Array.isArray(value)) return undefined;
    if (
      value[0] === "in" &&
      JSON.stringify(value[1]) === JSON.stringify(["get", "DMCODE"]) &&
      value[2]?.[0] === "literal"
    ) return value[2][1];
    for (const item of value) {
      const found = find(item);
      if (found) return found;
    }
    return undefined;
  };
  return find(layer.filter) ?? [];
};

const assertApprox = (actual, expected, id) => {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${id}: ${actual} != ${expected}`);
};

test("fixed styles are version 8 with a single dm vector source", () => {
  for (const [style] of STYLES) {
    assert.equal(style.version, 8);
    assert.deepEqual(Object.keys(style.sources), ["dm"]);
    assert.equal(style.sources.dm.type, "vector");
  }
});

test("fixed styles include text labels", () => {
  for (const [style] of STYLES) {
    const labels = style.layers.filter(
      (layer) =>
        layer["source-layer"] === "dm_annotation" &&
        layer.layout?.["text-field"] != null,
    ).length;
    assert.equal(labels, 16);
  }
});

test("fixed styles merge annotations into eight groups per direction", () => {
  const expectedCodes = new Set(ANNOTATION_SIZES.map(([dmcode]) => dmcode));
  for (const [style] of ALL_STYLES) {
    const labels = style.layers.filter((layer) => layer["source-layer"] === "dm_annotation");
    const horizontal = labels.filter((layer) => !layer.layout?.["text-writing-mode"]?.includes("vertical"));
    const vertical = labels.filter((layer) => layer.layout?.["text-writing-mode"]?.includes("vertical"));
    assert.equal(horizontal.length, 8);
    assert.equal(vertical.length, 8);
    assert.deepEqual(new Set(horizontal.flatMap(annotationDmCodes)), expectedCodes);
    assert.deepEqual(new Set(vertical.flatMap(annotationDmCodes)), expectedCodes);
  }
});

test("fixed styles include default line and polygon fallback layers", () => {
  const cases = [
    [STYLE_2500, 2500, 0.0970256000025, 99.35421440256],
    [STYLE_5000, 5000, 0.194051200005, 198.70842880512],
  ];
  for (const [style, level] of cases) {
    for (const [kind, sourceLayer, suffix] of [
      ["line", "dm_default_line", "line"],
      ["polygon", "dm_default_polygon", "outline"],
    ]) {
      const id = `dm-default-${kind}-${level}-${suffix}`;
      const layer = byId(style, id);
      assert.equal(layer.source, "dm", id);
      assert.equal(layer["source-layer"], sourceLayer, id);
      assert.equal(layer.type, "line", id);
      assertStrokeMinzoom(layer);
      assert.deepEqual(layer.filter.slice(0, 2), ["all", ["==", ["get", "LEVEL"], level]], id);
      assert.equal(layer.paint["line-color"], "#000000", id);
      assertStroke(layer, "line-width");
    }
  }
});

test("fixed styles include default point fallback layers", () => {
  const cases = [
    [STYLE_500, 500, 0.04851280000125, 49.67710720128],
    [STYLE_1000, 1000, 0.0970256000025, 99.35421440256],
    [STYLE_2500, 2500, 0.24256400000625, 248.3855360064],
    [STYLE_5000, 5000, 0.4851280000125, 496.7710720128],
  ];
  for (const [style, level, radius14, radius24] of cases) {
    const id = `dm-default-point-${level}-symbol`;
    const layer = byId(style, id);
    assert.equal(layer.source, "dm", id);
    assert.equal(layer["source-layer"], "dm_default_point", id);
    assert.equal(layer.type, "circle", id);
    assertStrokeMinzoom(layer);
    assert.deepEqual(layer.filter.slice(0, 2), ["all", ["==", ["get", "LEVEL"], level]], id);
    assert.equal(layer.paint["circle-color"], "#000000", id);
    assert.deepEqual(layer.paint["circle-radius"], [
      "interpolate",
      ["exponential", 2],
      ["zoom"],
      14,
      radius14,
      24,
      radius24,
    ]);
  }
});

test("default fallback layers skip DM codes with fixed styles", () => {
  for (const [style, level] of STYLES) {
    const lineExclusions = byId(style, `dm-default-line-${level}-line`).filter[2][1][2][1];
    const polygonExclusions = byId(style, `dm-default-polygon-${level}-outline`).filter[2][1][2][1];
    const pointExclusions = byId(style, `dm-default-point-${level}-symbol`).filter[2][1][2][1];

    assert.ok(lineExclusions.includes(2101));
    assert.ok(!lineExclusions.includes(2100));
    assert.ok(polygonExclusions.includes(3001));
    assert.ok(!polygonExclusions.includes(3005));
    assert.ok(pointExclusions.includes(2239));
    assert.ok(pointExclusions.includes(3401));
    assert.ok(pointExclusions.includes(6110));
    assert.ok(pointExclusions.includes(6217));
    assert.ok(pointExclusions.includes(4208));
    assert.ok(pointExclusions.includes(7312));
    assert.ok(pointExclusions.includes(8199));
    assert.ok(!pointExclusions.includes(2100));
  }
});

test("every fixed point, line, and polygon code is excluded from its default fallback", () => {
  const defaults = [
    ["point", (level) => `dm-default-point-${level}-symbol`],
    ["line", (level) => `dm-default-line-${level}-line`],
    ["polygon", (level) => `dm-default-polygon-${level}-outline`],
  ];
  for (const [style, level] of ALL_STYLES) {
    for (const [kind, defaultId] of defaults) {
      const pattern = new RegExp(`^dm_(\\d+)_${kind}$`);
      const fixedCodes = new Set(
        style.layers
          .map((layer) => pattern.exec(layer["source-layer"] ?? ""))
          .filter(Boolean)
          .map((match) => Number(match[1])),
      );
      const exclusions = new Set(byId(style, defaultId(level)).filter[2][1][2][1]);
      for (const code of fixedCodes) {
        assert.ok(
          exclusions.has(code),
          `${defaultId(level)}: code ${code} has a fixed ${kind} layer but is not excluded from the default fallback`,
        );
      }
    }
  }
});

test("removed BMP symbols without SVG replacements remain fallback point styles", () => {
  const removed = [3539];
  for (const [style, level] of ALL_STYLES) {
    const pointExclusions = byId(style, `dm-default-point-${level}-symbol`).filter[2][1][2][1];
    for (const dmcode of removed) {
      assert.equal(style.layers.some((layer) => layer.id === `dm-${dmcode}-point-${level}-symbol`), false);
      assert.equal(pointExclusions.includes(dmcode), false);
    }
  }
});

test("fixed styles render building polygons with line styles", () => {
  for (const [style, level] of STYLES) {
    for (const code of [3001, 3002, 3003, 3004]) {
      const line = byId(style, `dm-${code}-line-${level}-line`);
      const polygon = byId(style, `dm-${code}-polygon-${level}-line`);
      assert.equal(polygon["source-layer"], `dm_${code}_polygon`);
      assert.equal(polygon.type, "line");
      assert.deepEqual(polygon.filter, line.filter);
      assertStrokeMinzoom(polygon);
      assert.deepEqual({...polygon.paint, "line-width": undefined}, {...line.paint, "line-width": undefined});
      assertStroke(polygon); assertStroke(line);
    }
  }
});

test("codes 3001 and 3002 render line and polygon outlines with fixed millimeter widths", () => {

  for (const [style, level] of ALL_STYLES) {
    for (const code of [3001, 3002]) {

      for (const kind of ["line", "polygon"]) {
        const layer = byId(style, `dm-${code}-${kind}-${level}-line`);
        assertStrokeMinzoom(layer);
        assertStroke(layer, "line-width");
      }
    }
  }
});

test("code 3003 uses PDF-derived pen widths for outlines", () => {

  for (const [style, level] of STYLES) {

    for (const kind of ["line", "polygon"]) {
      const layer = byId(style, `dm-3003-${kind}-${level}-line`);
      assertStrokeMinzoom(layer);
      assertDashLengths(layer);
      assertStroke(layer, "line-width");
    }
  }
});

test("code 3004 uses PDF-derived pen widths for outlines", () => {

  for (const [style, level] of ALL_STYLES) {

    for (const kind of ["line", "polygon"]) {
      const layer = byId(style, `dm-3004-${kind}-${level}-line`);
      assertStrokeMinzoom(layer);
      assertDashLengths(layer);
      assertStroke(layer, "line-width");
    }
  }
});

test("code 3401 uses PDF-derived pen widths for outlines", () => {

  for (const [style, level] of STYLES) {

    const line = byId(style, `dm-3401-line-${level}-line`);
    const polygon = byId(style, `dm-3401-polygon-${level}-line`);
    for (const [layer, sourceLayer] of [[line, "dm_3401_line"], [polygon, "dm_3401_polygon"]]) {
      assert.equal(layer.type, "line");
      assert.equal(layer["source-layer"], sourceLayer);
      assertStrokeMinzoom(layer);
      assert.equal(layer.paint["line-dasharray"], undefined);
      assertStroke(layer, "line-width");
    }
    assert.deepEqual(polygon.filter, line.filter);
  }
});

test("code 3402 uses PDF-derived pen widths for dashed lines", () => {

  for (const [style, level] of ALL_STYLES) {

    const layer = byId(style, `dm-3402-line-${level}-line`);
    assertStrokeMinzoom(layer);
    assertDashLengths(layer);
    assertStroke(layer, "line-width");
  }
});

test("code 4207 uses PDF-derived pen widths for lines", () => {

  for (const [style, level] of ALL_STYLES) {

    const layer = byId(style, `dm-4207-line-${level}-line`);
    assert.equal(layer.type, "line");
    assert.equal(layer["source-layer"], "dm_4207_line");
    assertStrokeMinzoom(layer);
    assert.equal(layer.paint["line-color"], "#000000");
    assert.equal(layer.paint["line-dasharray"], undefined);
    assertStroke(layer, "line-width");
  }
});

test("code 4219 uses PDF-derived pen widths for outlines", () => {

  for (const [style, level] of ALL_STYLES) {

    const line = byId(style, `dm-4219-line-${level}-line-line`);
    const polygon = byId(style, `dm-4219-polygon-${level}-line`);
    for (const [layer, sourceLayer] of [[line, "dm_4219_line"], [polygon, "dm_4219_polygon"]]) {
      assert.equal(layer.type, "line");
      assert.equal(layer["source-layer"], sourceLayer);
      assertStrokeMinzoom(layer);
      assert.equal(layer.paint["line-color"], "#000000");
      assert.equal(layer.paint["line-dasharray"], undefined);
      assertStroke(layer, "line-width");
    }
    assert.deepEqual(polygon.filter, line.filter);
  }
});

test("code 4231 uses PDF-derived pen widths for outlines", () => {

  for (const [style, level] of ALL_STYLES) {

    const layer = byId(style, `dm-4231-polygon-${level}-line`);
    assert.equal(layer.type, "line");
    assert.equal(layer["source-layer"], "dm_4231_polygon");
    assertStrokeMinzoom(layer);
    assert.equal(layer.paint["line-color"], "#000000");
    assert.equal(layer.paint["line-dasharray"], undefined);
    assertStroke(layer, "line-width");
  }
});

test("codes 4234, 4235, and 4241 use PDF-derived pen widths for outlines", () => {

  for (const [style, level] of ALL_STYLES) {

    for (const code of [4234, 4235, 4241]) {
      for (const kind of ["line", "polygon"]) {
        const layer = byId(style, `dm-${code}-${kind}-${level}-line`);
        assert.equal(layer.type, "line");
        assert.equal(layer["source-layer"], `dm_${code}_${kind}`);
        assertStrokeMinzoom(layer);
        assert.equal(layer.paint["line-color"], "#000000");
        assert.equal(layer.paint["line-dasharray"], undefined);
        assertStroke(layer, "line-width");
      }
    }
  }
});

test("codes 2219, 2226, 2228, and 2419 render polygon outlines with line styles", () => {
  for (const [style, level] of ALL_STYLES) {
    for (const [code, lineSuffix] of [[2219, "line-line"], [2226, "line"], [2228, "line"], [2419, "line-line"]]) {
      const line = byId(style, `dm-${code}-line-${level}-${lineSuffix}`);
      const polygon = byId(style, `dm-${code}-polygon-${level}-line`);
      assert.equal(polygon["source-layer"], `dm_${code}_polygon`);
      assert.equal(polygon.type, "line");
      assert.deepEqual(polygon.filter, line.filter);
      assertStrokeMinzoom(polygon);
      assert.deepEqual({...polygon.paint, "line-width": undefined}, {...line.paint, "line-width": undefined});
      assertStroke(polygon); assertStroke(line);
    }
  }
});

test("code 2421 uses PDF-derived pen widths for outlines", () => {

  for (const [style, level] of STYLES) {

    const line = byId(style, `dm-2421-line-${level}-line`);
    const polygon = byId(style, `dm-2421-polygon-${level}-line`);
    for (const [layer, sourceLayer] of [[line, "dm_2421_line"], [polygon, "dm_2421_polygon"]]) {
      assert.equal(layer.type, "line");
      assert.equal(layer["source-layer"], sourceLayer);
      assertStrokeMinzoom(layer);
      assert.equal(layer.paint["line-color"], "#000000");
      assert.equal(layer.paint["line-dasharray"], undefined);
      assertStroke(layer, "line-width");
    }
    assert.deepEqual(polygon.filter, line.filter);
  }
});

test("code 2424 uses PDF-derived pen widths for outlines", () => {

  for (const [style, level] of ALL_STYLES) {

    const line = byId(style, `dm-2424-line-${level}-line`);
    const polygon = byId(style, `dm-2424-polygon-${level}-line`);
    for (const [layer, sourceLayer] of [[line, "dm_2424_line"], [polygon, "dm_2424_polygon"]]) {
      assert.equal(layer.type, "line");
      assert.equal(layer["source-layer"], sourceLayer);
      assertStrokeMinzoom(layer);
      assert.equal(layer.paint["line-color"], "#000000");
      assert.equal(layer.paint["line-dasharray"], undefined);
      assertStroke(layer, "line-width");
    }
    assert.deepEqual(polygon.filter, line.filter);
  }
});

test("code 2428 uses PDF-derived pen widths for outlines", () => {

  for (const [style, level] of STYLES) {

    const line = byId(style, `dm-2428-line-${level}-line`);
    const polygon = byId(style, `dm-2428-polygon-${level}-line`);
    for (const [layer, sourceLayer] of [[line, "dm_2428_line"], [polygon, "dm_2428_polygon"]]) {
      assert.equal(layer.type, "line");
      assert.equal(layer["source-layer"], sourceLayer);
      assertStrokeMinzoom(layer);
      assert.equal(layer.paint["line-color"], "#000000");
      assertDashLengths(layer);
      assertStroke(layer, "line-width");
    }
    assert.deepEqual(polygon.filter, line.filter);
  }
});

test("fixed styles split horizontal and vertical annotations", () => {
  for (const [style, level] of STYLES) {
    for (const [dmcode] of ANNOTATION_SIZES) {
      const horizontal = annotationLayer(style, dmcode);
      const vertical = annotationLayer(style, dmcode, true);
      assert.equal(horizontal["source-layer"], "dm_annotation");
      assert.equal(vertical["source-layer"], "dm_annotation");
      assert.deepEqual(horizontal.filter.slice(0, 3), [
        "all",
        ["==", ["get", "LEVEL"], level],
        ["!=", ["coalesce", ["get", "VERTICAL"], 0], 1],
      ], horizontal.id);
      assert.deepEqual(vertical.filter.slice(0, 3), [
        "all",
        ["==", ["get", "LEVEL"], level],
        ["==", ["get", "VERTICAL"], 1],
      ], vertical.id);
      assert.ok(annotationDmCodes(horizontal).includes(dmcode), horizontal.id);
      assert.ok(annotationDmCodes(vertical).includes(dmcode), vertical.id);
      assert.deepEqual(vertical.layout["text-writing-mode"], ["vertical"]);
      assert.deepEqual(vertical.layout["text-rotate"], [
        "-",
        ["coalesce", ["get", "ROTATION"], 90],
        90,
      ]);
      assert.deepEqual(horizontal.layout["text-field"], annotationTextField(), horizontal.id);
      assert.deepEqual(vertical.layout["text-field"], verticalLongSoundAnnotationTextField(), vertical.id);
    }
  }
});

test("fixed styles anchor annotations at their specified origins", () => {
  for (const [style, level] of ALL_STYLES) {
    for (const [dmcode] of ANNOTATION_SIZES) {
      const horizontal = annotationLayer(style, dmcode);
      const vertical = annotationLayer(style, dmcode, true);
      assert.equal(horizontal.layout["text-anchor"], "bottom-left", horizontal.id);
      assert.equal(vertical.layout["text-anchor"], "bottom-left", vertical.id);
    }
  }
});

test("fixed styles always show annotations regardless of overlap", () => {
  for (const [style, level] of STYLES) {
    for (const [dmcode] of ANNOTATION_SIZES) {
      const horizontal = annotationLayer(style, dmcode);
      const vertical = annotationLayer(style, dmcode, true);
      assert.equal(horizontal.layout["text-allow-overlap"], true, horizontal.id);
      assert.equal(vertical.layout["text-allow-overlap"], true, vertical.id);
    }
  }
});

test("fixed styles scale annotation outlines with the text strokes", () => {
  for (const [style, level] of ALL_STYLES) {
    for (const [dmcode] of ANNOTATION_SIZES) {
      const horizontal = annotationLayer(style, dmcode);
      const vertical = annotationLayer(style, dmcode, true);
      const textSize = horizontal.layout["text-size"];
      const expected = [
        "interpolate", textSize[1], textSize[2],
        textSize[3], textSize[4] * 0.1,
        textSize[5], textSize[6] * 0.1,
      ];
      assert.deepEqual(horizontal.paint["text-halo-width"], expected, horizontal.id);
      assert.deepEqual(vertical.paint["text-halo-width"], expected, vertical.id);
    }
  }
});

test("fixed styles use annotation sizes in millimeters", () => {
  for (const [style, level] of STYLES) {
    const scale = level / 2500;
    for (const [dmcode, sizeMm] of ANNOTATION_SIZES) {
      const layer = annotationLayer(style, dmcode);
      const textSize = layer.layout["text-size"];
      assert.equal(textSize[0], "interpolate", layer.id);
      assert.deepEqual(textSize[1], ["exponential", 2]);
      assert.deepEqual(textSize[2], ["zoom"]);
      assert.equal(textSize[3], 15, layer.id);
      assertApprox(textSize[4], sizeMm * 1.2936746667 * scale, layer.id);
      assert.equal(textSize[5], 24, layer.id);
      assertApprox(textSize[6], sizeMm * 662.3614293504 * scale, layer.id);
    }
  }
});

test("fixed styles use annotation character spacing in tenths of millimeters", () => {
  for (const [style, level] of STYLES) {
    for (const [dmcode, sizeMm] of ANNOTATION_SIZES) {
      const horizontal = annotationLayer(style, dmcode);
      const vertical = annotationLayer(style, dmcode, true);
      const expected = [
        "*",
        ["coalesce", ["get", "CHARSPACING"], 0],
        0.1 / sizeMm,
      ];
      assert.deepEqual(horizontal.layout["text-letter-spacing"], expected, horizontal.id);
      assert.deepEqual(vertical.layout["text-letter-spacing"], expected, vertical.id);
    }
  }
});

test("fixed styles keep long annotations on one line", () => {
  for (const [style, level] of STYLES) {
    for (const [dmcode] of ANNOTATION_SIZES) {
      const horizontal = annotationLayer(style, dmcode);
      const vertical = annotationLayer(style, dmcode, true);
      assert.equal(horizontal.layout["text-max-width"], 100, horizontal.id);
      assert.equal(vertical.layout["text-max-width"], 100, vertical.id);
    }
  }
});

test("mine entrance symbol is one point five millimeters", () => {
  const cases = [
    [STYLE_2500, 2500, ["interpolate", ["exponential", 2], ["zoom"], 15, 0.060641, 24, 31.04844]],
    [STYLE_5000, 5000, ["interpolate", ["exponential", 2], ["zoom"], 15, 0.121283, 24, 62.09688]],
  ];
  for (const [style, level, expected] of cases) {
    for (const dmcode of [2219, 2419, 4219]) {
      const id = `dm-${dmcode}-point-${level}-symbol-point`;
      const layer = byId(style, id);
      assert.equal(layer.type, "symbol", id);
      assert.equal((layer.metadata?.["dm:icon-base"] ?? layer.layout["icon-image"]), "dm-4219", id);
      assert.deepEqual(layer.layout["icon-rotate"], ["coalesce", ["get", "ROTATION"], 0]);
      assert.deepEqual(layer.layout["icon-size"], expected, id);
    }
  }
});

test("code 2238 is an unfilled half millimeter circle", () => {
  const cases = [
    [STYLE_2500, 2500, 0.323418666675, 165.5903573376, 0.12936746667, 66.23614293504],
    [STYLE_5000, 5000, 0.64683733335, 331.1807146752, 0.25873493334, 132.47228587008],
  ];
  assertUnfilledCircle("dm-2238", cases);
});

test("code 3401 point is a rotating half millimeter square", () => {
  const cases = [
    [STYLE_2500, 2500, 0.0202136666671875, 10.3493973336],
    [STYLE_5000, 5000, 0.040427333334375, 20.6987946672],
  ];
  for (const [style, level, atZoom15, atZoom24] of cases) {
    const id = `dm-3401-point-${level}-symbol`;
    const layer = byId(style, id);
    assert.equal(layer.type, "symbol", id);
    assert.equal(layer["source-layer"], "dm_3401_point", id);
    assert.equal((layer.metadata?.["dm:icon-base"] ?? layer.layout["icon-image"]), "dm-3401", id);
    assert.deepEqual(layer.layout["icon-rotate"], ["coalesce", ["get", "ROTATION"], 0]);
    assert.deepEqual(layer.layout["icon-size"], [
      "interpolate",
      ["exponential", 2],
      ["zoom"],
      15,
      atZoom15,
      24,
      atZoom24,
    ]);
  }
  assert.ok(SPRITE["dm-3401"]);
});

test("code 6110 point is an unfilled three tenths millimeter diameter circle with the PDF-derived stroke width", () => {
  const cases = [
    [STYLE_2500, 2500, 0.0970256000025, 49.67710720128, 0.12936746667, 66.23614293504],
    [STYLE_5000, 5000, 0.194051200005, 99.35421440256, 0.25873493334, 132.47228587008],
  ];
  assertUnfilledCircle("dm-6110", cases);
});

test("code 7311 is an unfilled three tenths millimeter circle", () => {
  const cases = [
    [STYLE_2500, 2500, 0.194051200005, 99.35421440256, 0.25873493334, 132.47228587008],
    [STYLE_5000, 5000, 0.38810240001, 198.70842880512, 0.51746986668, 264.94457174016],
  ];
  assertUnfilledCircle("dm-7311", cases);
});

test("code 7312 is an unfilled three tenths millimeter diameter circle with the PDF-derived stroke width", () => {
  const cases = [
    [STYLE_2500, 2500, 0.0970256000025, 49.67710720128, 0.25873493334, 132.47228587008],
    [STYLE_5000, 5000, 0.194051200005, 99.35421440256, 0.51746986668, 264.94457174016],
  ];
  assertUnfilledCircle("dm-7312", cases);
});

test("code 8199 is an unfilled three tenths millimeter diameter circle with the PDF-derived stroke width", () => {
  const cases = [
    [STYLE_2500, 2500, 0.0970256000025, 49.67710720128, 0.25873493334, 132.47228587008],
    [STYLE_5000, 5000, 0.194051200005, 99.35421440256, 0.51746986668, 264.94457174016],
  ];
  assertUnfilledCircle("dm-8199", cases);
});

test("code 4231 is a white two millimeter circle with the PDF-derived stroke width", () => {
  const cases = [
    [STYLE_2500, 2500, 0.64683733335, 331.1807146752, 0.194051200005, 99.35421440256],
    [STYLE_5000, 5000, 1.2936746667, 662.3614293504, 0.38810240001, 198.70842880512],
  ];
  for (const [style, level, radius15, radius24, stroke15, stroke24] of cases) {
    const id = `dm-4231-point-${level}-symbol`;
    const layer = byId(style, id);
    assert.equal(layer.type, "circle");
    assert.equal(layer.paint["circle-color"], "#FFFFFF");
    assert.equal(layer.paint["circle-stroke-color"], "#000000");

    const radius = layer.paint["circle-radius"];
    assert.deepEqual(radius.slice(0, 4), ["interpolate", ["exponential", 2], ["zoom"], 15]);
    assertApprox(radius[4], radius15, id);
    assert.equal(radius[5], 24);
    assertApprox(radius[6], radius24, id);

    assertStroke(layer, "circle-stroke-width");
  }
});

test("code 5232 retains the coarse 0.5 mm point circle", () => {
  const cases = [
    [STYLE_2500, 2500, 0.1617093333375, 165.5903573376, 0.12936746667, 66.23614293504],
    [STYLE_5000, 5000, 0.323418666675, 331.1807146752, 0.25873493334, 132.47228587008],
  ];
  for (const [style, level, radius15, radius24, stroke15, stroke24] of cases) {
    const id = `dm-5232-point-${level}-symbol`;
    const layer = byId(style, id);
    assert.equal(layer.type, "circle", id);
    assert.equal(layer["source-layer"], "dm_5232_point", id);
    assert.equal(layer.paint["circle-color"], "#FFFFFF", id);
    assert.equal(layer.paint["circle-stroke-color"], "#000000", id);

    const radius = layer.paint["circle-radius"];
    assert.deepEqual(radius.slice(0, 4), ["interpolate", ["exponential", 2], ["zoom"], 15]);
    assertApprox(radius[4], radius15, id);
    assert.equal(radius[5], 24);
    assertApprox(radius[6], radius24, id);

    assertStroke(layer, "circle-stroke-width");
  }
});

test("code 5232 line is not displayed", () => {
  for (const [style, level] of ALL_STYLES) {
    assert.equal(style.layers.some((layer) => layer.id === `dm-5232-line-${level}-line`), false);
    assert.equal(style.layers.some((layer) => layer["source-layer"] === "dm_5232_line"), false);
    assert.ok(byId(style, `dm-default-line-${level}-line`).filter[2][1][2][1].includes(5232));
  }
});

test("code 6340 keeps its coarse S icon while native levels use calibrated text", () => {
  const cases = [
    [STYLE_2500, 2500, 0.033748034782608696, 17.27899380914087],
    [STYLE_5000, 5000, 0.06749606956521739, 34.55798761828174],
  ];
  for (const [style, level, atZoom15, atZoom24] of cases) {
    const id = `dm-6340-point-${level}-symbol`;
    const layer = byId(style, id);
    assert.equal(layer.type, "symbol", id);
    assert.equal((layer.metadata?.["dm:icon-base"] ?? layer.layout["icon-image"]), "dm-6340", id);
    assert.deepEqual(layer.layout["icon-size"], [
      "interpolate",
      ["exponential", 2],
      ["zoom"],
      15,
      atZoom15,
      24,
      atZoom24,
    ]);
  }
});

test("codes 7201 and 7211 retain their centered symbols", () => {
  const cases = [
    [STYLE_500, 500, 0.016170933334, 8.27951786688],
    [STYLE_1000, 1000, 0.032341866668, 16.55903573376],
    [STYLE_2500, 2500, 0.080854666669, 41.3975893344],
    [STYLE_5000, 5000, 0.161709333338, 82.7951786688],
  ];
  for (const [style, level, atZoom15, atZoom24] of cases) {
    for (const code of [7201]) {
      const id = `dm-${code}-point-${level}-symbol`;
      const layer = byId(style, id);
      assert.equal(layer.type, "symbol", id);
      assert.equal(layer["source-layer"], `dm_${code}_point`, id);
      assert.equal((layer.metadata?.["dm:icon-base"] ?? layer.layout["icon-image"]), `dm-${code}`, id);
      assert.equal(layer.layout["icon-allow-overlap"], true, id);
      if(level<=1000){assert.equal(layer.metadata["dm:icon-native-size"].width,3.5);assert.equal(layer.metadata["dm:icon-native-size"].height,2.5);}else assert.deepEqual(layer.layout["icon-size"], [
        "interpolate",
        ["exponential", 2],
        ["zoom"],
        15,
        atZoom15,
        24,
        atZoom24,
      ]);
    }
  }

  assert.deepEqual(SPRITE["dm-5105"], {width: 32, height: 32, x: 32, y: 256, pixelRatio: 1});
  assert.deepEqual(SPRITE["dm-7201"], {width: 64, height: 32, x: 64, y: 256, pixelRatio: 1});
  assert.deepEqual(SPRITE["dm-7211"], {width: 64, height: 32, x: 160, y: 256, pixelRatio: 1});
});

test("code 7303 uses the native 2.5 mm circle and preserves coarse symbols", () => {
  const cases = [
    [STYLE_500, 500, 0.00485128, 2.483855360064],
    [STYLE_1000, 1000, 0.00970256, 4.967710720128],
    [STYLE_2500, 2500, 0.0242564, 12.41927680032],
    [STYLE_5000, 5000, 0.0485128, 24.83855360064],
  ];
  for (const [style, level, atZoom15, atZoom24] of cases) {
    const id = `dm-7303-point-${level}-symbol`;
    const layer = byId(style, id);
    assert.equal(layer.type, "symbol", id);
    assert.equal((layer.metadata?.["dm:icon-base"] ?? layer.layout["icon-image"]), "dm-7303", id);
    if(level<=1000){assert.equal(layer.metadata["dm:icon-native-size"].width,2.5);}else assert.deepEqual(layer.layout["icon-size"], [
      "interpolate",
      ["exponential", 2],
      ["zoom"],
      15,
      atZoom15,
      24,
      atZoom24,
    ]);
  }
});

test("code 7304 uses the bundled point symbol", () => {
  const cases = [
    [STYLE_500, 500, 0.0129368, 6.6236672],
    [STYLE_1000, 1000, 0.0129368, 6.6236672],
    [STYLE_2500, 2500, 0.064684, 33.118336],
    [STYLE_5000, 5000, 0.064684, 33.118336],
  ];
  for (const [style, level, atZoom15, atZoom24] of cases) {
    const id = `dm-7304-point-${level}-symbol`;
    const layer = byId(style, id);
    assert.equal(layer.type, "symbol", id);
    assert.equal(layer["source-layer"], "dm_7304_point", id);
    assert.equal((layer.metadata?.["dm:icon-base"] ?? layer.layout["icon-image"]), "dm-7304", id);
    assert.equal(layer.layout["icon-allow-overlap"], true, id);
    assert.deepEqual(layer.layout["icon-rotate"], ["coalesce", ["get", "ROTATION"], 0], id);
    if(level<=1000){
      assert.equal(layer.metadata["dm:icon-native-size"].width,2.5);
    }else assert.deepEqual(layer.layout["icon-size"], [
      "interpolate",
      ["exponential", 2],
      ["zoom"],
      15,
      atZoom15,
      24,
      atZoom24,
    ]);
  }
});

test("code 6217 uses a rotating solar icon with the same paper canvas at every level", () => {
  for (const [style, level] of ALL_STYLES) {
    const layer=byId(style, `dm-6217-point-${level}-symbol-point`);
    assert.equal(layer["source-layer"], "dm_6217_point");
    assert.deepEqual(layer.layout["icon-rotate"], ["coalesce", ["get", "ROTATION"], 0]);
    assert.equal(layer.metadata["dm:icon-canvas-mm"],6);
  }
  assert.ok(SPRITE["dm-6217"]);
});

test("code 6315 uses the bundled point symbol", () => {
  const sizes = new Map([
    [500, [0.016171, 8.2795842]],
    [1000, [0.016171, 8.2795842]],
    [2500, [0.080855, 41.397921]],
    [5000, [0.080855, 41.397921]],
  ]);
  for (const [style, level] of ALL_STYLES) {
    const [atZoom15, atZoom24] = sizes.get(level);
    const id = `dm-6315-point-${level}-symbol`;
    const layer = byId(style, id);
    assert.equal(layer.type, "symbol", id);
    assert.equal(layer["source-layer"], "dm_6315_point", id);
    assert.equal((layer.metadata?.["dm:icon-base"] ?? layer.layout["icon-image"]), "dm-6315", id);
    assert.deepEqual(layer.layout["icon-rotate"], ["coalesce", ["get", "ROTATION"], 0]);
    if(level<=1000){
      assert.equal(layer.metadata["dm:icon-native-size"].width,2.5);
    }else assert.deepEqual(layer.layout["icon-size"], [
      "interpolate",
      ["exponential", 2],
      ["zoom"],
      15,
      atZoom15,
      24,
      atZoom24,
    ]);
  }
  assert.ok(SPRITE["dm-6315"]);
});

test("code 4208 retains the original coarse rotating point symbol", () => {
  for (const [style, level] of STYLES) {
    const id = `dm-4208-point-${level}-symbol`;
    const layer = byId(style, id);
    assert.equal(layer.type, "symbol", id);
    assert.equal(layer["source-layer"], "dm_4208_point", id);
    assert.equal((layer.metadata?.["dm:icon-base"] ?? layer.layout["icon-image"]), `dm-4208-level-${level}`, id);
    assert.deepEqual(layer.layout["icon-rotate"], ["coalesce", ["get", "ROTATION"], 0]);
    assert.deepEqual(layer.layout["icon-size"], [
      "interpolate",
      ["exponential", 2],
      ["zoom"],
      15,
      0.080855,
      24,
      41.397921,
    ]);
  }
  assert.ok(SPRITE["dm-4208"]);
});

test("code 6214 rendered shape is one point seven millimeters high", () => {
  for (const [style, level] of STYLES) {
    const id = `dm-6214-point-${level}-symbol`;
    const layer = byId(style, id);
    assert.equal(layer.type, "symbol", id);
    assert.equal(layer["source-layer"], "dm_6214_point", id);
    assert.equal((layer.metadata?.["dm:icon-base"] ?? layer.layout["icon-image"]), "dm-6214", id);
    assert.deepEqual(layer.layout["icon-rotate"], ["coalesce", ["get", "ROTATION"], 0]);
    assert.deepEqual(layer.layout["icon-size"], [
      "interpolate",
      ["exponential", 2],
      ["zoom"],
      15,
      0.1099623466695,
      24,
      56.300721494784,
    ]);
  }
  assert.ok(SPRITE["dm-6214"]);
});

test("code 6130 is a two millimeter line and one point five millimeter gap pattern with circles", () => {
  const cases = [
    [STYLE_2500, 2500, [0.1293685, 132.473346], [0.097026375, 99.3550095]],
    [STYLE_5000, 5000, [0.2587349333, 264.9445717402], [0.194051199975, 198.70842880515]],
  ];
  for (const [style, level, lineWidth, circleRadius] of cases) {
    const code6130 = byId(style, `dm-6130-line-${level}-line`);
    assert.equal(code6130.type, "line");
    assert.equal(code6130["source-layer"], "dm_6130_line");
    assert.equal(code6130.layout.visibility, "none");
    assertDashLengths(code6130);
    assertStroke(code6130, "line-width");

    const dashes = byId(style, `dm-6130-line-${level}-dash-segments`);
    assert.equal(dashes.type, "line");
    assert.equal(dashes["source-layer"], "dm_6130_line_deco_line");
    assert.deepEqual(dashes.filter, ["==", ["get", "LEVEL"], level]);
    assertStroke(dashes, "line-width");
    assert.equal(dashes.paint["line-dasharray"], undefined);

    const circles = byId(style, `dm-6130-line-${level}-gap-circles`);
    assert.equal(circles.type, "circle");
    assert.equal(circles["source-layer"], "dm_6130_line_deco_point");
    assert.deepEqual(circles.filter, ["==", ["get", "LEVEL"], level]);
    assert.equal(circles.paint["circle-color"], "#000000");
    assert.deepEqual(circles.paint["circle-radius"], [
      "interpolate",
      ["exponential", 2],
      ["zoom"],
      14,
      circleRadius[0],
      24,
      circleRadius[1],
    ]);
  }
});

test("code 6140 uses PDF-derived pen widths for lines", () => {
  const cases = [
    [STYLE_2500, 2500, [0.12936746667, 132.47228587008]],
    [STYLE_5000, 5000, [0.25873493334, 264.94457174016]],
  ];
  for (const [style, level, code6140Width] of cases) {
    for (const [suffix, sourceLayer] of [["line", "dm_6140_line"], ["decoration", "dm_6140_line_deco_line"]]) {
      const id = `dm-6140-line-${level}-${suffix}`;
      const layer = byId(style, id);
      assert.equal(layer.type, "line", id);
      assert.equal(layer["source-layer"], sourceLayer, id);
      assert.equal(layer.paint["line-dasharray"], undefined, id);
      assertStroke(layer, "line-width");
    }
  }
});

test("codes 6201, 6301, and 6302 use PDF-derived pen widths for dashed lines", () => {

  const dasharrays = new Map([
    [6201, [15, 15]],
    [6301, [5, 5]],
    [6302, [30, 10]],
  ]);
  for (const [style, level] of STYLES) {

    for (const code of [6201, 6301, 6302]) {
      const id = `dm-${code}-line-${level}-line`;
      const layer = byId(style, id);
      assert.equal(layer.type, "line", id);
      assert.equal(layer["source-layer"], `dm_${code}_line`, id);
      assertStrokeMinzoom(layer);
      assert.deepEqual(layer.paint["line-dasharray"], dasharrays.get(code), id);
      assertStroke(layer, "line-width");
    }
  }
});

test("code 2203 base and decoration uses PDF-derived pen widths for lines", () => {

  for (const [style, level] of STYLES) {

    for (const [suffix, sourceLayer] of [["line", "dm_2203_line"], ["decoration", "dm_2203_line_deco_line"]]) {
      const id = `dm-2203-line-${level}-${suffix}`;
      const layer = byId(style, id);
      assert.equal(layer.type, "line", id);
      assert.equal(layer["source-layer"], sourceLayer, id);
      assertStroke(layer, "line-width");
    }
  }
});

test("codes 2101, 2106, and 2107 use PDF-derived pen widths for lines", () => {

  for (const [style, level] of ALL_STYLES) {

    for (const code of [2101, 2106, 2107]) {
      const layer = byId(style, `dm-${code}-line-${level}-line`);
      assertStroke(layer, "line-width");
    }
  }
});

test("code 2109 is zero point one five millimeter at levels 500 and 1000 and zero point one millimeter at levels 2500 and 5000", () => {

  const dasharrays = new Map([
    [500, [10, 10]],
    [1000, [10, 10]],
    [2500, [15, 15]],
    [5000, [15, 15]],
  ]);
  for (const [style, level] of ALL_STYLES) {

    const layer = byId(style, `dm-2109-line-${level}-line`);
    assertStrokeMinzoom(layer);
    assert.deepEqual(layer.paint["line-dasharray"], dasharrays.get(level));
    assertStroke(layer, "line-width");
  }
});

test("code 2103 uses PDF-derived pen widths for lines", () => {

  for (const [style, level] of ALL_STYLES) {

    const layer = byId(style, `dm-2103-line-${level}-line`);
    assertStroke(layer, "line-width");
  }
});

test("code 2204 base and decoration uses PDF-derived pen widths for lines", () => {
  for (const [style, level] of [[STYLE_500, 500]]) {
    for (const [suffix, sourceLayer] of [["line", "dm_2204_line"], ["decoration", "dm_2204_line_deco_line"]]) {
      const id = `dm-2204-line-${level}-${suffix}`;
      const layer = byId(style, id);
      assert.equal(layer.type, "line", id);
      assert.equal(layer["source-layer"], sourceLayer, id);
      assert.deepEqual(layer.filter, [
        "==",
        ["get", "LEVEL"],
        level,
      ]);
      assertStroke(layer, "line-width");
    }
  }
});

test("code 2205 base and decoration uses PDF-derived pen widths for lines", () => {

  for (const [style, level] of ALL_STYLES) {

    for (const [suffix, sourceLayer] of [["line", "dm_2205_line"], ["decoration", "dm_2205_line_deco_line"]]) {
      const id = `dm-2205-line-${level}-${suffix}`;
      const layer = byId(style, id);
      assert.equal(layer.type, "line", id);
      assert.equal(layer["source-layer"], sourceLayer, id);
      assertStroke(layer, "line-width");
    }
  }
});

test("codes 2211, 2214, 2215, 2219, 2226, 2228, 2411, and 2419 use PDF-derived pen widths for lines", () => {

  for (const [style, level] of ALL_STYLES) {

    for (const [code, suffix] of [[2211, "line"], [2214, "line"], [2215, "line"], [2219, "line-line"], [2226, "line"], [2228, "line"], [2411, "line"], [2419, "line-line"]]) {
      const layer = byId(style, `dm-${code}-line-${level}-${suffix}`);
      assertStrokeMinzoom(layer);
      assertStroke(layer, "line-width");
    }
  }
});

test("code 2213 is zero point one five millimeter at levels 500 and 1000 and zero point one millimeter at levels 2500 and 5000", () => {

  for (const [style, level] of ALL_STYLES) {

    const layer = byId(style, `dm-2213-line-${level}-line`);
    assertStrokeMinzoom(layer);
    assertStroke(layer, "line-width");
  }
});

test("code 2301 is zero point four millimeter at levels 500 and 1000 and zero point five millimeter at levels 2500 and 5000", () => {

  for (const [style, level] of ALL_STYLES) {

    const layer = byId(style, `dm-2301-line-${level}-line`);
    assertStrokeMinzoom(layer);
    assertStroke(layer, "line-width");
  }
});

test("code 2303 is zero point four millimeter at levels 500 and 1000 and zero point three millimeter at levels 2500 and 5000", () => {

  for (const [style, level] of ALL_STYLES) {

    const layer = byId(style, `dm-2303-line-${level}-line`);
    assertStrokeMinzoom(layer);
    assertStroke(layer, "line-width");
  }
});

test("code 2304 is a solid line", () => {
  for (const [style, level] of ALL_STYLES) {
    const layer = byId(style, `dm-2304-line-${level}-line`);
    assert.equal(layer.type, "line");
    assert.equal(layer["source-layer"], "dm_2304_line");
    assert.equal(layer.paint["line-dasharray"], undefined);
  }
});

test("code 2206 base and decoration uses PDF-derived pen widths for lines", () => {
  for (const [style, level] of LOW_LEVEL_STYLES) {
    for (const [suffix, sourceLayer] of [["line", "dm_2206_line"], ["decoration", "dm_2206_line_deco_line"]]) {
      const id = `dm-2206-line-${level}-${suffix}`;
      const layer = byId(style, id);
      assert.equal(layer.type, "line", id);
      assert.equal(layer["source-layer"], sourceLayer, id);
      assert.deepEqual(layer.filter, [
        "==",
        ["get", "LEVEL"],
        level,
      ]);
      assertStroke(layer, "line-width");
    }
  }

  for (const [style, level] of STYLES) {
    assert.equal(style.layers.some((layer) => layer.id === `dm-2206-line-${level}-line`), false);
    assert.equal(style.layers.some((layer) => layer.id === `dm-2206-line-${level}-decoration`), false);
  }
});

test("code 2227 uses PDF-derived pen widths for dashed lines", () => {

  for (const [style, level] of [[STYLE_500, 500], [STYLE_1000, 1000]]) {

    const id = `dm-2227-line-${level}-line`;
    const layer = byId(style, id);
    assert.equal(layer.type, "line", id);
    assert.equal(layer["source-layer"], "dm_2227_line", id);
    assert.equal(layer.paint["line-color"], "#000000", id);
    assert.deepEqual(layer.filter, [
      "==",
      ["get", "LEVEL"],
      level,
    ]);
    assertStroke(layer, "line-width");
    assertDashLengths(layer);
  }

  for (const [style, level] of STYLES) {
    assert.equal(style.layers.some((layer) => layer.id === `dm-2227-line-${level}-line`), false);
  }
});

test("code 2305 base and perpendicular ticks uses PDF-derived pen widths for lines", () => {

  for (const [style, level] of ALL_STYLES) {

    const id = `dm-2305-line-${level}-line`;
    const layer = byId(style, id);
    assert.equal(layer.type, "line", id);
    assert.equal(layer["source-layer"], "dm_2305_line", id);
    assert.equal(layer.paint["line-color"], "#000000", id);
    assert.equal(layer.paint["line-dasharray"], undefined, id);
    assertStroke(layer, "line-width");
  }

  for (const [style, level] of STYLES) {

    const id = `dm-2305-line-${level}-decoration`;
    const layer = byId(style, id);
    assert.equal(layer.type, "line", id);
    assert.equal(layer["source-layer"], "dm_2305_line_deco_line", id);
    assert.equal(layer.paint["line-color"], "#000000", id);
    assert.equal(layer.paint["line-dasharray"], undefined, id);
    assert.deepEqual(layer.filter, [
      "==",
      ["get", "LEVEL"],
      level,
    ]);
    assertStroke(layer, "line-width");
  }

  for (const [style, level] of LOW_LEVEL_STYLES) {
    assert.equal(style.layers.some((layer) => layer.id === `dm-2305-line-${level}-decoration`), true);
  }
});

test("code 2306 is zero point one five millimeter at levels 500 and 1000 and zero point one millimeter at levels 2500 and 5000", () => {

  for (const [style, level] of ALL_STYLES) {

    const id = `dm-2306-line-${level}-line`;
    const layer = byId(style, id);
    assert.equal(layer.type, "line", id);
    assert.equal(layer["source-layer"], "dm_2306_line", id);
    assertStrokeMinzoom(layer);
    assert.equal(layer.paint["line-color"], "#000000", id);
    assert.equal(layer.paint["line-dasharray"], undefined, id);
    assertStroke(layer, "line-width");
  }

  for (const [style, level] of STYLES) {

    const id = `dm-2306-line-${level}-decoration`;
    const layer = byId(style, id);
    assert.equal(layer.type, "line", id);
    assert.equal(layer["source-layer"], "dm_2306_line_deco_line", id);
    assertStrokeMinzoom(layer);
    assert.equal(layer.paint["line-color"], "#000000", id);
    assert.equal(layer.paint["line-dasharray"], undefined, id);
    assert.deepEqual(layer.filter, [
      "==",
      ["get", "LEVEL"],
      level,
    ]);
    assertStroke(layer, "line-width");
  }

  for (const [style, level] of LOW_LEVEL_STYLES) {
    assert.equal(style.layers.some((layer) => layer.id === `dm-2306-line-${level}-decoration`), true);
  }
});

test("code 2309 is zero point one five millimeter at levels 500 and 1000 and zero point one millimeter at levels 2500 and 5000", () => {

  const dasharrays = new Map([
    [500, [10, 10]],
    [1000, [10, 10]],
    [2500, [15, 15]],
    [5000, [15, 15]],
  ]);
  for (const [style, level] of ALL_STYLES) {

    const id = `dm-2309-line-${level}-line`;
    const layer = byId(style, id);
    assert.equal(layer.type, "line", id);
    assert.equal(layer["source-layer"], "dm_2309_line", id);
    assertStrokeMinzoom(layer);
    assert.equal(layer.paint["line-color"], "#000000", id);
    assert.deepEqual(layer.paint["line-dasharray"], dasharrays.get(level), id);
    assertStroke(layer, "line-width");
  }
});

test("code 2401 is zero point three millimeter at level 5000", () => {
  const layer = byId(STYLE_5000, "dm-2401-line-5000-line");
  assertStrokeMinzoom(layer);
  assertStroke(layer, "line-width");
});

test("codes 4261 and 4262 use PDF-derived pen widths for outlines", () => {

  for (const [style, level] of STYLES) {

    for (const code of [4261, 4262]) {
      const line = byId(style, `dm-${code}-line-${level}-line`);
      const polygon = byId(style, `dm-${code}-polygon-${level}-line`);
      for (const [layer, sourceLayer] of [[line, `dm_${code}_line`], [polygon, `dm_${code}_polygon`]]) {
        assert.equal(layer.type, "line");
        assert.equal(layer["source-layer"], sourceLayer);
        assertStrokeMinzoom(layer);
        assert.equal(layer.paint["line-color"], "#000000");
        assert.equal(layer.paint["line-dasharray"], undefined);
        assertStroke(layer, "line-width");
      }
      assert.deepEqual(polygon.filter, line.filter);
    }
  }
});

test("codes 4265, 6101, and 6102 use PDF-derived pen widths for lines", () => {
  const cases = [
    [STYLE_2500, 2500, 15, 0.1293685, 66.236673],
    [STYLE_5000, 5000, 14, 0.1293685, 132.473346],
  ];
  for (const [style, level, minzoom, widthAtMinzoom, width24] of cases) {
    for (const code of [4265, 6101, 6102]) {
      const id = `dm-${code}-line-${level}-line`;
      const layer = byId(style, id);
      assert.equal(layer.type, "line", id);
      assert.equal(layer["source-layer"], `dm_${code}_line`, id);
      assertStrokeMinzoom(layer);
      if (code === 6101) {
        assert.deepEqual(layer.filter, ["all", ["==", ["get", "LEVEL"], level], ["!=", ["get", "DMFIGTYPE"], 12]], id);
      }
      assert.equal(layer.paint["line-dasharray"], undefined, id);
      assertStroke(layer, "line-width");
    }
  }
});

test("code 6110 line uses PDF-derived pen widths for lines", () => {
  const cases = [
    [STYLE_2500, 2500, 14, 0.12936746667, 132.47228587008, 15, 0.1293685, 66.236673],
    [STYLE_5000, 5000, 14, 0.25873493334, 264.94457174016, 14, 0.1293685, 132.473346],
  ];
  for (const [style, level, baseMinzoom, baseWidthAtMinzoom, baseWidth24, fig12Minzoom, fig12WidthAtMinzoom, fig12Width24] of cases) {
    const base = byId(style, `dm-6110-line-${level}-line`);
    assert.equal(base.type, "line");
    assert.equal(base["source-layer"], "dm_6110_line");
    assertStrokeMinzoom(base);
    assert.deepEqual(base.filter, ["all", ["==", ["get", "LEVEL"], level], ["!=", ["get", "DMFIGTYPE"], 12]]);
    assertStroke(base, "line-width");

    const fig12 = byId(style, `dm-6110-line-${level}-line-figtype-12`);
    assert.equal(fig12.type, "line");
    assert.equal(fig12["source-layer"], "dm_6110_line");
    assertStrokeMinzoom(fig12);
    assert.deepEqual(fig12.filter, ["all", ["==", ["get", "LEVEL"], level], ["==", ["get", "DMFIGTYPE"], 12]]);
    assertStroke(fig12, "line-width");
  }
});

test("code 6102 perpendicular tick decorations uses PDF-derived pen widths for lines", () => {
  const cases = [
    [STYLE_2500, 2500, 15, 0.1293685, 66.236673],
    [STYLE_5000, 5000, 14, 0.1293685, 132.473346],
  ];
  for (const [style, level, minzoom, widthAtMinzoom, width24] of cases) {
    const id = `dm-6102-line-${level}-decoration`;
    const layer = byId(style, id);
    assert.equal(layer.type, "line", id);
    assert.equal(layer["source-layer"], "dm_6102_line_deco_line", id);
    assertStrokeMinzoom(layer);
    assert.equal(layer.paint["line-color"], "#000000", id);
    assert.equal(layer.paint["line-dasharray"], undefined, id);
    assert.deepEqual(layer.filter, ["==", ["get", "LEVEL"], level], id);
    assertStroke(layer, "line-width");
  }
});

test("code 6110 right-side semicircle decorations are zero point two millimeter solid lines", () => {
  const cases = [
    [STYLE_2500, 2500, 14, 0.12936746667, 132.47228587008],
    [STYLE_5000, 5000, 14, 0.25873493334, 264.94457174016],
  ];
  for (const [style, level, minzoom, widthAtMinzoom, width24] of cases) {
    const id = `dm-6110-line-${level}-decoration`;
    const layer = byId(style, id);
    assert.equal(layer.type, "line", id);
    assert.equal(layer["source-layer"], "dm_6110_line_deco_polygon", id);
    assertStrokeMinzoom(layer);
    assert.equal(layer.paint["line-color"], "#000000", id);
    assert.equal(layer.paint["line-dasharray"], undefined, id);
    assert.deepEqual(layer.filter, ["==", ["get", "LEVEL"], level], id);
    assertStroke(layer, "line-width");
  }
});

test("code 4265 displays generated 0.3 mm circles at 20 mm native and 10 mm coarse intervals",()=>{
 for(const [style,level] of ALL_STYLES){
  const layer=byId(style,`dm-4265-line-${level}-power_line_circle`);
  assert.equal(layer.type,"circle");assert.equal(layer["source-layer"],"dm_4265_line_deco_point");
  assert.equal(layer.metadata["dm:interval-mm"],level<=1000?20:10);
  const zoom=getZoomByScale(level,36);const r=evaluate(layer.paint["circle-radius"],{},zoom)/MM_TO_PX;const w=evaluate(layer.paint["circle-stroke-width"],{},zoom)/MM_TO_PX;
  assert.ok(Math.abs(2*(r+w)-.3)<1e-8);
 }
});

test("codes 5101 and 5102 use PDF-derived pen widths for lines", () => {

  for (const [style, level] of ALL_STYLES) {

    for (const code of [5101, 5102]) {
      const layer = byId(style, `dm-${code}-line-${level}-line`);
      assert.equal(layer.type, "line");
      assert.equal(layer["source-layer"], `dm_${code}_line`);
      assertStrokeMinzoom(layer);
      assert.equal(layer.paint["line-color"], "#000000");
      assert.equal(layer.paint["line-dasharray"], undefined);
      assertStroke(layer, "line-width");
    }
  }
});

test("codes 5103 through 5199 use PDF-derived pen widths for dashed lines", () => {

  for (const [style, level] of STYLES) {

    for (let code = 5103; code <= 5199; code += 1) {
      const layer = byId(style, `dm-${code}-line-${level}-line`);
      assert.equal(layer.type, "line");
      assert.equal(layer["source-layer"], `dm_${code}_line`);
      assertStrokeMinzoom(layer);
      assert.equal(layer.paint["line-color"], "#000000");
      assertDashLengths(layer);
      assertStroke(layer, "line-width");
    }
  }
});

test("code 5203 uses PDF-derived pen widths for lines", () => {

  for (const [style, level] of ALL_STYLES) {

    const layer = byId(style, `dm-5203-line-${level}-line`);
    assert.equal(layer.type, "line");
    assert.equal(layer["source-layer"], "dm_5203_line");
    assertStrokeMinzoom(layer);
    assert.equal(layer.paint["line-color"], "#000000");
    assert.equal(layer.paint["line-dasharray"], undefined);
    assertStroke(layer, "line-width");
  }
});

test("codes 5226, 5227, 5228, and 5231 use PDF-derived pen widths for lines", () => {

  const lineId = (code, level) => [5226, 5227, 5228].includes(code)
    ? `dm-${code}-line-${level}-line-line`
    : `dm-${code}-line-${level}-line`;
  for (const [style, level] of ALL_STYLES) {

    for (const code of [5226, 5227, 5228, 5231]) {
      const layer = byId(style, lineId(code, level));
      assert.equal(layer.type, "line");
      assert.equal(layer["source-layer"], `dm_${code}_line`);
      assertStrokeMinzoom(layer);
      assert.equal(layer.paint["line-color"], "#000000");
      assert.equal(layer.paint["line-dasharray"], undefined);
      assertStroke(layer, "line-width");
    }
  }
});

test("code 5239 uses PDF-derived pen widths for outlines", () => {

  for (const [style, level] of ALL_STYLES) {

    const line = byId(style, `dm-5239-line-${level}-line`);
    const polygon = byId(style, `dm-5239-polygon-${level}-line`);
    for (const [layer, sourceLayer] of [[line, "dm_5239_line"], [polygon, "dm_5239_polygon"]]) {
      assert.equal(layer.type, "line");
      assert.equal(layer["source-layer"], sourceLayer);
      assertStrokeMinzoom(layer);
      assert.equal(layer.paint["line-color"], "#000000");
      assert.equal(layer.paint["line-dasharray"], undefined);
      assertStroke(layer, "line-width");
    }
    assert.deepEqual(polygon.filter, line.filter);
  }
});

test("code 7101 uses PDF-derived pen widths for lines", () => {

  for (const [style, level] of ALL_STYLES) {

    const id = `dm-7101-line-${level}-line`;
    const layer = byId(style, id);
    assert.equal(layer.type, "line", id);
    assert.equal(layer["source-layer"], "dm_7101_line", id);
    assert.equal(layer.paint["line-color"], "#000000", id);
    assertStrokeMinzoom(layer);
    assert.equal(layer.paint["line-dasharray"], undefined, id);
    assertStroke(layer, "line-width");
  }
});

test("codes 7102 and 7103 use PDF-derived pen widths for lines", () => {

  for (const [style, level] of ALL_STYLES) {

    for (const code of [7102, 7103]) {
      const id = `dm-${code}-line-${level}-line`;
      const layer = byId(style, id);
      assert.equal(layer.type, "line", id);
      assert.equal(layer["source-layer"], `dm_${code}_line`, id);
      assert.equal(layer.paint["line-color"], "#000000", id);
      assertStrokeMinzoom(layer);
      assert.deepEqual(layer.paint["line-dasharray"], code === 7103 ? [100, 5] : undefined, id);
      assertStroke(layer, "line-width");
    }
  }
});

test("code 7105 uses PDF-derived pen widths for lines", () => {

  const dashes = new Map([
    [500, undefined],
    [1000, undefined],
    [2500, undefined],
    [5000, undefined],
  ]);
  for (const [style, level] of ALL_STYLES) {

    const id = `dm-7105-line-${level}-line`;
    const layer = byId(style, id);
    assert.equal(layer.type, "line", id);
    assert.equal(layer["source-layer"], "dm_7105_line", id);
    assert.equal(layer.paint["line-color"], "#000000", id);
    assertStrokeMinzoom(layer);
    assert.deepEqual(layer.paint["line-dasharray"], dashes.get(level), id);
    assertStroke(layer, "line-width");
  }
});

test("codes 7105, 7106, and 7107 render right ticks with PDF-derived pen widths", () => {

  for (const [style, level] of ALL_STYLES) {

    for (const code of [7105, 7106, 7107]) {
      const line = byId(style, `dm-${code}-line-${level}-line`);
      const id = `dm-${code}-line-${level}-decoration`;
      const layer = byId(style, id);
      assert.equal(layer.type, "line", id);
      assert.equal(layer["source-layer"], `dm_${code}_line_deco_line`, id);
      assert.equal(layer.paint["line-color"], "#000000", id);
      assertStrokeMinzoom(layer);
      assert.equal(layer.paint["line-dasharray"], undefined, id);
      assertStroke(layer, "line-width");
    }
  }
});

test("codes 7106, 7107, 7199, 7201, 7202, 7211, and 7213 use PDF-derived pen widths for lines", () => {

  const dashes = new Map([
    [7106, undefined],
    [7107, [100, 5]],
  ]);
  for (const [style, level] of ALL_STYLES) {

    for (const code of [7106, 7107, 7199, 7201, 7202, 7211, 7213]) {
      const id = `dm-${code}-line-${level}-line`;
      const layer = byId(style, id);
      const dashSpec = dashes.get(code);
      const expectedDash = dashSpec instanceof Map ? dashSpec.get(level) : dashSpec;
      assert.equal(layer.type, "line", id);
      assert.equal(layer["source-layer"], `dm_${code}_line`, id);
      assert.equal(layer.paint["line-color"], "#000000", id);
      assertStrokeMinzoom(layer);
      if (code === 7211) {
        assert.deepEqual(layer.filter, ["all", ["==", ["get", "LEVEL"], level], ["!=", ["get", "DMFIGTYPE"], 12]], id);
      }
      assert.deepEqual(layer.paint["line-dasharray"], expectedDash, id);
      assertStroke(layer, "line-width");
    }
  }
});

for (const code of [7212, 7214]) {
  test(`code ${code} uses right-side arc symbol decorations instead of the base line`, () => {

    for (const [style, level] of ALL_STYLES) {
      if (code === 7214 && ![2500, 5000].includes(level)) {
        assert.equal(byId(style, `dm-7214-line-${level}-line`).paint["line-opacity"], 0);
        const decoration = byId(style, `dm-7214-line-${level}-arc-symbols`);
        assert.equal(decoration["source-layer"], "dm_7214_line_deco_line");
        assertStroke(decoration, "line-width");
        continue;
      }

      const base = byId(style, `dm-${code}-line-${level}-line`);
      assert.equal(base.type, "line");
      assert.equal(base["source-layer"], `dm_${code}_line`);
      if (code === 7212) assert.equal(base.layout.visibility, "none");
      else {
        assert.equal(base.layout?.visibility ?? "visible", "visible");
        assert.deepEqual(base.filter, ["all", ["==", ["get", "LEVEL"], level], ["!", ["in", ["get", "LEVEL"], ["literal", [2500, 5000]]]]]);
      }

      const decoration = byId(style, `dm-${code}-line-${level}-arc-symbols`);
      assert.equal(decoration.type, "line");
      assert.equal(decoration["source-layer"], `dm_${code}_line_deco_line`);
      assert.deepEqual(decoration.filter, code === 7212 ? ["==", ["get", "LEVEL"], level] : ["all", ["==", ["get", "LEVEL"], level], ["in", ["get", "LEVEL"], ["literal", [2500, 5000]]]]);
      assert.equal(decoration.paint["line-color"], "#000000");
      assert.equal(decoration.paint["line-dasharray"], undefined);
      assertStrokeMinzoom(decoration);
      assertStroke(decoration, "line-width");
    }
  });
}

test("code 7211 uses PDF-derived pen widths for dashed lines", () => {

  for (const [style, level] of ALL_STYLES) {

    const id = `dm-7211-line-${level}-line-figtype-12`;
    const layer = byId(style, id);
    assert.equal(layer.type, "line", id);
    assert.equal(layer["source-layer"], "dm_7211_line", id);
    assert.equal(layer.paint["line-color"], "#000000", id);
    assertStrokeMinzoom(layer);
    assert.deepEqual(layer.filter, ["all", ["==", ["get", "LEVEL"], level], ["==", ["get", "DMFIGTYPE"], 12]], id);
    assertDashLengths(layer);
    assertStroke(layer, "line-width");
  }
});

test("code 7199 does not render a point symbol", () => {
  for (const [style, level] of ALL_STYLES) {
    const id = `dm-7199-point-${level}-symbol`;
    assert.equal(style.layers.some((layer) => layer.id === id), false, id);
  }
});

test("code 1106 repeats five millimeter dashes with one millimeter gaps", () => {
  for (const [style, level] of STYLES) {
    const id = `dm-1106-line-${level}-line`;
    const layer = byId(style, id);
    assert.equal(layer.type, "line", id);
    assert.equal(layer["source-layer"], "dm_1106_line", id);
    assertDashLengths(layer);
  }
});

test("codes 1106 and 1107 use PDF-derived pen widths for lines", () => {

  for (const [style, level] of ALL_STYLES) {

    for (const code of [1106, 1107]) {
      const layer = byId(style, `dm-${code}-line-${level}-line`);
      assertStroke(layer, "line-width");
    }
  }
});

test("code 1101 hides the base dash line and renders the exact pattern as decorations", () => {

  for (const [style, level] of ALL_STYLES) {

    const base = byId(style, `dm-1101-line-${level}-line`);
    assert.equal(base.type, "line");
    assert.equal(base["source-layer"], "dm_1101_line");
    assert.equal(base.layout.visibility, "none");
    assertDashLengths(base);

    const decoration = byId(style, `dm-1101-line-${level}-decoration`);
    assert.equal(decoration.type, "line");
    assert.equal(decoration["source-layer"], "dm_1101_line_deco_line");
    assert.equal(decoration.paint["line-dasharray"], undefined);
    assert.deepEqual(decoration.filter, [
      "==",
      ["get", "LEVEL"],
      level,
    ]);
    assertStroke(decoration, "line-width");
  }
});

test("codes 1101 through 1104 and 1110 use PDF-derived pen widths for lines", () => {

  for (const [style, level] of ALL_STYLES) {

    for (const code of [1101, 1102, 1103, 1104, 1110]) {
      const layer = byId(style, `dm-${code}-line-${level}-line`);
      assertStroke(layer, "line-width");
    }
  }
});

const assertUnfilledCircle = (prefix, cases) => {
  for (const [style, level, radius15, radius24, stroke15, stroke24] of cases) {
    const id = `${prefix}-point-${level}-symbol`;
    const layer = byId(style, id);
    assert.equal(layer.type, "circle");
    assert.equal(layer.paint["circle-color"], "rgba(0, 0, 0, 0)");
    assert.equal(layer.paint["circle-stroke-color"], "#000000");

    const radius = layer.paint["circle-radius"];
    assert.deepEqual(radius.slice(0, 4), ["interpolate", ["exponential", 2], ["zoom"], 15]);
    assertApprox(radius[4], radius15, id);
    assert.equal(radius[5], 24);
    assertApprox(radius[6], radius24, id);

    assertStroke(layer, "circle-stroke-width");
  }
};

test("line layers remain visible one zoom below five hundredths of a millimeter", () => {
  for (const [style] of ALL_STYLES) for (const layer of style.layers.filter(layer => layer.type === "line")) assertStrokeMinzoom(layer);
});

test("flow direction symbol is a five millimeter rotated arrow", () => {
  assert.deepEqual(SPRITE["dm-5241"], {width: 40, height: 8, x: 0, y: 300, pixelRatio: 1});
  const cases = [
    [STYLE_2500, 2500, 0.1617093333375, 82.7951786688],
    [STYLE_5000, 5000, 0.323418666675, 165.5903573376],
  ];
  for (const [style, level, atZoom15, atZoom24] of cases) {
    const layer = byId(style, `dm-5241-point-${level}-symbol`);
    assert.equal(layer.type, "symbol");
    assert.equal((layer.metadata?.["dm:icon-base"] ?? layer.layout["icon-image"]), "dm-5241");
    assert.deepEqual(layer.layout["icon-rotate"], ["-", ["coalesce", ["get", "ROTATION"], 0], 90]);
    assert.equal(layer.layout["icon-rotation-alignment"], "map");
    assert.equal(layer.layout["icon-pitch-alignment"], "map");
    assert.deepEqual(layer.layout["icon-size"], [
      "interpolate",
      ["exponential", 2],
      ["zoom"],
      15,
      atZoom15,
      24,
      atZoom24,
    ]);
  }
});

test("code 5228 is a rotating one point five millimeter symbol", () => {
  assert.deepEqual(SPRITE["dm-5228"], {width: 48, height: 16, x: 40, y: 296, pixelRatio: 1});
  const cases = [
    [STYLE_2500, 2500, 0.040427333334375, 20.6987946672],
    [STYLE_5000, 5000, 0.08085466666875, 41.3975893344],
  ];
  for (const [style, level, atZoom15, atZoom24] of cases) {
    const layer = byId(style, `dm-5228-point-${level}-symbol-point`);
    assert.equal(layer.type, "symbol");
    assert.equal((layer.metadata?.["dm:icon-base"] ?? layer.layout["icon-image"]), "dm-5228");
    assert.deepEqual(layer.layout["icon-rotate"], ["coalesce", ["get", "ROTATION"], 0]);
    assert.equal(layer.layout["icon-rotation-alignment"], "map");
    assert.equal(layer.layout["icon-pitch-alignment"], "map");
    assert.deepEqual(layer.layout["icon-size"], [
      "interpolate",
      ["exponential", 2],
      ["zoom"],
      15,
      atZoom15,
      24,
      atZoom24,
    ]);
  }
});

function assertStroke(layer, property = "line-width") {
  const pen = layer.metadata["dm:pen-number"]; const level = layer.metadata["dm:pen-level"];
  assert.ok(pen !== undefined && level, layer.id);
  for (const DMFIGTYPE of [11, 12, 21, 22, 23]) {
    const DMCODE = Number(layer["source-layer"].split("_")[1]) || 2102;
    const props = {DMFIGTYPE, DMCODE};
    const mm = evaluate(layer.paint[property], props, getZoomByScale(level, 36)) / MM_TO_PX;
    assert.ok(Math.abs(mm - evaluate(pen, props) * 0.05) < 1e-8, `${layer.id}: ${mm}`);
  }
}
function assertDashLengths(layer) {
  const mm = layer.metadata["dm:dash-mm"]; assert.ok(mm, layer.id);
  const pen = evaluate(layer.metadata["dm:pen-number"], {DMFIGTYPE: 11});
  layer.paint["line-dasharray"].forEach((dash, index) => assert.ok(Math.abs(dash * pen * 0.05 - mm[index]) < 1e-6, layer.id));
}
function assertStrokeMinzoom(layer) {
  if (layer.type !== "line") { assert.equal(layer.minzoom, 14, layer.id); return; }
  assert.equal(layer.paint["line-width"][3], layer.minzoom, layer.id);
  assert.ok(layer.minzoom >= 14, layer.id);
  const widths = [11, 12, 21, 22, 23].map(DMFIGTYPE => evaluate(layer.paint["line-width"], {
    DMFIGTYPE, DMCODE: Number(layer["source-layer"].split("_")[1]) || 7102,
  }, layer.minzoom));
  assert.ok(Math.min(...widths) * 2 >= 0.05 * MM_TO_PX - 1e-8, layer.id);
  if (typeof layer.metadata["dm:pen-number"] === "number" && layer.minzoom > 14) assert.ok(widths[0] < 0.05 * MM_TO_PX, layer.id);
}

test("2106 at levels 250 and 500 repeats 2 mm strokes with 1 mm gaps", () => {
  for (const level of [250, 500]) {
    const layer = byId(readJson(`style-${level}.json`), `dm-2106-line-${level}-line`);
    const zoom = getZoomByScale(level, 36);
    const widthMm = evaluate(layer.paint["line-width"], {}, zoom) / MM_TO_PX;
    assert.ok(Math.abs(widthMm - 0.15) < 1e-8);
    assert.deepEqual(layer.metadata["dm:dash-mm"], [2, 1]);
    for (const [index, expected] of [2, 1].entries()) {
      assert.ok(Math.abs(layer.paint["line-dasharray"][index] * widthMm - expected) < 1e-6);
    }
  }
});

test("2204 has styles at 500 and 1000 plus inherited level 250", () => {
  for (const level of [250, 500, 1000]) {
    const style = readJson(`style-${level}.json`);
    for (const suffix of ["line", "decoration"]) assert.equal(byId(style, `dm-2204-line-${level}-${suffix}`).metadata["dm:pen-number"], 3);
  }
  for (const level of [2500, 5000]) assert.equal(readJson(`style-${level}.json`).layers.some(layer => /^dm_2204_/.test(layer["source-layer"] ?? "")), false);
});

test("2213 at 500 and 1000 is solid, with level 250 inheriting 500", () => {
  for (const level of [250, 500, 1000]) {
    const layer = byId(readJson(`style-${level}.json`), `dm-2213-line-${level}-line`);
    assert.equal(layer.paint["line-dasharray"], undefined);
    assert.equal(layer.metadata["dm:dash-mm"], undefined);
    assert.equal(layer.metadata["dm:pen-number"], 3);
  }
  for (const level of [2500, 5000]) assert.ok(byId(readJson(`style-${level}.json`), `dm-2213-line-${level}-line`).paint["line-dasharray"]);
});

test("2221 bus stop has a correctly anchored 3-pen icon at 500 and 1000 plus inherited 250", () => {
  for (const level of [250, 500, 1000]) {
    const layer = byId(readJson(`style-${level}.json`), `dm-2221-point-${level}-symbol-point`);
    assert.equal(layer.type, "symbol");
    assert.equal(layer.metadata["dm:icon-base"], "dm-2221");
    assert.equal(layer.metadata["dm:icon-pen"], 3);
    assert.deepEqual(layer.layout["icon-offset"], [0, 10]);
    assert.equal(layer.layout["icon-rotate"], 0);
    const scale = evaluate(layer.layout["icon-size"], {}, getZoomByScale(level, 36));
    assert.ok(Math.abs(32 * scale / MM_TO_PX - 4) < 1e-8);
    assert.ok(SPRITE[layer.layout["icon-image"]]);
  }
});

test("2237 repeats 4 mm strokes and 1 mm gaps at 500/1000 and inherited 250", () => {
  for (const level of [250, 500, 1000]) {
    const layer = byId(readJson(`style-${level}.json`), `dm-2237-line-${level}-line`);
    const widthMm = evaluate(layer.paint["line-width"], {}, getZoomByScale(level, 36)) / MM_TO_PX;
    assert.deepEqual(layer.metadata["dm:dash-mm"], [4, 1]);
    for (const [index, expected] of [4, 1].entries()) {
      assert.ok(Math.abs(layer.paint["line-dasharray"][index] * widthMm - expected) < 1e-6);
    }
  }
});

test("2235 and 2236 render unfilled polygon boundaries with pen 3 at 500/1000 and inherited 250", () => {
  for (const level of [250, 500, 1000]) for (const code of [2235, 2236]) {
    const style = readJson(`style-${level}.json`);
    const layer = byId(style, `dm-${code}-polygon-${level}-line`);
    assert.equal(layer["source-layer"], `dm_${code}_polygon`);
    assert.equal(layer.type, "line");
    assert.equal(layer.metadata["dm:pen-origin"], "spec");
    assert.equal(layer.paint["line-dasharray"], undefined);
    const mm = evaluate(layer.paint["line-width"], {}, getZoomByScale(level, 36)) / MM_TO_PX;
    assert.ok(Math.abs(mm - 0.15) < 1e-8);
    assert.equal(style.layers.some(item => item["source-layer"] === `dm_${code}_polygon` && item.type === "fill"), false);
  }
});

test("7211 uses literal rock text and native 7213 uses the three-lobed point", () => {
  for (const [style, level] of ALL_STYLES) {
    const rock = byId(style, `dm-7211-point-${level}-symbol`);
    assert.equal(rock.layout["text-field"], "(岩)");
    assert.equal(rock.layout["icon-image"], undefined);
    const depression = byId(style, `dm-7213-point-${level}-symbol`);
    if (level <= 1000) {
      assert.equal(depression.layout["icon-rotate"], 0);
      assert.ok(depression.metadata["dm:icon-native-size"].width > 2.5);
    }
    assert.ok(SPRITE[depression.layout["icon-image"]]);
  }
});
