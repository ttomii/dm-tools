import assert from "node:assert/strict";
import {test} from "node:test";
import {compareLayerName, expandDefaultStyleLayers, getDmSourceLayers, getSourceLayerKind} from "../src/core/dm-source-layers.js";
import {featureDetails, featureMeta, featureTitle} from "../src/core/feature-labels.js";
import {dmLayerName} from "../src/core/dm-layer-names.js";
import {featureCenter, geometryBounds, normalizeHighlightProperties, toGeoJsonFeature} from "../src/core/geometry.js";
import {getCoords, getInitialCamera, getScale, getScaleByZoom, getZoomByScale} from "../src/core/map-scale.js";
import {featureLayerParameter, updateFeatureLayerParameter, updateStatus} from "../static/assets/browser/browser-preview-app.js";
import {filterFeatureLayers, getClickedDmFeatures, setSelectedFeature, setupFeatureLayerOptions} from "../static/assets/browser/feature-panel.js";
import {renderFeatureItems} from "../static/assets/browser/feature-list.js";
import {
  annotationTextField,
  setVerticalLongSoundAnnotationStyle,
  verticalLongSoundAnnotationStyleEnabled,
  verticalLongSoundAnnotationTextField,
} from "../src/core/style-editing.js";
import {createBundledStyle, createRuntimeStyle, styleLabel} from "../src/core/style-transform.js";

const plain = (value) => JSON.parse(JSON.stringify(value));

test("core expands default style layers for every matching source layer", () => {
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

  assert.deepEqual(plain(expandDefaultStyleLayers(layers, [
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

test("core derives sorted DM source layers and feature labels", () => {
  const style = {
    layers: [
      {id: "not-dm", source: "osm"},
      {id: "line-10", source: "dm", "source-layer": "dm_10_line"},
      {id: "line-2", source: "dm", "source-layer": "dm_2_line"},
      {id: "line-2-label", source: "dm", "source-layer": "dm_2_line"},
    ],
  };

  assert.deepEqual(plain(getDmSourceLayers(style)), ["dm_2_line", "dm_10_line"]);
  assert.equal(getSourceLayerKind("dm_1234_text_deco_line"), "line");
  assert.equal(getSourceLayerKind("dm_1234_text"), "text");
  assert.equal(compareLayerName("dm_2_line", "dm_10_line"), -1);

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
  assert.equal(featureTitle(feature), "USER_ID U-001 道路");
  assert.equal(featureMeta(feature), "dm_2_line / 道路縁（街区線） / sample.dm");
  assert.equal(featureMeta({
    sourceLayer: feature.sourceLayer,
    properties: feature.properties,
  }), featureMeta(feature));
  assert.deepEqual(plain(featureDetails(feature)), {
    sourceLayer: "dm_2_line",
    id: 15,
    layerName: "道路縁（街区線）",
    properties: feature.properties,
  });
  assert.equal(dmLayerName(2511, "dm_2511_point"), "多角点（記号）");
  assert.equal(dmLayerName("2511", "dm_2511_text"), "多角点名称");
  assert.equal(dmLayerName(9998, "dm_9998_line"), "");

  const originalDocument = globalThis.document;
  const document = createDocument();
  const properties = document.createElement("div");
  const map = {getSource: () => ({setData: () => {}})};
  globalThis.document = document;
  try {
    setSelectedFeature(map, properties, feature);
  } finally {
    globalThis.document = originalDocument;
  }

  const table = properties.children[0];
  assert.equal(table.tagName, "TABLE");
  assert.deepEqual(table.children[1].children.map((row) => (
    row.children.map((cell) => cell.textContent)
  )), [
    ["sourceLayer", "dm_2_line"],
    ["id", "15"],
    ["layerName", "道路縁（街区線）"],
    ["USER_ID", "U-001"],
    ["TEXT", "道路"],
    ["DMCODE", "2101"],
    ["DMFILE", "sample.dm"],
  ]);
});

test("core calculates geometry bounds, centers, and highlight properties", () => {
  const geometry = {
    type: "MultiPolygon",
    coordinates: [
      [[[139.1, 35.1], [139.4, 35.2], [139.2, 35.5], [139.1, 35.1]]],
      [[[140.0, 36.0], [140.2, 35.8], [140.1, 36.2], [140.0, 36.0]]],
    ],
  };

  assert.deepEqual(plain(geometryBounds(geometry)), [139.1, 35.1, 140.2, 36.2]);
  assert.deepEqual(plain(featureCenter(geometry)), [139.64999999999998, 35.650000000000006]);
  assert.deepEqual(plain(normalizeHighlightProperties({ANGLE: 45, NAME: "point"})), {
    ANGLE: 45,
    NAME: "point",
    ROTATION: 45,
  });
  assert.deepEqual(plain(toGeoJsonFeature({
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

test("core reads camera parameters and converts map scale", () => {
  const url = new URL("http://localhost/preview/?coords=139.75,35.68&scale=2500");
  const zoom = getZoomByScale(2500, 35.68);

  assert.deepEqual(plain(getCoords(url)), [139.75, 35.68]);
  assert.equal(getScale(url), 2500);
  assert.deepEqual(plain(getInitialCamera(url, [140, 36, 10])), {
    center: [139.75, 35.68],
    zoom,
  });
  assert.equal(getScaleByZoom(zoom, 35.68), 2500);
  assert.equal(styleLabel("maplibre/style-2500.json", {levels: [500, 2500]}), "Level 2500");
  assert.equal(styleLabel("custom.json", {levels: [1000], styles: ["custom.json"]}), "Level 1000");
});

test("browser preview stores selected feature layer in URL parameters", () => {
  const location = {href: "http://localhost/preview/?coords=139,35&layers=dm_7101_line"};
  const replaced = [];
  const history = {
    replaceState: (_state, _title, url) => {
      replaced.push(url.toString());
      location.href = url.toString();
    },
  };

  assert.equal(featureLayerParameter(location), "dm_7101_line");
  updateFeatureLayerParameter(location, history, "dm_8110_text");
  assert.equal(new URL(replaced.at(-1)).searchParams.get("layers"), "dm_8110_text");
  assert.equal(new URL(replaced.at(-1)).searchParams.get("coords"), "139,35");

  updateFeatureLayerParameter(location, history, "");
  assert.equal(new URL(replaced.at(-1)).searchParams.has("layers"), false);
});

test("browser preview status reflects the current map zoom without cursor coordinates", () => {
  const status = {textContent: ""};
  const map = {
    getCenter: () => ({lng: 139.75123456, lat: 35.68123456}),
    getZoom: () => 16.789,
  };

  updateStatus(status, map);

  assert.equal(status.textContent, "z16.79 center 139.751235,35.681235");
});

test("browser preview filters feature layers by kind and partial layer name", () => {
  const layers = ["dm_2101_point", "dm_7101_line", "dm_7102_line", "dm_8110_text"];

  assert.deepEqual(filterFeatureLayers(layers, {query: "710"}), ["dm_7101_line", "dm_7102_line"]);
  assert.deepEqual(filterFeatureLayers(layers, {kind: "line", query: "7102"}), ["dm_7102_line"]);
  assert.deepEqual(filterFeatureLayers(layers, {kind: "line", query: "text"}), []);
});

test("browser preview requires an explicit feature-layer selection", () => {
  const originalDocument = globalThis.document;
  const select = createSelect();
  globalThis.document = {createElement: () => ({})};
  try {
    setupFeatureLayerOptions(select, {
      layers: [{source: "dm", "source-layer": "dm_7101_line"}],
    });
  } finally {
    globalThis.document = originalDocument;
  }

  assert.equal(select.value, "");
  assert.deepEqual(select.options.map((option) => option.value), ["", "dm_7101_line"]);
});

test("browser preview uses an independent selectable feature-list component", () => {
  const originalDocument = globalThis.document;
  const document = createDocument();
  const list = document.createElement("ol");
  const otherList = document.createElement("ol");
  const selected = [];
  const features = [
    {id: 1, sourceLayer: "dm_2101_line", properties: {USER_ID: "U-001", DMCODE: 2101}},
    {id: 2, sourceLayer: "dm_2101_line", properties: {USER_ID: "U-002", DMCODE: 2101}},
  ];
  globalThis.document = document;
  try {
    renderFeatureItems({features, list, onSelect: (feature) => selected.push(feature), selectedIndex: 0});
    const hitFeatures = features.map(({id: _id, ...feature}) => feature);
    renderFeatureItems({features: hitFeatures, list: otherList, onSelect: () => {}, selectedIndex: 0});
    list.children[1].children[0].click();
  } finally {
    globalThis.document = originalDocument;
  }

  assert.equal(list.children[0].children[0].classList.contains("selected"), false);
  assert.equal(list.children[1].children[0].classList.contains("selected"), true);
  assert.equal(otherList.children[0].children[0].classList.contains("selected"), true);
  assert.equal(
    list.children[0].children[0].children[1].textContent,
    otherList.children[0].children[0].children[1].textContent,
  );
  assert.equal(selected[0], features[1]);
});

test("browser preview prioritizes geometry clicks and adds a buffer only for lines", () => {
  const queries = [];
  const map = {
    getStyle: () => ({layers: [
      {id: "point", source: "dm", "source-layer": "dm_1101_point", type: "circle"},
      {id: "line", source: "dm", "source-layer": "dm_2101_line", type: "line"},
      {id: "polygon", source: "dm", "source-layer": "dm_3101_polygon", type: "line"},
      {id: "text", source: "dm", "source-layer": "dm_8110_text", type: "symbol"},
    ]}),
    getLayoutProperty: () => "visible",
    queryRenderedFeatures: (geometry, options) => {
      queries.push({geometry, options});
      return options.layers.includes("line")
        ? [
          {sourceLayer: "dm_2101_line"},
          {sourceLayer: "dm_2101_line"},
        ]
        : [
          {sourceLayer: "dm_8110_text", id: 4},
          {sourceLayer: "dm_3101_polygon", id: 3},
          {sourceLayer: "dm_1101_point", id: 1},
        ];
    },
  };

  const features = getClickedDmFeatures(map, {x: 100, y: 200});

  assert.deepEqual(features.map((feature) => feature.sourceLayer), [
    "dm_1101_point",
    "dm_2101_line",
    "dm_2101_line",
    "dm_3101_polygon",
    "dm_8110_text",
  ]);
  assert.deepEqual(queries, [
    {geometry: {x: 100, y: 200}, options: {layers: ["point", "polygon", "text"]}},
    {geometry: [[94, 194], [106, 206]], options: {layers: ["line"]}},
  ]);
});

test("core hides non-rendered features in runtime and bundled DM styles", () => {
  const baseStyle = {
    version: 8,
    sources: {dm: {type: "vector"}},
    layers: [
      {id: "background", type: "background"},
      {
        id: "fixed-line",
        type: "line",
        source: "dm",
        "source-layer": "dm_6101_line",
        filter: ["==", ["get", "LEVEL"], 2500],
      },
      {
        id: "default-line",
        type: "line",
        source: "dm",
        "source-layer": "dm_default_line",
      },
    ],
  };
  const manifest = {
    levels: [2500],
    pmtiles: "sample.pmtiles",
    sourceLayers: ["dm_7101_line"],
  };

  const runtime = createRuntimeStyle(baseStyle, manifest, {
    resourceUrl: (value) => value,
    basemapVisible: true,
    dmVisible: true,
  });
  assert.deepEqual(byLayerId(runtime, "fixed-line").filter, [
    "all",
    ["==", ["get", "LEVEL"], 2500],
    ["!=", ["get", "DMSKIP"], 1],
    ["!=", ["get", "DMFIGTYPE"], 12],
  ]);
  assert.deepEqual(byLayerId(runtime, "default-line-7101").filter, ["!=", ["get", "DMSKIP"], 1]);

  const bundled = createBundledStyle(baseStyle, manifest);
  assert.deepEqual(byLayerId(bundled, "fixed-line").filter, [
    "all",
    ["==", ["get", "LEVEL"], 2500],
    ["!=", ["get", "DMSKIP"], 1],
    ["!=", ["get", "DMFIGTYPE"], 12],
  ]);
});

test("core toggles vertical annotation long sound mark text fields", () => {
  const style = {
    layers: [
      {
        id: "dm-7101-text-2500-label",
        source: "dm",
        "source-layer": "dm_7101_text",
        type: "symbol",
        layout: {"text-field": annotationTextField()},
      },
      {
        id: "dm-7101-text-2500-label-vertical",
        source: "dm",
        "source-layer": "dm_7101_text",
        type: "symbol",
        layout: {
          "text-field": annotationTextField(),
          "text-writing-mode": ["vertical"],
        },
      },
    ],
  };

  assert.equal(verticalLongSoundAnnotationStyleEnabled(style), false);
  setVerticalLongSoundAnnotationStyle(style, true);
  assert.deepEqual(style.layers[0].layout["text-field"], annotationTextField());
  assert.deepEqual(style.layers[1].layout["text-field"], verticalLongSoundAnnotationTextField());
  assert.equal(verticalLongSoundAnnotationStyleEnabled(style), true);
  setVerticalLongSoundAnnotationStyle(style, false);
  assert.deepEqual(style.layers[1].layout["text-field"], annotationTextField());
});

const byLayerId = (style, id) => {
  const layer = style.layers.find((candidate) => candidate.id === id);
  assert.ok(layer, `missing layer ${id}`);
  return layer;
};

const createSelect = () => ({
  disabled: false,
  options: [],
  value: "",
  append(option) {
    this.options.push(option);
  },
  replaceChildren() {
    this.options = [];
  },
});

const createDocument = () => ({createElement: (tagName) => createElement(tagName)});

const createElement = (tagName) => {
  const classes = new Set();
  const listeners = new Map();
  const element = {
    tagName: tagName.toUpperCase(),
    children: [],
    textContent: "",
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
    },
    append(...children) {
      this.children.push(...children);
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    click() {
      listeners.get("click")?.();
    },
    querySelectorAll(selector) {
      return descendants(this).filter((candidate) => matches(candidate, selector));
    },
    replaceChildren(...children) {
      this.children = children;
    },
  };
  Object.defineProperty(element, "className", {
    get: () => [...classes].join(" "),
    set: (value) => {
      classes.clear();
      value.split(/\s+/).filter(Boolean).forEach((name) => classes.add(name));
    },
  });
  return element;
};

const descendants = (element) => element.children.flatMap((child) => [child, ...descendants(child)]);

const matches = (element, selector) => selector
  .split(".")
  .filter(Boolean)
  .every((className) => element.classList.contains(className));
