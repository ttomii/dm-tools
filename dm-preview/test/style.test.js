import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {annotationTextField, verticalLongSoundAnnotationTextField} from "../src/core/style-editing.js";

// These tests pin the fixed MapLibre Style documents shipped in maplibre/ to the
// DM rendering specification. They were ported from the Rust crate when style
// generation moved to this Node package; the numeric expectations are the spec.
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
        typeof layer["source-layer"] === "string" &&
        layer["source-layer"].endsWith("_text") &&
        layer.layout?.["text-field"] != null,
    ).length;
    assert.equal(labels, 70);
  }
});

test("fixed styles include default line and polygon fallback layers", () => {
  const cases = [
    [STYLE_2500, 2500, 0.0970256000025, 99.35421440256],
    [STYLE_5000, 5000, 0.194051200005, 198.70842880512],
  ];
  for (const [style, level, width14, width24] of cases) {
    for (const [kind, sourceLayer, suffix] of [
      ["line", "dm_default_line", "line"],
      ["polygon", "dm_default_polygon", "outline"],
    ]) {
      const id = `dm-default-${kind}-${level}-${suffix}`;
      const layer = byId(style, id);
      assert.equal(layer.source, "dm", id);
      assert.equal(layer["source-layer"], sourceLayer, id);
      assert.equal(layer.type, "line", id);
      assert.equal(layer.minzoom, MIN_ZOOM, id);
      assert.deepEqual(layer.filter.slice(0, 2), ["all", ["==", ["get", "LEVEL"], level]], id);
      assert.equal(layer.paint["line-color"], "#000000", id);
      assert.deepEqual(layer.paint["line-width"], [
        "interpolate",
        ["exponential", 2],
        ["zoom"],
        14,
        width14,
        24,
        width24,
      ]);
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
    assert.equal(layer.minzoom, MIN_ZOOM, id);
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

test("removed BMP symbols are no longer fixed point styles", () => {
  const removed = [3508, 3512, 3513, 3518, 3527, 3528, 3529, 3539, 4232, 6341];
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
      assert.deepEqual(polygon.minzoom, line.minzoom);
      assert.deepEqual(polygon.paint, line.paint);
    }
  }
});

test("fixed styles split horizontal and vertical annotations", () => {
  for (const [style, level] of STYLES) {
    for (const [dmcode] of ANNOTATION_SIZES) {
      const horizontalId = `dm-${dmcode}-text-${level}-label`;
      const horizontal = byId(style, horizontalId);
      const vertical = byId(style, `${horizontalId}-vertical`);
      assert.deepEqual(horizontal.filter, [
        "all",
        ["==", ["get", "LEVEL"], level],
        ["!=", ["coalesce", ["get", "VERTICAL"], 0], 1],
      ]);
      assert.deepEqual(vertical.filter, [
        "all",
        ["==", ["get", "LEVEL"], level],
        ["==", ["get", "VERTICAL"], 1],
      ]);
      assert.deepEqual(vertical.layout["text-writing-mode"], ["vertical"]);
      assert.deepEqual(vertical.layout["text-rotate"], [
        "-",
        ["coalesce", ["get", "ROTATION"], 90],
        90,
      ]);
      assert.deepEqual(horizontal.layout["text-field"], annotationTextField(), horizontalId);
      assert.deepEqual(vertical.layout["text-field"], verticalLongSoundAnnotationTextField(), `${horizontalId}-vertical`);
    }
  }
});

test("fixed styles anchor annotations to the right of the point", () => {
  for (const [style, level] of STYLES) {
    for (const [dmcode] of ANNOTATION_SIZES) {
      const horizontalId = `dm-${dmcode}-text-${level}-label`;
      assert.equal(byId(style, horizontalId).layout["text-anchor"], "left", horizontalId);
      assert.equal(byId(style, `${horizontalId}-vertical`).layout["text-anchor"], "left", `${horizontalId}-vertical`);
    }
  }
});

test("fixed styles always show annotations regardless of overlap", () => {
  for (const [style, level] of STYLES) {
    for (const [dmcode] of ANNOTATION_SIZES) {
      const horizontalId = `dm-${dmcode}-text-${level}-label`;
      assert.equal(byId(style, horizontalId).layout["text-allow-overlap"], true, horizontalId);
      assert.equal(byId(style, `${horizontalId}-vertical`).layout["text-allow-overlap"], true, `${horizontalId}-vertical`);
    }
  }
});

test("fixed styles use annotation sizes in millimeters", () => {
  for (const [style, level] of STYLES) {
    const scale = level / 2500;
    for (const [dmcode, sizeMm] of ANNOTATION_SIZES) {
      const id = `dm-${dmcode}-text-${level}-label`;
      const textSize = byId(style, id).layout["text-size"];
      assert.equal(textSize[0], "interpolate", id);
      assert.deepEqual(textSize[1], ["exponential", 2]);
      assert.deepEqual(textSize[2], ["zoom"]);
      assert.equal(textSize[3], 15, id);
      assertApprox(textSize[4], sizeMm * 1.2936746667 * scale, id);
      assert.equal(textSize[5], 24, id);
      assertApprox(textSize[6], sizeMm * 662.3614293504 * scale, id);
    }
  }
});

test("fixed styles use annotation character spacing in tenths of millimeters", () => {
  for (const [style, level] of STYLES) {
    for (const [dmcode, sizeMm] of ANNOTATION_SIZES) {
      const id = `dm-${dmcode}-text-${level}-label`;
      const expected = [
        "*",
        ["coalesce", ["get", "CHARSPACING"], 0],
        0.1 / sizeMm,
      ];
      assert.deepEqual(byId(style, id).layout["text-letter-spacing"], expected, id);
      assert.deepEqual(byId(style, `${id}-vertical`).layout["text-letter-spacing"], expected, `${id}-vertical`);
    }
  }
});

test("fixed styles keep long annotations on one line", () => {
  for (const [style, level] of STYLES) {
    for (const [dmcode] of ANNOTATION_SIZES) {
      const id = `dm-${dmcode}-text-${level}-label`;
      assert.equal(byId(style, id).layout["text-max-width"], 100, id);
      assert.equal(byId(style, `${id}-vertical`).layout["text-max-width"], 100, `${id}-vertical`);
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
      assert.equal(layer.layout["icon-image"], "dm-4219", id);
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
    assert.equal(layer.layout["icon-image"], "dm-3401", id);
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

test("code 6110 point is an unfilled three tenths millimeter diameter circle with a zero point one millimeter stroke", () => {
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

test("code 7312 is an unfilled three tenths millimeter diameter circle with a zero point two millimeter stroke", () => {
  const cases = [
    [STYLE_2500, 2500, 0.0970256000025, 49.67710720128, 0.25873493334, 132.47228587008],
    [STYLE_5000, 5000, 0.194051200005, 99.35421440256, 0.51746986668, 264.94457174016],
  ];
  assertUnfilledCircle("dm-7312", cases);
});

test("code 8199 is an unfilled three tenths millimeter diameter circle with a zero point two millimeter stroke", () => {
  const cases = [
    [STYLE_2500, 2500, 0.0970256000025, 49.67710720128, 0.25873493334, 132.47228587008],
    [STYLE_5000, 5000, 0.194051200005, 99.35421440256, 0.51746986668, 264.94457174016],
  ];
  assertUnfilledCircle("dm-8199", cases);
});

test("code 4231 is a white two millimeter circle with a zero point one five millimeter stroke", () => {
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

    const stroke = layer.paint["circle-stroke-width"];
    assert.deepEqual(stroke.slice(0, 4), ["interpolate", ["exponential", 2], ["zoom"], 15]);
    assertApprox(stroke[4], stroke15, id);
    assert.equal(stroke[5], 24);
    assertApprox(stroke[6], stroke24, id);
  }
});

test("code 5232 point is a white half millimeter diameter circle with a zero point two millimeter stroke", () => {
  const cases = [
    [STYLE_500, 500, 0.0323418666675, 33.11807146752, 0.025873493334, 13.247228587008],
    [STYLE_1000, 1000, 0.064683733335, 66.23614293504, 0.051746986668, 26.494457174016],
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

    const stroke = layer.paint["circle-stroke-width"];
    assert.deepEqual(stroke.slice(0, 4), ["interpolate", ["exponential", 2], ["zoom"], 15]);
    assertApprox(stroke[4], stroke15, id);
    assert.equal(stroke[5], 24);
    assertApprox(stroke[6], stroke24, id);
  }
});

test("code 6340 renders the S as one point two millimeters high", () => {
  const cases = [
    [STYLE_500, 500, 0.006749606956521739, 3.455798761828174],
    [STYLE_1000, 1000, 0.013499213913043479, 6.911597523656348],
    [STYLE_2500, 2500, 0.033748034782608696, 17.27899380914087],
    [STYLE_5000, 5000, 0.06749606956521739, 34.55798761828174],
  ];
  for (const [style, level, atZoom15, atZoom24] of cases) {
    const id = `dm-6340-point-${level}-symbol`;
    const layer = byId(style, id);
    assert.equal(layer.type, "symbol", id);
    assert.equal(layer.layout["icon-image"], "dm-6340", id);
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

test("codes 5105, 7201, and 7211 render as two millimeter centered text symbols", () => {
  const cases = [
    [STYLE_500, 500, 0.016170933334, 8.27951786688],
    [STYLE_1000, 1000, 0.032341866668, 16.55903573376],
    [STYLE_2500, 2500, 0.080854666669, 41.3975893344],
    [STYLE_5000, 5000, 0.161709333338, 82.7951786688],
  ];
  for (const [style, level, atZoom15, atZoom24] of cases) {
    for (const code of [5105, 7201, 7211]) {
      const id = `dm-${code}-point-${level}-symbol`;
      const layer = byId(style, id);
      assert.equal(layer.type, "symbol", id);
      assert.equal(layer["source-layer"], `dm_${code}_point`, id);
      assert.equal(layer.layout["icon-image"], `dm-${code}`, id);
      assert.equal(layer.layout["icon-allow-overlap"], true, id);
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
  }

  assert.deepEqual(SPRITE["dm-5105"], {width: 32, height: 32, x: 32, y: 256, pixelRatio: 1});
  assert.deepEqual(SPRITE["dm-7201"], {width: 64, height: 32, x: 64, y: 256, pixelRatio: 1});
  assert.deepEqual(SPRITE["dm-7211"], {width: 64, height: 32, x: 160, y: 256, pixelRatio: 1});
});

test("code 7303 renders as a one point two millimeter outer circle", () => {
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
    assert.equal(layer.layout["icon-image"], "dm-7303", id);
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
    assert.equal(layer.layout["icon-image"], "dm-7304", id);
    assert.equal(layer.layout["icon-allow-overlap"], true, id);
    assert.deepEqual(layer.layout["icon-rotate"], ["coalesce", ["get", "ROTATION"], 0], id);
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

test("code 6217 uses a rotating point symbol", () => {
  for (const [style, level] of STYLES) {
    const id = `dm-6217-point-${level}-symbol`;
    const layer = byId(style, id);
    assert.equal(layer.type, "symbol", id);
    assert.equal(layer["source-layer"], "dm_6217_point", id);
    assert.equal(layer.layout["icon-image"], "dm-6217", id);
    assert.deepEqual(layer.layout["icon-rotate"], ["coalesce", ["get", "ROTATION"], 0]);
    assert.deepEqual(layer.layout["icon-size"], [
      "interpolate",
      ["exponential", 2],
      ["zoom"],
      15,
      0.129369,
      24,
      66.236673,
    ]);
  }
  assert.ok(SPRITE["dm-6217"]);
});

test("code 4208 uses a rotating point symbol", () => {
  for (const [style, level] of STYLES) {
    const id = `dm-4208-point-${level}-symbol`;
    const layer = byId(style, id);
    assert.equal(layer.type, "symbol", id);
    assert.equal(layer["source-layer"], "dm_4208_point", id);
    assert.equal(layer.layout["icon-image"], "dm-4208", id);
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
    assert.equal(layer.layout["icon-image"], "dm-6214", id);
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

test("code 6140 base and decoration are zero point two millimeter lines", () => {
  const cases = [
    [STYLE_2500, 2500, 0.12936746667, 132.47228587008],
    [STYLE_5000, 5000, 0.25873493334, 264.94457174016],
  ];
  for (const [style, level, width14, width24] of cases) {
    for (const [suffix, sourceLayer] of [["line", "dm_6140_line"], ["decoration", "dm_6140_line_deco_line"]]) {
      const id = `dm-6140-line-${level}-${suffix}`;
      const layer = byId(style, id);
      assert.equal(layer.type, "line", id);
      assert.equal(layer["source-layer"], sourceLayer, id);
      assert.equal(layer.paint["line-dasharray"], undefined, id);
      assert.deepEqual(layer.paint["line-width"], [
        "interpolate",
        ["exponential", 2],
        ["zoom"],
        14,
        width14,
        24,
        width24,
      ]);
    }
  }
});

test("code 2203 base and decoration are zero point three millimeter lines", () => {
  for (const [style, level] of STYLES) {
    for (const [suffix, sourceLayer] of [["line", "dm_2203_line"], ["decoration", "dm_2203_line_deco_line"]]) {
      const id = `dm-2203-line-${level}-${suffix}`;
      const layer = byId(style, id);
      assert.equal(layer.type, "line", id);
      assert.equal(layer["source-layer"], sourceLayer, id);
      assert.deepEqual(layer.paint["line-width"], [
        "interpolate",
        ["exponential", 2],
        ["zoom"],
        14,
        0.19405275,
        24,
        198.710019,
      ]);
    }
  }
});

test("code 2204 base and decoration are zero point one five millimeter lines for level 500 and 1000", () => {
  for (const [style, level, width14, width24] of LOW_LEVEL_STYLES) {
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
      assert.deepEqual(layer.paint["line-width"], [
        "interpolate",
        ["exponential", 2],
        ["zoom"],
        14,
        width14,
        24,
        width24,
      ]);
    }
  }
});

test("code 2205 base and decoration are zero point three millimeter lines", () => {
  const widths = new Map([
    [500, [0.03881055, 39.7420038]],
    [1000, [0.03881055, 39.7420038]],
    [2500, [0.19405275, 198.710019]],
    [5000, [0.19405275, 198.710019]],
  ]);
  for (const [style, level] of ALL_STYLES) {
    const [width14, width24] = widths.get(level);
    for (const [suffix, sourceLayer] of [["line", "dm_2205_line"], ["decoration", "dm_2205_line_deco_line"]]) {
      const id = `dm-2205-line-${level}-${suffix}`;
      const layer = byId(style, id);
      assert.equal(layer.type, "line", id);
      assert.equal(layer["source-layer"], sourceLayer, id);
      assert.deepEqual(layer.paint["line-width"], [
        "interpolate",
        ["exponential", 2],
        ["zoom"],
        14,
        width14,
        24,
        width24,
      ]);
    }
  }
});

test("code 2206 base and decoration are zero point one five millimeter lines for level 500 and 1000 only", () => {
  for (const [style, level, width14, width24] of LOW_LEVEL_STYLES) {
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
      assert.deepEqual(layer.paint["line-width"], [
        "interpolate",
        ["exponential", 2],
        ["zoom"],
        14,
        width14,
        24,
        width24,
      ]);
    }
  }

  for (const [style, level] of STYLES) {
    assert.equal(style.layers.some((layer) => layer.id === `dm-2206-line-${level}-line`), false);
    assert.equal(style.layers.some((layer) => layer.id === `dm-2206-line-${level}-decoration`), false);
  }
});

test("code 2227 is a black zero point three millimeter dashed line for level 500 and 1000 only", () => {
  const widths = new Map([
    [500, [0.03881055, 39.7420038]],
    [1000, [0.0776211, 79.4840072]],
  ]);
  for (const [style, level] of [[STYLE_500, 500], [STYLE_1000, 1000]]) {
    const [width14, width24] = widths.get(level);
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
    assert.deepEqual(layer.paint["line-width"], [
      "interpolate",
      ["exponential", 2],
      ["zoom"],
      14,
      width14,
      24,
      width24,
    ]);
    assert.deepEqual(layer.paint["line-dasharray"], [6.666667, 1.666667], id);
  }

  for (const [style, level] of STYLES) {
    assert.equal(style.layers.some((layer) => layer.id === `dm-2227-line-${level}-line`), false);
  }
});

test("code 2305 is a zero point three millimeter solid line", () => {
  const widths = new Map([
    [500, [0.03881055, 39.7420038]],
    [1000, [0.03881055, 39.7420038]],
    [2500, [0.19405275, 198.710019]],
    [5000, [0.19405275, 198.710019]],
  ]);
  for (const [style, level] of ALL_STYLES) {
    const [width14, width24] = widths.get(level);
    const id = `dm-2305-line-${level}-line`;
    const layer = byId(style, id);
    assert.equal(layer.type, "line", id);
    assert.equal(layer["source-layer"], "dm_2305_line", id);
    assert.equal(layer.paint["line-color"], "#000000", id);
    assert.equal(layer.paint["line-dasharray"], undefined, id);
    assert.deepEqual(layer.paint["line-width"], [
      "interpolate",
      ["exponential", 2],
      ["zoom"],
      14,
      width14,
      24,
      width24,
    ]);
  }
});

test("codes 4265 and 6110 are zero point one millimeter solid lines", () => {
  const cases = [
    [STYLE_2500, 2500, 15, 0.1293685, 66.236673],
    [STYLE_5000, 5000, 14, 0.1293685, 132.473346],
  ];
  for (const [style, level, minzoom, widthAtMinzoom, width24] of cases) {
    for (const code of [4265, 6110]) {
      const id = `dm-${code}-line-${level}-line`;
      const layer = byId(style, id);
      assert.equal(layer.type, "line", id);
      assert.equal(layer["source-layer"], `dm_${code}_line`, id);
      assert.equal(layer.minzoom, minzoom, id);
      assert.equal(layer.paint["line-dasharray"], undefined, id);
      assert.deepEqual(layer.paint["line-width"], [
        "interpolate",
        ["exponential", 2],
        ["zoom"],
        minzoom,
        widthAtMinzoom,
        24,
        width24,
      ]);
    }
  }
});

test("code 7105 is a zero point two millimeter solid line", () => {
  const cases = [
    [STYLE_2500, 2500, 14, 0.12936746667, 132.47228587008],
    [STYLE_5000, 5000, 14, 0.25873493334, 264.94457174016],
  ];
  for (const [style, level, minzoom, widthAtMinzoom, width24] of cases) {
    const id = `dm-7105-line-${level}-line`;
    const layer = byId(style, id);
    assert.equal(layer.type, "line", id);
    assert.equal(layer["source-layer"], "dm_7105_line", id);
    assert.equal(layer.paint["line-color"], "#000000", id);
    assert.equal(layer.minzoom, minzoom, id);
    assert.equal(layer.paint["line-dasharray"], undefined, id);
    assert.deepEqual(layer.paint["line-width"], [
      "interpolate",
      ["exponential", 2],
      ["zoom"],
      minzoom,
      widthAtMinzoom,
      24,
      width24,
    ]);
  }
});

test("code 7106 is a zero point one millimeter solid line", () => {
  const cases = [
    [STYLE_2500, 2500, 15, 0.1293685, 66.236673],
    [STYLE_5000, 5000, 14, 0.1293685, 132.473346],
  ];
  for (const [style, level, minzoom, widthAtMinzoom, width24] of cases) {
    const id = `dm-7106-line-${level}-line`;
    const layer = byId(style, id);
    assert.equal(layer.type, "line", id);
    assert.equal(layer["source-layer"], "dm_7106_line", id);
    assert.equal(layer.paint["line-color"], "#000000", id);
    assert.equal(layer.minzoom, minzoom, id);
    assert.equal(layer.paint["line-dasharray"], undefined, id);
    assert.deepEqual(layer.paint["line-width"], [
      "interpolate",
      ["exponential", 2],
      ["zoom"],
      minzoom,
      widthAtMinzoom,
      24,
      width24,
    ]);
  }
});

test("code 1106 repeats five millimeter dashes with one millimeter gaps", () => {
  for (const [style, level] of STYLES) {
    const id = `dm-1106-line-${level}-line`;
    const layer = byId(style, id);
    assert.equal(layer.type, "line", id);
    assert.equal(layer["source-layer"], "dm_1106_line", id);
    assert.deepEqual(layer.paint["line-dasharray"], [50, 10], id);
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

    const stroke = layer.paint["circle-stroke-width"];
    assert.deepEqual(stroke.slice(0, 4), ["interpolate", ["exponential", 2], ["zoom"], 15]);
    assertApprox(stroke[4], stroke15, id);
    assert.equal(stroke[5], 24);
    assertApprox(stroke[6], stroke24, id);
  }
};

test("line layers remain visible one zoom below five hundredths of a millimeter", () => {
  const minScreenWidthPx = (0.05 * 96) / 25.4;
  for (const [style] of STYLES) {
    for (const layer of style.layers.filter((candidate) => candidate.type === "line" && candidate.minzoom != null)) {
      const id = layer.id;
      const minzoom = layer.minzoom;
      const width = layer.paint["line-width"];
      assert.equal(width[0], "interpolate", id);
      assert.deepEqual(width[1], ["exponential", 2]);
      assert.deepEqual(width[2], ["zoom"]);
      assert.equal(width[3], minzoom, id);

      const widthAtMinzoom = width[4];
      assert.ok(widthAtMinzoom * 2 >= minScreenWidthPx, `${id}: the next zoom is below 0.05mm`);
      if (minzoom > MIN_ZOOM) {
        assert.ok(widthAtMinzoom < minScreenWidthPx, `${id}: zoom ${minzoom} is not one level below 0.05mm`);
      }
    }
  }
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
    assert.equal(layer.layout["icon-image"], "dm-5241");
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
    assert.equal(layer.layout["icon-image"], "dm-5228");
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
