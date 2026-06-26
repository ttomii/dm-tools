import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";
import vm from "node:vm";

const plain = (value) => JSON.parse(JSON.stringify(value));

const loadAppHelpers = async () => {
  const source = await readFile(new URL("../assets/app.js", import.meta.url), "utf8");
  const iifeStart = source.indexOf("(async () =>");
  const helpersStart = source.indexOf("function setupFeatureLayerOptions");
  assert.notEqual(iifeStart, -1);
  assert.notEqual(helpersStart, -1);
  const sandbox = {
    URL,
    location: {href: "http://localhost/preview/?coords=139.75,35.68&scale=2500"},
  };
  vm.createContext(sandbox);
  vm.runInContext(`
${source.slice(0, iifeStart)}
${source.slice(helpersStart)}
globalThis.dmPreviewApp = {
  compareLayerName,
  expandDefaultStyleLayers,
  featureCenter,
  featureMeta,
  featureTitle,
  geometryBounds,
  getCoords,
  getDmSourceLayers,
  getInitialCamera,
  getScale,
  getScaleByZoom,
  getSourceLayerKind,
  getZoomByScale,
  normalizeHighlightProperties,
  styleLabel,
  toGeoJsonFeature,
};
`, sandbox);
  return sandbox.dmPreviewApp;
};

test("assets app expands default style layers for every matching source layer", async () => {
  const app = await loadAppHelpers();
  const layers = [
    {
      id: "background",
      type: "background",
    },
    {
      id: "default-line",
      type: "line",
      source: "dm",
      "source-layer": "dm_default_line",
      filter: ["!", ["in", ["get", "DMCODE"], ["literal", [9999]]]],
    },
    {
      id: "default-point",
      type: "symbol",
      source: "dm",
      "source-layer": "dm_default_point",
    },
  ];

  assert.deepEqual(plain(app.expandDefaultStyleLayers(layers, [
    "dm_7101_line",
    "dm_7102_line",
    "dm_9999_line",
    "dm_2101_point",
    "dm_3101_polygon",
  ])), [
    layers[0],
    {
      ...layers[1],
      id: "default-line-7101",
      "source-layer": "dm_7101_line",
    },
    {
      ...layers[1],
      id: "default-line-7102",
      "source-layer": "dm_7102_line",
    },
    {
      ...layers[2],
      id: "default-point-2101",
      "source-layer": "dm_2101_point",
    },
  ]);
});

test("assets app derives sorted DM source layers and feature labels", async () => {
  const app = await loadAppHelpers();
  const style = {
    layers: [
      {id: "not-dm", source: "osm"},
      {id: "line-10", source: "dm", "source-layer": "dm_10_line"},
      {id: "line-2", source: "dm", "source-layer": "dm_2_line"},
      {id: "line-2-label", source: "dm", "source-layer": "dm_2_line"},
    ],
  };

  assert.deepEqual(plain(app.getDmSourceLayers(style)), ["dm_2_line", "dm_10_line"]);
  assert.equal(app.getSourceLayerKind("dm_1234_text_deco_line"), "line");
  assert.equal(app.getSourceLayerKind("dm_1234_text"), "text");

  const feature = {
    id: 15,
    sourceLayer: "dm_2_line",
    properties: {
      USER_ID: "U-001",
      TEXT: "道路",
      DMCODE: 2101,
      DMFILE: "sample.dm",
    },
  };
  assert.equal(app.featureTitle(feature), "USER_ID U-001 道路");
  assert.equal(app.featureMeta(feature), "dm_2_line / ID 15 / DMCODE 2101 / sample.dm");
});

test("assets app calculates geometry bounds, centers, and highlight properties", async () => {
  const app = await loadAppHelpers();
  const geometry = {
    type: "MultiPolygon",
    coordinates: [
      [[[139.1, 35.1], [139.4, 35.2], [139.2, 35.5], [139.1, 35.1]]],
      [[[140.0, 36.0], [140.2, 35.8], [140.1, 36.2], [140.0, 36.0]]],
    ],
  };

  assert.deepEqual(plain(app.geometryBounds(geometry)), [139.1, 35.1, 140.2, 36.2]);
  assert.deepEqual(plain(app.featureCenter(geometry)), [139.64999999999998, 35.650000000000006]);
  assert.deepEqual(plain(app.normalizeHighlightProperties({ANGLE: 45, NAME: "point"})), {
    ANGLE: 45,
    NAME: "point",
    ROTATION: 45,
  });
  assert.deepEqual(plain(app.toGeoJsonFeature({
    id: 3,
    geometry: {type: "Point", coordinates: [139.75, 35.68]},
    properties: {ANGLE: 90},
  })), {
    type: "Feature",
    id: 3,
    geometry: {type: "Point", coordinates: [139.75, 35.68]},
    properties: {ANGLE: 90, ROTATION: 90},
  });
});

test("assets app reads camera parameters and converts map scale", async () => {
  const app = await loadAppHelpers();
  const url = new URL("http://localhost/preview/?coords=139.75,35.68&scale=2500");
  const zoom = app.getZoomByScale(2500, 35.68);

  assert.deepEqual(plain(app.getCoords(url)), [139.75, 35.68]);
  assert.equal(app.getScale(url), 2500);
  assert.deepEqual(plain(app.getInitialCamera([140, 36, 10])), {
    center: [139.75, 35.68],
    zoom,
  });
  assert.equal(app.getScaleByZoom(zoom, 35.68), 2500);
  assert.equal(app.styleLabel("maplibre/style-2500.json", {levels: [500, 2500]}), "Level 2500");
  assert.equal(app.styleLabel("custom.json", {levels: [1000], styles: ["custom.json"]}), "Level 1000");
});
