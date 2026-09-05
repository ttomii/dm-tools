import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {test} from "node:test";

import {main} from "../src/main.js";
import {GpkgFeatureStore} from "../src/node/gpkg-features.js";
import {openBrowser} from "../src/node/open-browser.js";
import {startServer} from "../src/server.js";
import {toHexColor} from "../src/core/style-editing.js";
import {
  CUSTOM_SIZES as sourceCustomSizes,
  iconEntry as sourceIconEntry,
  orderIconMappingRows as sourceOrderIconMappingRows,
  spriteSize as sourceSpriteSize,
  toSpriteId as sourceToSpriteId,
} from "../src/core/sprite-policy.js";
import {
  canSaveStyle,
  createBrowserPreviewApp,
} from "../static/assets/browser/browser-preview-app.js";
import {
  clearFeatureList,
  renderFeatureList,
  renderHitFeatures,
  selectHitFeature,
  selectListedFeature,
} from "../static/assets/browser/feature-panel.js";
import {createApiClient, checkResponse} from "../static/assets/browser/api-client.js";
import {recolorSpriteIcon, spritePayload} from "../static/assets/browser/sprite-editor.js";
import * as staticDmSourceLayers from "../static/assets/core/dm-source-layers.js";
import * as staticGeometry from "../static/assets/core/geometry.js";
import * as staticMapScale from "../static/assets/core/map-scale.js";
import * as staticSpritePolicy from "../static/assets/core/sprite-policy.js";
import * as staticSpriteRecolor from "../static/assets/core/sprite-recolor.js";
import * as staticStyleEditing from "../static/assets/core/style-editing.js";
import * as staticStyleTransform from "../static/assets/core/style-transform.js";

test("covers source-only helpers and the main preview shutdown path", async () => {
  assert.equal(toHexColor("#12Abef"), "#12Abef");
  assert.equal(toHexColor("red"), undefined);
  assert.equal(sourceToSpriteId("1234"), "dm-1234");
  assert.equal(sourceToSpriteId("dm-1234"), "dm-1234");
  assert.deepEqual(sourceIconEntry("icons/1234.png"), {
    relative: "icons/1234.png",
    dmcode: "1234",
    spriteId: "dm-1234",
    status: "supported",
    note: "",
  });
  assert.equal(sourceIconEntry("icons/unknown.svg").status, "unused");
  assert.deepEqual(
    sourceOrderIconMappingRows([
      {spriteId: "dm-1000"},
      {spriteId: "dm-5228"},
      {spriteId: "dm-5241"},
    ]).map((entry) => entry.spriteId),
    ["dm-5241", "dm-5228", "dm-1000"],
  );
  assert.deepEqual(sourceSpriteSize("dm-5241"), sourceCustomSizes.get("dm-5241"));
  assert.deepEqual(sourceSpriteSize("dm-1000"), {width: 32, height: 32});

  const helpOutput = [];
  const originalLog = console.log;
  console.log = (...values) => helpOutput.push(values.join(" "));
  try {
    await main(["--help"]);
  } finally {
    console.log = originalLog;
  }
  assert.match(helpOutput[0], /dm-preview - preview MapLibre output/);

  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-coverage-"));
  try {
    await writeFile(path.join(root, "sample.pmtiles"), "");
    await writeFile(path.join(root, "pmtiles-manifest.json"), JSON.stringify({
      version: 1,
      layerName: "sample",
      pmtiles: "sample.pmtiles",
      levels: [2500],
      sourceLayers: [],
      bounds: [130, 30, 140, 40],
      center: [135, 35, 15],
    }));
    const previewOutput = [];
    console.log = (...values) => {
      previewOutput.push(values.join(" "));
      if (String(values[0]).startsWith("http://")) {
        setImmediate(() => process.emit("SIGINT"));
      }
    };
    try {
      await main(["preview", root, "--no-open", "--verbose"]);
    } finally {
      console.log = originalLog;
    }
    assert.equal(previewOutput.length, 1);
    assert.match(previewOutput[0], /^http:\/\/127\.0\.0\.1:/);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("uses the identity projection when reading a GeoPackage feature", () => {
  const geometry = pointBlob(139.75, 35.68);
  const table = {
    tableName: "dm_2100_point_08_2500",
    sourceLayer: "dm_2100_point",
    kind: "point",
    zone: 8,
  };
  const adapter = {
    countRows: () => 1,
    queryRows: () => [{fid: 1, geom: geometry}],
    closeDatabase: () => {},
  };
  const store = new GpkgFeatureStore({}, new Map([[table.sourceLayer, [table]]]), {
    databaseAdapter: adapter,
  });

  const result = store.search(new URLSearchParams("layer=dm_2100_point"));

  assert.deepEqual(result.features[0].geometry, {
    type: "Point",
    coordinates: [139.75, 35.68],
  });
  store.close();
});

test("reports style backup cleanup errors", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-coverage-"));
  await mkdir(path.join(root, "sprite"), {recursive: true});
  const diagnostics = [];
  const {server, url} = await startServer(root, {
    diagnosticLog: (event) => diagnostics.push(event),
    publishStyleBundle: async (_root, _staging, options) => {
      options.reportCleanupError(new Error("cleanup failed"));
    },
  });
  try {
    const responseValue = await fetch(`${new URL(url).origin}/preview/api/style-editor/state`, {
      method: "PUT",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({style: {version: 8, sources: {}, layers: []}}),
    });
    assert.equal(responseValue.status, 200);
    assert.deepEqual(diagnostics, [{event: "style-backup-cleanup-failed", error: "cleanup failed"}]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, {recursive: true, force: true});
  }
});

test("uses the configured browser command for every supported platform", async () => {
  const calls = [];
  for (const platform of ["win32", "darwin", "linux"]) {
    const child = new EventEmitter();
    child.unref = () => {};
    const promise = openBrowser("http://localhost:3000/", {
      platform,
      spawn: (file, args, options) => {
        calls.push({file, args, options});
        setImmediate(() => child.emit("spawn"));
        return child;
      },
    });
    await promise;
  }

  assert.deepEqual(calls.map(({file, args}) => ({file, args})), [
    {file: "cmd", args: ["/c", "start", "", "http://localhost:3000/"]},
    {file: "open", args: ["http://localhost:3000/"]},
    {file: "xdg-open", args: ["http://localhost:3000/"]},
  ]);
  assert.equal(calls[0].options.detached, true);
});

test("covers the duplicated browser core modules", () => {
  const sourceLayers = ["dm_2100_line", "dm_3100_point", "dm_4100_polygon", "dm_8100_text"];
  const defaultLayers = [
    {
      id: "default-line",
      source: "dm",
      "source-layer": "dm_default_line",
      filter: ["all", ["!", ["in", ["get", "DMCODE"], ["literal", [2100]]]]],
    },
    {id: "default-point", source: "dm", "source-layer": "dm_default_point"},
    {id: "default-polygon", source: "dm", "source-layer": "dm_default_polygon"},
    {id: "other", source: "other", "source-layer": "other"},
  ];
  const expanded = staticDmSourceLayers.expandDefaultStyleLayers(defaultLayers, sourceLayers);
  assert.deepEqual(expanded.map((layer) => layer["source-layer"]), [
    "dm_3100_point",
    "dm_4100_polygon",
    "other",
  ]);
  assert.deepEqual(
    staticDmSourceLayers.getDmSourceLayers({layers: [
      ...defaultLayers,
      {source: "dm", "source-layer": "dm_2_line"},
      {source: "osm", "source-layer": "dm_1_line"},
    ]}),
    ["dm_2_line", "dm_default_line", "dm_default_point", "dm_default_polygon"],
  );
  assert.equal(staticDmSourceLayers.getSourceLayerKind("dm_annotation"), "text");
  assert.equal(staticDmSourceLayers.getSourceLayerKind("dm_1_line_deco_point"), "point");
  assert.equal(staticDmSourceLayers.getSourceLayerKind("unknown"), undefined);
  assert.equal(staticDmSourceLayers.isAnnotationSourceLayer("dm_8100_text"), true);
  assert.equal(staticDmSourceLayers.isAnnotationSourceLayer("dm_8100_line"), false);
  assert.equal(staticDmSourceLayers.getDmCode("dm_2100_line"), 2100);
  assert.equal(staticDmSourceLayers.getDmCode("invalid"), undefined);
  assert(staticDmSourceLayers.compareLayerName("dm_2_line", "dm_10_line") < 0);

  const geometries = [
    {type: "Point", coordinates: [1, 2]},
    {type: "MultiPoint", coordinates: [[1, 2], [3, 4]]},
    {type: "LineString", coordinates: [[1, 2], [3, 4]]},
    {type: "MultiLineString", coordinates: [[[1, 2], [3, 4]]]},
    {type: "Polygon", coordinates: [[[1, 2], [3, 4], [1, 2]]]},
    {type: "MultiPolygon", coordinates: [[[[1, 2], [3, 4], [1, 2]]]]},
    {type: "Unknown", coordinates: []},
  ];
  assert.deepEqual(staticGeometry.geometryBounds(undefined), undefined);
  for (const geometry of geometries) {
    staticGeometry.geometryBounds(geometry);
  }
  assert.deepEqual(staticGeometry.featureCenter(geometries[0]), [1, 2]);
  assert.deepEqual(staticGeometry.normalizeHighlightProperties({ANGLE: 45}), {ANGLE: 45, ROTATION: 45});
  assert.deepEqual(staticGeometry.toGeoJsonFeature({id: 1, geometry: geometries[0], properties: {}}).id, 1);

  const url = new URL("http://localhost/?coords=139.75,35.68&scale=2500");
  const initial = staticMapScale.getInitialCamera(url, [140, 36, 10]);
  assert.deepEqual(initial.center, [139.75, 35.68]);
  assert.equal(staticMapScale.getCoords(url)[0], 139.75);
  assert.equal(staticMapScale.getScale(url), 2500);
  const zoom = staticMapScale.getZoomByScale(2500, 35.68);
  assert.equal(staticMapScale.getScaleByZoom(zoom, 35.68), 2500);

  assert.equal(staticSpritePolicy.toSpriteId("123"), "dm-123");
  assert.equal(staticSpritePolicy.toSpriteId("custom"), "custom");
  assert.equal(staticSpritePolicy.iconEntry("123.png").status, "supported");
  assert.equal(staticSpritePolicy.iconEntry("source.svg").status, "unused");
  assert.deepEqual(staticSpritePolicy.spriteSize("dm-5228"), {width: 48, height: 16});
  assert.deepEqual(staticSpritePolicy.spriteSize("dm-9999"), {width: 32, height: 32});
  assert.deepEqual(
    staticSpritePolicy.orderIconMappingRows([
      {spriteId: "dm-1000"},
      {spriteId: "dm-5228"},
      {spriteId: "dm-5241"},
    ]).map((entry) => entry.spriteId),
    ["dm-5241", "dm-5228", "dm-1000"],
  );

  const pixels = {
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([100, 150, 200, 255]),
  };
  assert.equal(staticSpriteRecolor.baseIconId("dm-1000__color_AABBCC"), "dm-1000");
  assert.equal(staticSpriteRecolor.recoloredSpriteId("dm-1000", "#AABBCC"), "dm-1000__color_aabbcc");
  assert.equal(staticSpriteRecolor.recolorSpritePixels(pixels, "#ff0000").data[3], 105);
});

test("covers the static style editing and style transformation helpers", () => {
  const styleLayers = [
    {
      id: "icon",
      source: "dm",
      "source-layer": "dm_1000_point",
      type: "symbol",
      layout: {"icon-image": "dm-1000"},
    },
    {
      id: "text",
      source: "dm",
      "source-layer": "dm_annotation",
      type: "symbol",
      layout: {"text-field": ["get", "TEXT"]},
      paint: {"text-color": "#000000"},
    },
    {
      id: "line",
      source: "dm",
      "source-layer": "dm_1000_line",
      type: "line",
      paint: {"line-color": "#000000"},
    },
    {
      id: "polygon-line",
      source: "dm",
      "source-layer": "dm_1000_polygon",
      type: "line",
      paint: {"line-color": "#000000"},
    },
    {
      id: "circle-stroke",
      source: "dm",
      "source-layer": "dm_1000_point",
      type: "circle",
      paint: {"circle-stroke-color": "#000000"},
    },
    {
      id: "circle-color",
      source: "dm",
      "source-layer": "dm_1000_point",
      type: "circle",
      paint: {"circle-color": "#000000"},
    },
    {
      id: "fill",
      source: "dm",
      "source-layer": "dm_1000_polygon",
      type: "fill",
      paint: {"fill-color": "#000000", "fill-outline-color": "#ffffff"},
    },
    {
      id: "vertical",
      source: "dm",
      "source-layer": "dm_annotation",
      type: "symbol",
      layout: {
        "text-field": staticStyleEditing.annotationTextField(),
        "text-writing-mode": ["vertical"],
      },
    },
  ];
  const editableStyle = {layers: styleLayers};
  assert(staticStyleEditing.editableKinds(editableStyle).length > 0);
  assert(staticStyleEditing.editableLayers(editableStyle).length > 0);
  for (const layer of styleLayers) {
    staticStyleEditing.editableColorProperties(layer);
    staticStyleEditing.colorKind(layer);
  }
  staticStyleEditing.editableColorProperties({type: "heatmap"});
  assert.equal(staticStyleEditing.toHexColor("#abcdef"), "#abcdef");
  assert.equal(staticStyleEditing.toHexColor("abcdef"), undefined);
  assert.deepEqual(staticStyleEditing.verticalLongSoundAnnotationTextField(), [
    "coalesce",
    ["get", "TEXT_VERTICAL"],
    ["get", "TEXT"],
    "",
  ]);
  assert.equal(staticStyleEditing.isVerticalAnnotationLayer(styleLayers.at(-1)), true);
  assert.equal(staticStyleEditing.isVerticalAnnotationLayer({}), false);
  staticStyleEditing.setVerticalLongSoundAnnotationStyle(editableStyle, true);
  assert.equal(staticStyleEditing.verticalLongSoundAnnotationStyleEnabled(editableStyle), true);
  staticStyleEditing.setVerticalLongSoundAnnotationStyle(editableStyle, false);
  assert.equal(staticStyleEditing.verticalLongSoundAnnotationStyleEnabled(editableStyle), false);
  assert.equal(staticStyleEditing.findLayerById(editableStyle, "line").id, "line");
  assert.equal(staticStyleEditing.findBaseLayerForRuntime(editableStyle, "line-runtime").id, "line");
  assert.deepEqual(staticStyleEditing.runtimeLayerIds(editableStyle, "line"), ["line"]);
  assert.equal(staticStyleEditing.layerVisibility({layout: {visibility: "none"}}), "none");
  assert.equal(staticStyleEditing.layerVisibility({}), "visible");
  assert.equal(staticStyleEditing.runtimeVisibility({dmVisible: true, layerVisible: false}), "none");
  assert.equal(staticStyleEditing.runtimeVisibility({dmVisible: true, layerVisible: true}), "visible");

  const annotation = {
    id: "annotation",
    type: "symbol",
    source: "dm",
    "source-layer": "dm_annotation",
    filter: [
      "all",
      ["==", ["get", "DMCODE"], 7101],
      ["in", ["get", "DMCODE"], ["literal", [7102]]],
      ["==", ["get", "LEVEL"], 2500],
    ],
    layout: {"text-field": ["get", "TEXT"]},
    paint: {"text-color": "#000000"},
  };
  const annotation2 = {
    ...annotation,
    id: "annotation-2",
    filter: ["==", ["get", "DMCODE"], 7103],
  };
  const baseStyle = {
    version: 8,
    sources: {dm: {type: "vector"}},
    layers: [
      {id: "background", type: "background"},
      {
        id: "fixed-6101",
        type: "line",
        source: "dm",
        "source-layer": "dm_6101_line",
        filter: ["!=", ["get", "DMSKIP"], 1],
      },
      {
        id: "default-line",
        type: "line",
        source: "dm",
        "source-layer": "dm_default_line",
      },
      annotation,
      annotation2,
    ],
  };
  const manifest = {
    pmtiles: "sample.pmtiles",
    sourceLayers: ["dm_annotation", "dm_2100_line", "dm_6101_line"],
    bounds: [130, 30, 140, 40],
    center: [135, 35, 15],
    styles: ["maplibre/style-2500.json"],
  };
  const options = {
    basemapVisible: true,
    dmVisible: true,
    mergeAnnotationLayers: true,
    resourceUrl: (value) => `http://localhost/preview/${value}`,
  };
  const runtime = staticStyleTransform.createRuntimeStyle(baseStyle, manifest, options);
  assert.equal(runtime.sources.dm.url, "pmtiles://http://localhost/preview/sample.pmtiles");
  assert.equal(staticStyleTransform.createBundledStyle(baseStyle, manifest).sources.dm.url, "pmtiles://./sample.pmtiles");
  assert.equal(staticStyleTransform.createBundledStyle(baseStyle, manifest, {pmtiles: "other.pmtiles"}).sources.dm.url, "pmtiles://./other.pmtiles");
  const split = staticStyleTransform.splitAnnotationStyleLayers(baseStyle);
  assert(staticStyleTransform.mergeAnnotationStyleLayers(split).layers.length > 0);
  assert.equal(staticStyleTransform.styleLabel("maplibre/style-2500.json", manifest), "Level 2500");
  assert.equal(staticStyleTransform.styleLabel("custom.json", {levels: [1000], styles: ["custom.json"]}), "Level 1000");
  assert(runtime.layers.some((layer) => layer.id === "gsi-pale"));
});

test("covers browser API, feature panel, sprite editor, and preview app startup", async () => {
  const fetchCalls = [];
  const api = createApiClient({
    appBase: "http://localhost/preview/",
    fetch: async (url, options) => {
      fetchCalls.push({url: String(url), options});
      return {ok: true, status: 200, url: String(url), json: async () => ({ok: true})};
    },
  });
  assert.match(api.resourceUrl("style file.json"), /style%20file\.json/);
  await api.manifest();
  await api.style("http://localhost/preview/style.json");
  await api.features({layer: "dm_2100_line", page: 1});
  await api.styleEditorState();
  await api.saveStyleEditorState({style: {version: 8, sources: {}, layers: []}});
  assert.equal(fetchCalls.length, 5);
  assert.throws(
    () => checkResponse({ok: false, status: 500, url: "http://localhost/error"}),
    /500 http:\/\/localhost\/error/,
  );

  const document = createDocument();
  const originalDocument = globalThis.document;
  globalThis.document = document;
  try {
    const feature = {
      id: 1,
      sourceLayer: "dm_2100_line",
      geometry: {type: "LineString", coordinates: [[1, 2], [3, 4]]},
      bbox: [1, 2, 3, 4],
      properties: {DMCODE: 2100},
    };
    const pointFeature = {
      id: 2,
      sourceLayer: "dm_2100_point",
      geometry: {type: "Point", coordinates: [10, 20]},
      bbox: [10, 20, 10, 20],
      center: [10, 20],
      properties: {ANGLE: 90},
    };
    const list = document.createElement("ol");
    const status = document.createElement("p");
    const page = document.createElement("span");
    const previous = document.createElement("button");
    const next = document.createElement("button");
    renderFeatureList({
      result: {features: [feature], total: 2, page: 1, pageSize: 1},
      list,
      status,
      page,
      prev: previous,
      next,
      onSelect: () => {},
    });
    assert.equal(status.textContent, "2件");
    clearFeatureList(list, status, page, previous, next);
    assert.equal(status.textContent, "対象レイヤがありません");
    renderHitFeatures({features: [feature, pointFeature], list, status, onSelect: () => {}});
    renderHitFeatures({features: [], list, status, onSelect: () => {}});

    const source = {setData: () => {}};
    const movements = [];
    const map = {
      getSource: () => source,
      fitBounds: (...values) => movements.push(["fitBounds", ...values]),
      flyTo: (...values) => movements.push(["flyTo", ...values]),
      getZoom: () => 12,
    };
    selectListedFeature(map, document.createElement("div"), feature);
    selectHitFeature(map, document.createElement("div"), pointFeature);
    assert.equal(movements[0][0], "fitBounds");
    assert.equal(movements[1][0], "flyTo");
  } finally {
    globalThis.document = originalDocument;
  }

  const imageCalls = [];
  const originalGlobals = {
    document: globalThis.document,
    Image: globalThis.Image,
    fetch: globalThis.fetch,
  };
  const spriteDocument = {
    createElement: () => createCanvas(),
  };
  class TestImage {
    naturalWidth = 1;
    naturalHeight = 1;

    set src(value) {
      this.url = value;
      setImmediate(() => this.onload?.());
    }
  }
  globalThis.document = spriteDocument;
  globalThis.Image = TestImage;
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    url: String(url),
    json: async () => ({"dm-1000": {width: 1, height: 1, x: 0, y: 0, pixelRatio: 1}}),
  });
  try {
    const map = {
      hasImage: (id) => imageCalls.includes(id),
      addImage: (id) => imageCalls.push(id),
    };
    const first = await recolorSpriteIcon({
      iconId: "dm-1000",
      color: "#ff0000",
      map,
      resourceUrl: (value) => `http://localhost/preview/${value}`,
    });
    assert.equal(first.spriteState.dirty, true);
    assert.equal(first.iconId, "dm-1000__color_ff0000");
    assert.deepEqual(await spritePayload(first.spriteState), {
      "sprite.json": first.spriteState.sprite.json,
      "sprite.png": "data:image/png;base64,AA==",
      "sprite@2x.json": first.spriteState.sprite2x.json,
      "sprite@2x.png": "data:image/png;base64,AA==",
    });
    const second = await recolorSpriteIcon({
      iconId: "dm-1000",
      color: "#ff0000",
      map,
      spriteState: first.spriteState,
      resourceUrl: (value) => value,
    });
    assert.equal(second.iconId, first.iconId);
  } finally {
    globalThis.document = originalGlobals.document;
    globalThis.Image = originalGlobals.Image;
    globalThis.fetch = originalGlobals.fetch;
  }

  const appDocument = createDocument();
  const elements = createAppElements(appDocument);
  const location = {href: "http://localhost/preview/?layers=dm_2100_line"};
  const historyCalls = [];
  const history = {
    replaceState: (_state, _title, url) => {
      historyCalls.push(url.toString());
      location.href = url.toString();
    },
  };
  const baseStyle = {
    version: 8,
    sources: {dm: {type: "vector"}},
    layers: [
      {id: "background", type: "background"},
      {
        id: "line",
        source: "dm",
        "source-layer": "dm_2100_line",
        type: "line",
        paint: {"line-color": "#000000"},
      },
      {
        id: "icon",
        source: "dm",
        "source-layer": "dm_2100_point",
        type: "symbol",
        layout: {"icon-image": "dm-1000"},
      },
      {
        id: "vertical",
        source: "dm",
        "source-layer": "dm_8100_text",
        type: "symbol",
        layout: {
          "text-field": ["coalesce", ["get", "TEXT"]],
          "text-writing-mode": ["vertical"],
        },
      },
    ],
  };
  const manifest = {
    pmtiles: "sample.pmtiles",
    levels: [2500],
    sourceLayers: ["dm_2100_line", "dm_2100_point", "dm_8100_text"],
    center: [135, 35, 15],
    styles: ["maplibre/style-2500.json"],
  };
  const appFetch = async (url) => {
    const value = String(url);
    if (value.includes("pmtiles-manifest.json")) return response(value, manifest);
    if (value.includes("style-editor/state")) return response(value, {writable: true, style: baseStyle});
    if (value.includes("api/features")) {
      return response(value, {
        layer: "dm_2100_line",
        page: 1,
        pageSize: 50,
        total: 1,
        features: [{
          id: 1,
          sourceLayer: "dm_2100_line",
          geometry: {type: "LineString", coordinates: [[1, 2], [3, 4]]},
          bbox: [1, 2, 3, 4],
          properties: {DMCODE: 2100},
        }],
      });
    }
    return response(value, baseStyle);
  };
  const maps = [];
  class TestMap extends PreviewMap {
    constructor(options) {
      super(options);
      maps.push(this);
    }
  }
  const maplibregl = {
    addProtocol: () => {},
    Map: TestMap,
    NavigationControl: class {},
  };
  const pmtiles = {Protocol: class {}};
  const originalAppDocument = globalThis.document;
  globalThis.document = appDocument;
  try {
    const app = createBrowserPreviewApp({
      elements,
      location,
      history,
      maplibregl,
      pmtiles,
      fetch: appFetch,
    });
    await app.start();
    const map = maps[0];
    map.emit("load");
    map.emit("moveend");
    elements.featureList.children[0].children[0].click();
    elements.styleLayerSelect.value = "line";
    elements.styleLayerSelect.dispatch("change");
    elements.styleLayerColor.value = "#112233";
    elements.styleLayerColor.dispatch("change");
    elements.styleLayerVisible.checked = false;
    elements.styleLayerVisible.dispatch("change");
    elements.styleVerticalLongSound.checked = true;
    elements.styleVerticalLongSound.dispatch("change");
    elements.styleSave.click();
    await new Promise((resolve) => setImmediate(resolve));
    const originalFetch = globalThis.fetch;
    const originalImage = globalThis.Image;
    globalThis.fetch = async () => {
      throw new Error("sprite unavailable");
    };
    globalThis.Image = class {
      set src(_value) {}
    };
    try {
      elements.styleKindInputs.icon.value = "#00ff00";
      elements.styleKindInputs.icon.dispatch("change");
      await new Promise((resolve) => setTimeout(resolve, 25));
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.Image = originalImage;
    }
    elements.background.click();
    elements.basemap.dispatch("change");
    elements.dmToggle.dispatch("change");
    elements.tabFeatureDetails.click();
    assert.equal(elements.status.textContent, "z15.00 center 135.000000,35.000000");
    assert.equal(historyCalls.length, 2);
    assert.equal(elements.styleEditorStatus.textContent, "Error: sprite unavailable");
  } finally {
    globalThis.document = originalAppDocument;
  }
});

test("loads the browser bootstrap module after resolving its runtime vendor import", async () => {
  const vendorRoot = path.resolve("static/vendor");
  const vendorModule = path.join(vendorRoot, "maplibre-gl.mjs");
  await mkdir(vendorRoot, {recursive: true});
  await writeFile(vendorModule, "export const addProtocol = () => { throw new Error('bootstrap test'); };\n");
  const nodes = new Map();
  const document = createDocument();
  document.getElementById = (id) => {
    const node = nodes.get(id) ?? document.createElement("div");
    nodes.set(id, node);
    return node;
  };
  const originalGlobals = {
    document: globalThis.document,
    history: globalThis.history,
    location: globalThis.location,
    window: globalThis.window,
  };
  globalThis.document = document;
  globalThis.history = {replaceState: () => {}};
  globalThis.location = {href: "http://localhost/preview/"};
  globalThis.window = {
    pmtiles: {Protocol: class {}},
    fetch: async () => response("http://localhost/preview/", {}),
  };
  try {
    await import(`../static/assets/app.js?coverage=${Date.now()}`);
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(nodes.get("status").textContent, /bootstrap test/);
  } finally {
    globalThis.document = originalGlobals.document;
    globalThis.history = originalGlobals.history;
    globalThis.location = originalGlobals.location;
    globalThis.window = originalGlobals.window;
    await rm(vendorRoot, {recursive: true, force: true});
  }
});

const pointBlob = (x, y) => {
  const blob = new Uint8Array(61);
  blob[0] = "G".charCodeAt(0);
  blob[1] = "P".charCodeAt(0);
  blob[40] = 1;
  new DataView(blob.buffer).setUint32(41, 1, true);
  new DataView(blob.buffer).setFloat64(45, x, true);
  new DataView(blob.buffer).setFloat64(53, y, true);
  return blob;
};

const response = (url, value) => ({
  ok: true,
  status: 200,
  url,
  json: async () => value,
});

const createAppElements = (document) => ({
  status: document.createElement("p"),
  select: document.createElement("select"),
  background: document.createElement("button"),
  basemap: document.createElement("input"),
  dmToggle: document.createElement("input"),
  properties: document.createElement("div"),
  featureKindSelect: document.createElement("select"),
  featureLayerFilter: document.createElement("input"),
  featureLayerSelect: document.createElement("select"),
  featureList: document.createElement("ol"),
  featureListStatus: document.createElement("p"),
  featurePage: document.createElement("span"),
  featurePrev: document.createElement("button"),
  featureNext: document.createElement("button"),
  hitListStatus: document.createElement("p"),
  hitList: document.createElement("ol"),
  tabStyleEditor: document.createElement("button"),
  tabFeatureDetails: document.createElement("button"),
  styleEditorPanel: document.createElement("section"),
  featureDetailsPanel: document.createElement("section"),
  styleEditorStatus: document.createElement("p"),
  styleSave: document.createElement("button"),
  styleLayerSelect: document.createElement("select"),
  styleLayerVisible: document.createElement("input"),
  styleLayerColor: document.createElement("input"),
  styleVerticalLongSound: document.createElement("input"),
  styleKindInputs: {
    icon: document.createElement("input"),
    line: document.createElement("input"),
    polygon: document.createElement("input"),
    text: document.createElement("input"),
  },
});

class PreviewMap {
  constructor(options) {
    this.style = options.style;
    this.listeners = new Map();
    this.sources = new Map();
    this.center = {lng: options.center[0], lat: options.center[1]};
    this.zoom = options.zoom;
  }

  on(event, listener) {
    this.listeners.set(event, listener);
  }

  emit(event, value) {
    return this.listeners.get(event)?.(value);
  }

  getStyle() {
    return this.style;
  }

  getCenter() {
    return {...this.center, toArray: () => [this.center.lng, this.center.lat]};
  }

  getZoom() {
    return this.zoom;
  }

  addControl() {}

  addSource(id, source) {
    this.sources.set(id, {...source, setData: (data) => { this.highlight = data; }});
  }

  getSource(id) {
    return this.sources.get(id);
  }

  addLayer(layer) {
    this.style.layers.push(layer);
  }

  getLayoutProperty(id, property) {
    return this.style.layers.find((layer) => layer.id === id)?.layout?.[property];
  }

  setLayoutProperty(id, property, value) {
    const layer = this.style.layers.find((candidate) => candidate.id === id);
    if (layer) layer.layout = {...layer.layout, [property]: value};
  }

  setPaintProperty(id, property, value) {
    const layer = this.style.layers.find((candidate) => candidate.id === id);
    if (layer) layer.paint = {...layer.paint, [property]: value};
  }

  queryRenderedFeatures() {
    return [];
  }

  fitBounds() {}

  flyTo() {}

  remove() {}
}

const createDocument = () => ({createElement});

const createElement = (tagName) => {
  const classes = new Set();
  const listeners = new Map();
  const element = {
    tagName: tagName.toUpperCase(),
    children: [],
    textContent: "",
    value: "",
    disabled: false,
    hidden: false,
    checked: false,
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren(...children) {
      this.children = children;
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    dispatch(type, event = {}) {
      return listeners.get(type)?.({...event, target: this});
    },
    click() {
      return listeners.get("click")?.({target: this});
    },
    setAttribute(name, value) {
      this.attributes ??= new Map();
      this.attributes.set(name, String(value));
    },
    querySelectorAll(selector) {
      return descendants(this).filter((candidate) => selector.slice(1) && candidate.classList.contains(selector.slice(1)));
    },
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
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

const createCanvas = () => {
  const canvas = createElement("canvas");
  let context;
  context = {
    drawImage: () => {},
    putImageData: () => {},
    getImageData: (_x, _y, width, height) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4).fill(255),
    }),
  };
  canvas.width = 1;
  canvas.height = 1;
  canvas.getContext = () => context;
  canvas.toDataURL = () => "data:image/png;base64,AA==";
  return canvas;
};
