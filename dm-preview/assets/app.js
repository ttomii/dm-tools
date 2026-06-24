"use strict";
const EARTH_CIRCUMFERENCE = 2 * Math.PI * 6378137;
const TILE_SIZE = 512;
const STANDARD_DPI = 96;
const INCHES_PER_METER = 39.37;
const GSI_PALE_TILE_URL = "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png";
const GSI_ATTRIBUTION = "<a href=\"https://maps.gsi.go.jp/development/ichiran.html\" target=\"_blank\" rel=\"noopener\">地理院タイル</a>";
const HIGHLIGHT_SOURCE_ID = "dm-highlight";
const EMPTY_FEATURES = {type: "FeatureCollection", features: []};
const FEATURE_PAGE_SIZE = 50;
const DEFAULT_SOURCE_LAYERS = {
  dm_default_line: "line",
  dm_default_point: "point",
  dm_default_polygon: "polygon",
};
const APP_BASE = new URL(".", location.href);

(async () => {
  const status = document.getElementById("status");
  const select = document.getElementById("style");
  const basemap = document.getElementById("basemap");
  const dmToggle = document.getElementById("dm");
  const properties = document.getElementById("properties");
  const featureKindSelect = document.getElementById("feature-kind");
  const featureLayerSelect = document.getElementById("feature-layer");
  const featureList = document.getElementById("feature-list");
  const featureListStatus = document.getElementById("feature-list-status");
  const featurePage = document.getElementById("feature-page");
  const featurePrev = document.getElementById("feature-prev");
  const featureNext = document.getElementById("feature-next");
  const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);
  let map;
  let dark = false;
  let currentFeaturePage = 1;

  const manifest = await fetch(resourceUrl("pmtiles-manifest.json")).then(checkResponse).then((response) => response.json());
  const styles = manifest.styles ?? manifest.levels.map((level) => `maplibre/style-${level}.json`);
  for (const styleUrl of styles) {
    const option = document.createElement("option");
    option.value = resourceUrl(styleUrl);
    option.textContent = styleLabel(styleUrl, manifest);
    select.append(option);
  }
  select.disabled = styles.length === 1;

  const loadFeaturePage = async (page = 1) => {
    if (!featureLayerSelect.value) {
      clearFeatureList(featureList, featureListStatus, featurePage, featurePrev, featureNext);
      return;
    }
    featureListStatus.textContent = "読み込み中...";
    const url = new URL("api/features", APP_BASE);
    url.searchParams.set("layer", featureLayerSelect.value);
    url.searchParams.set("page", String(page));
    url.searchParams.set("pageSize", String(FEATURE_PAGE_SIZE));
    const result = await fetch(url).then(checkResponse).then((response) => response.json());
    currentFeaturePage = result.page;
    renderFeatureList({
      result,
      list: featureList,
      status: featureListStatus,
      page: featurePage,
      prev: featurePrev,
      next: featureNext,
      onSelect: (feature) => selectListedFeature(map, properties, feature),
    });
  };

  const loadStyle = async () => {
    const camera = map
      ? {center: map.getCenter().toArray(), zoom: map.getZoom()}
      : getInitialCamera(manifest.center);
    const style = await fetch(select.value).then(checkResponse).then((response) => response.json());
    style.sources.dm.url = `pmtiles://${resourceUrl(manifest.pmtiles)}`;
    style.sprite = resourceUrl("sprite");
    style.glyphs = `${resourceUrl("glyphs")}/{fontstack}/{range}.pbf`;
    style.layers = expandDefaultStyleLayers(style.layers, manifest.sourceLayers ?? []);
    style.sources.gsi = {
      type: "raster",
      tiles: [GSI_PALE_TILE_URL],
      tileSize: 256,
      maxzoom: 18,
      attribution: GSI_ATTRIBUTION,
    };
    const backgroundIndex = style.layers.findIndex((layer) => layer.id === "background");
    style.layers.splice(backgroundIndex + 1, 0, {
      id: "gsi-pale",
      type: "raster",
      source: "gsi",
      layout: {visibility: basemap.checked ? "visible" : "none"},
    });
    const dmVisibility = dmToggle.checked ? "visible" : "none";
    for (const layer of style.layers) {
      if (layer.source === "dm") layer.layout = {...layer.layout, visibility: dmVisibility};
    }
    if (map) map.remove();
    map = new maplibregl.Map({
      container: "map",
      style,
      center: camera.center,
      zoom: camera.zoom,
      maxZoom: 24,
    });
    setupFeatureLayerOptions(featureLayerSelect, style, featureKindSelect.value);
    map.addControl(new maplibregl.NavigationControl());
    map.on("load", () => addHighlightLayers(map));
    map.on("moveend", () => updateMapParameters(map));
    map.on("mousemove", (event) => {
      const center = map.getCenter();
      status.textContent = `z${map.getZoom().toFixed(2)} center ${center.lng.toFixed(6)},${center.lat.toFixed(6)} cursor ${event.lngLat.lng.toFixed(6)},${event.lngLat.lat.toFixed(6)}`;
    });
    map.on("click", (event) => {
      const feature = getClickedDmFeature(map, event.point);
      setSelectedFeature(map, properties, feature);
    });
    await loadFeaturePage(1).catch((error) => {
      featureListStatus.textContent = String(error);
      featureList.replaceChildren();
    });
  };

  select.addEventListener("change", loadStyle);
  featureKindSelect.addEventListener("change", () => {
    setupFeatureLayerOptions(featureLayerSelect, map.getStyle(), featureKindSelect.value);
    loadFeaturePage(1).catch((error) => {
      featureListStatus.textContent = String(error);
      featureList.replaceChildren();
    });
  });
  featureLayerSelect.addEventListener("change", () => loadFeaturePage(1).catch((error) => {
    featureListStatus.textContent = String(error);
    featureList.replaceChildren();
  }));
  featurePrev.addEventListener("click", () => loadFeaturePage(currentFeaturePage - 1).catch((error) => {
    featureListStatus.textContent = String(error);
  }));
  featureNext.addEventListener("click", () => loadFeaturePage(currentFeaturePage + 1).catch((error) => {
    featureListStatus.textContent = String(error);
  }));
  document.getElementById("background").addEventListener("click", () => {
    dark = !dark;
    map.setPaintProperty("background", "background-color", dark ? "#20242a" : "#ffffff");
  });
  basemap.addEventListener("change", () => {
    map.setLayoutProperty("gsi-pale", "visibility", basemap.checked ? "visible" : "none");
  });
  dmToggle.addEventListener("change", () => {
    const visibility = dmToggle.checked ? "visible" : "none";
    for (const layer of map.getStyle().layers) {
      if (layer.source === "dm") map.setLayoutProperty(layer.id, "visibility", visibility);
    }
    if (!dmToggle.checked) setHighlightedFeature(map);
  });
  await loadStyle();
})().catch((error) => {
  document.getElementById("status").textContent = String(error);
});

function setupFeatureLayerOptions(select, style, kind = "") {
  const selected = select.value;
  select.replaceChildren();
  const sourceLayers = getDmSourceLayers(style).filter((sourceLayer) => !kind || getSourceLayerKind(sourceLayer) === kind);
  for (const sourceLayer of sourceLayers) {
    const option = document.createElement("option");
    option.value = sourceLayer;
    option.textContent = sourceLayer;
    select.append(option);
  }
  select.disabled = sourceLayers.length === 0;
  if (selected && [...select.options].some((option) => option.value === selected)) select.value = selected;
}

function clearFeatureList(list, status, page, prev, next) {
  list.replaceChildren();
  status.textContent = "対象レイヤがありません";
  page.textContent = "";
  prev.disabled = true;
  next.disabled = true;
}

function renderFeatureList({result, list, status, page, prev, next, onSelect}) {
  list.replaceChildren(...result.features.map((feature) => createFeatureListItem(feature, onSelect)));
  const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
  status.textContent = `${result.total}件`;
  page.textContent = `${result.page} / ${lastPage}`;
  prev.disabled = result.page <= 1;
  next.disabled = result.page >= lastPage;
}

function createFeatureListItem(feature, onSelect) {
  const item = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "feature-list-item";
  button.append(createText("span", "feature-list-title", featureTitle(feature)));
  button.append(createText("span", "feature-list-meta", featureMeta(feature)));
  button.addEventListener("click", () => {
    for (const selected of document.querySelectorAll(".feature-list-item.selected")) {
      selected.classList.remove("selected");
    }
    button.classList.add("selected");
    onSelect(feature);
  });
  item.append(button);
  return item;
}

function createText(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function featureTitle(feature) {
  const text = feature.properties.TEXT ? ` ${feature.properties.TEXT}` : "";
  return `USER_ID ${feature.properties.USER_ID ?? feature.fid}${text}`;
}

function featureMeta(feature) {
  const dmcode = feature.properties.DMCODE ?? feature.properties.SRC_DMCODE ?? "";
  const dmfile = feature.properties.DMFILE ?? feature.properties.SRC_DMFILE ?? "";
  return [feature.sourceLayer, dmcode && `DMCODE ${dmcode}`, dmfile].filter(Boolean).join(" / ");
}

function selectListedFeature(map, properties, feature) {
  const geoJsonFeature = toGeoJsonFeature(feature);
  setSelectedFeature(map, properties, geoJsonFeature);
  moveToFeature(map, feature);
}

function setSelectedFeature(map, properties, feature) {
  setHighlightedFeature(map, feature);
  properties.textContent = feature
    ? JSON.stringify({sourceLayer: feature.sourceLayer, properties: feature.properties}, undefined, 2)
    : "";
}

function moveToFeature(map, feature) {
  const [west, south, east, north] = feature.bbox;
  if (west !== east || south !== north) {
    map.fitBounds([[west, south], [east, north]], {padding: 96, maxZoom: 20});
    return;
  }
  map.flyTo({center: feature.center, zoom: Math.max(map.getZoom(), 18)});
}

function expandDefaultStyleLayers(layers, sourceLayers) {
  if (sourceLayers.length === 0) return layers;
  const sourceLayersByKind = groupDefaultSourceLayers(sourceLayers);
  return layers.flatMap((layer) => {
    const kind = DEFAULT_SOURCE_LAYERS[layer["source-layer"]];
    if (!kind) return [layer];
    const expanded = sourceLayersByKind.get(kind) ?? [];
    return expanded
      .filter((sourceLayer) => !isExcludedDefaultCode(layer, sourceLayer))
      .map((sourceLayer) => ({
        ...layer,
        id: `${layer.id}-${getDmCode(sourceLayer)}`,
        "source-layer": sourceLayer,
      }));
  });
}

function groupDefaultSourceLayers(sourceLayers) {
  const grouped = new Map([["line", []], ["point", []], ["polygon", []]]);
  for (const sourceLayer of sourceLayers) {
    const match = /^dm_\d+_(line|point|polygon)$/.exec(sourceLayer);
    if (match) grouped.get(match[1]).push(sourceLayer);
  }
  return grouped;
}

function isExcludedDefaultCode(layer, sourceLayer) {
  const dmcode = getDmCode(sourceLayer);
  const excluded = findLiteralNumberArray(layer.filter);
  return dmcode !== undefined && excluded.includes(dmcode);
}

function findLiteralNumberArray(value) {
  if (!Array.isArray(value)) return [];
  if (value[0] === "literal" && Array.isArray(value[1]) && value[1].every(Number.isInteger)) {
    return value[1];
  }
  for (const item of value) {
    const found = findLiteralNumberArray(item);
    if (found.length) return found;
  }
  return [];
}

function getDmSourceLayers(style) {
  return [...new Set(style.layers.filter(isDmLayer).map((layer) => layer["source-layer"]))]
    .sort(compareLayerName);
}

function isDmLayer(layer) {
  return layer.source === "dm" && layer["source-layer"];
}

function compareLayerName(a, b) {
  return a.localeCompare(b, "ja", {numeric: true});
}

function getSourceLayerKind(sourceLayer) {
  const match = /^dm_\d+_(point|line|polygon|text)(?:_deco_(point|line|polygon))?$/.exec(sourceLayer);
  return match?.[2] ?? match?.[1];
}

function getDmCode(sourceLayer) {
  const match = /^dm_(\d+)_/.exec(sourceLayer);
  return match ? Number(match[1]) : undefined;
}

function addHighlightLayers(map) {
  map.addSource(HIGHLIGHT_SOURCE_ID, {
    type: "geojson",
    data: EMPTY_FEATURES,
  });
  map.addLayer({
    id: "dm-highlight-polygon",
    type: "fill",
    source: HIGHLIGHT_SOURCE_ID,
    filter: ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]],
    paint: {
      "fill-color": "#00a3ff",
      "fill-opacity": 0.32,
      "fill-outline-color": "#005f99",
    },
  });
  map.addLayer({
    id: "dm-highlight-line-buffer",
    type: "line",
    source: HIGHLIGHT_SOURCE_ID,
    filter: ["in", ["geometry-type"], ["literal", ["LineString", "MultiLineString"]]],
    layout: {"line-cap": "round", "line-join": "round"},
    paint: {
      "line-color": "#00a3ff",
      "line-opacity": 0.36,
      "line-width": 18,
    },
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
    paint: {
      "text-color": "#005f99",
      "text-halo-color": "rgba(255, 255, 255, 0.85)",
      "text-halo-width": 1,
    },
  });
  map.addLayer({
    id: "dm-highlight-point",
    type: "circle",
    source: HIGHLIGHT_SOURCE_ID,
    filter: ["in", ["geometry-type"], ["literal", ["Point", "MultiPoint"]]],
    paint: {
      "circle-radius": 10,
      "circle-color": "#00a3ff",
      "circle-opacity": 0.42,
    },
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
    paint: {
      "text-color": "rgba(0, 95, 153, 0.55)",
      "text-halo-color": "rgba(255, 255, 255, 0.65)",
      "text-halo-width": 0.75,
    },
  });
}

function getClickedDmFeature(map, point) {
  const layers = map
    .getStyle()
    .layers
    .filter((layer) => layer.source === "dm" && map.getLayoutProperty(layer.id, "visibility") !== "none")
    .map((layer) => layer.id);
  if (layers.length === 0) return;
  return map.queryRenderedFeatures(point, {layers})[0];
}

function setHighlightedFeature(map, feature) {
  const source = map.getSource(HIGHLIGHT_SOURCE_ID);
  source.setData(feature ? {type: "FeatureCollection", features: [toGeoJsonFeature(feature)]} : EMPTY_FEATURES);
}

function toGeoJsonFeature(feature) {
  return {
    type: "Feature",
    geometry: feature.geometry,
    properties: normalizeHighlightProperties(feature.properties ?? {}),
  };
}

function normalizeHighlightProperties(properties) {
  if ("ROTATION" in properties || !properties.ANGLE) return properties;
  return {...properties, ROTATION: properties.ANGLE};
}

function checkResponse(response) {
  if (!response.ok) throw new Error(`${response.status} ${response.url}`);
  return response;
}

function styleLabel(styleUrl, manifest) {
  const level = /^maplibre\/style-(\d+)\.json$/.exec(styleUrl)?.[1]
    ?? (manifest.styles?.length === 1 ? manifest.levels[0] : undefined);
  return level ? `Level ${level}` : styleUrl;
}

function resourceUrl(relativePath) {
  return new URL(relativePath.split("/").map(encodeURIComponent).join("/"), APP_BASE).toString();
}

function getInitialCamera(fallback) {
  const url = new URL(location.href);
  const coords = getCoords(url);
  const center = coords ?? fallback.slice(0, 2);
  const scale = getScale(url);
  return {
    center,
    zoom: scale === undefined ? fallback[2] : getZoomByScale(scale, center[1]),
  };
}

function getCoords(url) {
  const value = url.searchParams.get("coords");
  if (!value) return;
  const coords = value.split(",");
  if (coords.length !== 2) return;
  const longitude = parseFloat(coords[0]);
  const latitude = parseFloat(coords[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return;
  return [longitude, latitude];
}

function getScale(url) {
  const value = url.searchParams.get("scale");
  if (!value) return;
  const scale = parseInt(value, 10);
  return Number.isFinite(scale) && scale > 0 ? scale : undefined;
}

function getZoomByScale(scale, latitude) {
  const groundResolution = scale / (STANDARD_DPI * INCHES_PER_METER);
  const projectedResolution = groundResolution / Math.cos(latitude * Math.PI / 180);
  return Math.log2(EARTH_CIRCUMFERENCE / (TILE_SIZE * projectedResolution));
}

function getScaleByZoom(zoom, latitude) {
  const projectedResolution = EARTH_CIRCUMFERENCE / (TILE_SIZE * 2 ** zoom);
  const groundResolution = projectedResolution * Math.cos(latitude * Math.PI / 180);
  return Math.round(groundResolution * STANDARD_DPI * INCHES_PER_METER);
}

function updateMapParameters(map) {
  const center = map.getCenter();
  const url = new URL(location.href);
  url.searchParams.set("coords", `${center.lng},${center.lat}`);
  url.searchParams.set("scale", String(getScaleByZoom(map.getZoom(), center.lat)));
  history.replaceState("", "", url);
}
