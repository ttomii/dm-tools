import {getDmSourceLayers, getSourceLayerKind} from "../core/dm-source-layers.js";
import {featureDetails} from "../core/feature-labels.js";
import {featureCenter, geometryBounds, toGeoJsonFeature} from "../core/geometry.js";
import {renderFeatureItems} from "./feature-list.js";

const HIGHLIGHT_SOURCE_ID = "dm-highlight";
const EMPTY_FEATURES = {type: "FeatureCollection", features: []};
const LINE_CLICK_BUFFER_PIXELS = 6;
const FEATURE_KIND_PRIORITY = {point: 0, line: 1, polygon: 2, text: 3};

export const setupFeatureLayerOptions = (select, style, options = {}) => {
  const kind = typeof options === "string" ? options : options.kind ?? "";
  const query = typeof options === "string" ? "" : options.query ?? "";
  const selected = typeof options === "string" ? select.value : options.selectedLayer ?? select.value;
  select.replaceChildren();
  const sourceLayers = filterFeatureLayers(getDmSourceLayers(style), {kind, query});
  if (sourceLayers.length) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "レイヤを選択してください";
    select.append(placeholder);
  }
  for (const sourceLayer of sourceLayers) {
    const option = document.createElement("option");
    option.value = sourceLayer;
    option.textContent = sourceLayer;
    select.append(option);
  }
  select.disabled = sourceLayers.length === 0;
  select.value = selected && sourceLayers.includes(selected) ? selected : "";
};

export const filterFeatureLayers = (sourceLayers, {kind = "", query = ""} = {}) => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return sourceLayers.filter((sourceLayer) => (
    (!kind || getSourceLayerKind(sourceLayer) === kind)
    && (!normalizedQuery || sourceLayer.toLocaleLowerCase().includes(normalizedQuery))
  ));
};

export const clearFeatureList = (list, status, page, prev, next) => {
  list.replaceChildren();
  status.textContent = "対象レイヤがありません";
  page.textContent = "";
  prev.disabled = true;
  next.disabled = true;
};

export const renderFeatureList = ({result, list, status, page, prev, next, onSelect}) => {
  renderFeatureItems({features: result.features, list, onSelect});
  const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
  status.textContent = `${result.total}件`;
  page.textContent = `${result.page} / ${lastPage}`;
  prev.disabled = result.page <= 1;
  next.disabled = result.page >= lastPage;
};

export const selectListedFeature = (map, properties, feature) => {
  setSelectedFeature(map, properties, toGeoJsonFeature(feature));
  moveToFeature(map, feature);
};

export const selectHitFeature = (map, properties, feature) => {
  setSelectedFeature(map, properties, toGeoJsonFeature(feature));
  moveToFeature(map, feature);
};

export const renderHitFeatures = ({features, list, status, onSelect}) => {
  if (!features.length) {
    clearHitFeatures(list, status);
    return;
  }
  renderFeatureItems({features, list, onSelect, selectedIndex: 0});
  status.textContent = features.length === 1 ? "1件" : `${features.length}件重なっています`;
};

export const addHighlightLayers = (map) => {
  map.addSource(HIGHLIGHT_SOURCE_ID, {
    type: "geojson",
    data: EMPTY_FEATURES,
  });
  map.addLayer({
    id: "dm-highlight-polygon",
    type: "fill",
    source: HIGHLIGHT_SOURCE_ID,
    filter: ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]],
    paint: {"fill-color": "#00a3ff", "fill-opacity": 0.32, "fill-outline-color": "#005f99"},
  });
  map.addLayer({
    id: "dm-highlight-line-buffer",
    type: "line",
    source: HIGHLIGHT_SOURCE_ID,
    filter: ["in", ["geometry-type"], ["literal", ["LineString", "MultiLineString"]]],
    layout: {"line-cap": "round", "line-join": "round"},
    paint: {"line-color": "#00a3ff", "line-opacity": 0.36, "line-width": 18},
  });
  map.addLayer({
    id: "dm-highlight-line-arrow",
    type: "symbol",
    source: HIGHLIGHT_SOURCE_ID,
    filter: ["in", ["geometry-type"], ["literal", ["LineString", "MultiLineString"]]],
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": 72,
      "text-field": "▶",
      "text-size": 18,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-keep-upright": false,
      "text-rotation-alignment": "map",
    },
    paint: {"text-color": "#005f99", "text-halo-color": "rgba(255, 255, 255, 0.85)", "text-halo-width": 1},
  });
  map.addLayer({
    id: "dm-highlight-point",
    type: "circle",
    source: HIGHLIGHT_SOURCE_ID,
    filter: ["in", ["geometry-type"], ["literal", ["Point", "MultiPoint"]]],
    paint: {"circle-radius": 10, "circle-color": "#00a3ff", "circle-opacity": 0.42},
  });
  map.addLayer({
    id: "dm-highlight-point-direction",
    type: "symbol",
    source: HIGHLIGHT_SOURCE_ID,
    filter: ["in", ["geometry-type"], ["literal", ["Point", "MultiPoint"]]],
    layout: {
      "text-field": "▶",
      "text-size": 10,
      "text-anchor": "left",
      "text-offset": [0.65, 0],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-keep-upright": false,
      "text-rotation-alignment": "map",
      "text-rotate": ["coalesce", ["get", "ROTATION"], 0],
    },
    paint: {"text-color": "rgba(0, 95, 153, 0.55)", "text-halo-color": "rgba(255, 255, 255, 0.65)", "text-halo-width": 0.75},
  });
};

export const getClickedDmFeatures = (map, point) => {
  const dmLayers = map
    .getStyle()
    .layers
    .filter((layer) => layer.source === "dm" && map.getLayoutProperty(layer.id, "visibility") !== "none");
  const lineLayers = dmLayers
    .filter((layer) => getSourceLayerKind(layer["source-layer"]) === "line")
    .map((layer) => layer.id);
  const layers = dmLayers
    .filter((layer) => getSourceLayerKind(layer["source-layer"]) !== "line")
    .map((layer) => layer.id);
  if (layers.length === 0 && lineLayers.length === 0) return [];
  const clicked = layers.length === 0 ? [] : map.queryRenderedFeatures(point, {layers});
  const nearbyLines = lineLayers.length === 0
    ? []
    : map.queryRenderedFeatures(clickBuffer(point, LINE_CLICK_BUFFER_PIXELS), {layers: lineLayers});
  return prioritizeClickedFeatures([...clicked, ...nearbyLines]);
};

const clickBuffer = (point, pixels) => [
  [point.x - pixels, point.y - pixels],
  [point.x + pixels, point.y + pixels],
];

const prioritizeClickedFeatures = (features) => features.sort((a, b) => featurePriority(a) - featurePriority(b));

const featurePriority = (feature) => FEATURE_KIND_PRIORITY[getSourceLayerKind(feature.sourceLayer)] ?? Number.MAX_SAFE_INTEGER;

export const setSelectedFeature = (map, properties, feature) => {
  setHighlightedFeature(map, feature);
  renderFeatureDetails(properties, feature ? featureDetails(feature) : undefined);
};

const renderFeatureDetails = (container, details) => {
  container.replaceChildren();
  if (!details) return;
  container.append(createFeatureDetailsTable(details));
};

const createFeatureDetailsTable = (details) => {
  const table = document.createElement("table");
  table.className = "feature-properties-table";
  table.append(createFeatureDetailsHeader(), createFeatureDetailsBody(details));
  return table;
};

const createFeatureDetailsHeader = () => {
  const header = document.createElement("thead");
  const row = document.createElement("tr");
  row.append(createText("th", "", "項目"), createText("th", "", "値"));
  header.append(row);
  return header;
};

const createFeatureDetailsBody = (details) => {
  const body = document.createElement("tbody");
  const metadata = [
    ["sourceLayer", details.sourceLayer],
    ["id", details.id],
    ["layerName", details.layerName],
  ];
  const rows = [...metadata, ...Object.entries(details.properties ?? {})];
  body.append(...rows.map(([name, value]) => createFeatureDetailRow(name, value)));
  return body;
};

const createFeatureDetailRow = (name, value) => {
  const row = document.createElement("tr");
  row.append(createText("th", "", name), createText("td", "", formatFeatureDetailValue(value)));
  return row;
};

const formatFeatureDetailValue = (value) => {
  if (value === undefined) return "";
  if (value === null) return "null";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
};

export const setHighlightedFeature = (map, feature) => {
  const source = map.getSource(HIGHLIGHT_SOURCE_ID);
  source.setData(feature ? {type: "FeatureCollection", features: [toGeoJsonFeature(feature)]} : EMPTY_FEATURES);
};

const createText = (tag, className, text) => {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
};

const moveToFeature = (map, feature) => {
  const bounds = feature.bbox ?? geometryBounds(feature.geometry);
  if (!bounds) return;
  const [west, south, east, north] = bounds;
  if (west !== east || south !== north) {
    map.fitBounds([[west, south], [east, north]], {padding: 96, maxZoom: 20});
    return;
  }
  const center = feature.center ?? featureCenter(feature.geometry);
  if (!center) return;
  map.flyTo({center, zoom: Math.max(map.getZoom(), 18)});
};

const clearHitFeatures = (list, status) => {
  list.replaceChildren();
  status.textContent = "クリックした位置の重なり";
};
