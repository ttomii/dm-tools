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
  const styleEditorStatus = document.getElementById("style-editor-status");
  const styleSave = document.getElementById("style-save");
  const styleLayerSelect = document.getElementById("style-layer");
  const styleLayerVisible = document.getElementById("style-layer-visible");
  const styleLayerColor = document.getElementById("style-layer-color");
  const styleKindInputs = {
    icon: document.getElementById("style-kind-icon"),
    line: document.getElementById("style-kind-line"),
    polygon: document.getElementById("style-kind-polygon"),
    text: document.getElementById("style-kind-text"),
  };
  const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);
  let map;
  let dark = false;
  let currentFeaturePage = 1;
  let currentBaseStyle;
  let currentRuntimeStyle;
  let styleEditorState = {writable: false, editableLayers: []};
  let spriteState;
  let styleDirty = false;

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
    currentBaseStyle = await fetch(select.value).then(checkResponse).then((response) => response.json());
    currentRuntimeStyle = createRuntimeStyle(currentBaseStyle, manifest, basemap.checked, dmToggle.checked);
    if (map) map.remove();
    map = new maplibregl.Map({
      container: "map",
      style: currentRuntimeStyle,
      center: camera.center,
      zoom: camera.zoom,
      maxZoom: 24,
    });
    setupFeatureLayerOptions(featureLayerSelect, currentRuntimeStyle, featureKindSelect.value);
    await loadStyleEditorState().catch((error) => {
      styleEditorStatus.textContent = String(error);
      styleSave.disabled = true;
    });
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

  const createRuntimeStyle = (baseStyle, manifest, basemapVisible, dmVisible) => {
    const style = structuredClone(baseStyle);
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
      layout: {visibility: basemapVisible ? "visible" : "none"},
    });
    for (const layer of style.layers) {
      if (layer.source === "dm") {
        layer.layout = {
          ...layer.layout,
          visibility: dmVisible ? layer.layout?.visibility ?? "visible" : "none",
        };
      }
    }
    return style;
  };

  const loadStyleEditorState = async () => {
    styleEditorState = await fetch(new URL("api/style-editor/state", APP_BASE))
      .then(checkResponse)
      .then((response) => response.json());
    if (styleEditorState.style) {
      currentBaseStyle = styleEditorState.style;
    } else {
      styleEditorState = {
        ...styleEditorState,
        editableKinds: editableKinds(currentBaseStyle),
        editableLayers: editableLayers(currentBaseStyle),
      };
    }
    styleDirty = false;
    renderStyleEditor();
  };

  const renderStyleEditor = () => {
    const layers = styleEditorState.editableLayers ?? [];
    styleLayerSelect.replaceChildren(...layers.map((layer) => {
      const option = document.createElement("option");
      option.value = layer.id;
      option.textContent = layer.id;
      return option;
    }));
    styleLayerSelect.disabled = layers.length === 0;
    for (const [kind, input] of Object.entries(styleKindInputs)) {
      input.disabled = !styleEditorState.writable || !layers.some((layer) => layer.colorKind === kind);
    }
    styleLayerVisible.disabled = !styleEditorState.writable || layers.length === 0;
    styleLayerColor.disabled = !styleEditorState.writable || layers.length === 0;
    styleSave.disabled = !styleEditorState.writable || !styleDirty;
    styleEditorStatus.textContent = styleEditorState.writable
      ? "保存できます"
      : "保存できません";
    renderSelectedStyleLayer();
  };

  const renderSelectedStyleLayer = () => {
    const layer = baseLayer(styleLayerSelect.value);
    if (!layer) return;
    styleLayerVisible.checked = layer.layout?.visibility !== "none";
    const property = editableColorProperties(layer)[0];
    styleLayerColor.disabled = !styleEditorState.writable || !property;
    if (property && property !== "icon-image") {
      styleLayerColor.value = toHexColor(layer.paint?.[property]) ?? "#000000";
    } else {
      styleLayerColor.value = "#000000";
    }
  };

  const markStyleDirty = () => {
    styleDirty = true;
    styleSave.disabled = !styleEditorState.writable;
    styleEditorStatus.textContent = "未保存の変更があります";
  };

  const applyKindColor = async (kind, color) => {
    for (const layer of styleEditorState.editableLayers.filter((candidate) => candidate.colorKind === kind)) {
      await applyLayerColor(layer.id, color, false);
    }
    markStyleDirty();
  };

  const applyLayerColor = async (id, color, dirty = true) => {
    const layer = baseLayer(id);
    if (!layer) return;
    const properties = editableColorProperties(layer);
    if (properties.includes("icon-image")) {
      const iconId = layer.layout["icon-image"];
      const recolored = await recolorSpriteIcon(iconId, color);
      layer.layout["icon-image"] = recolored;
      for (const layerId of runtimeLayerIds(id)) {
        map.setLayoutProperty(layerId, "icon-image", recolored);
      }
    } else {
      layer.paint = {...layer.paint};
      for (const property of properties) {
        layer.paint[property] = color;
        for (const layerId of runtimeLayerIds(id)) {
          map.setPaintProperty(layerId, property, color);
        }
      }
    }
    if (dirty) markStyleDirty();
  };

  const applyLayerVisibility = (id, visible) => {
    const layer = baseLayer(id);
    if (!layer) return;
    layer.layout = {...layer.layout, visibility: visible ? "visible" : "none"};
    for (const layerId of runtimeLayerIds(id)) {
      map.setLayoutProperty(layerId, "visibility", dmToggle.checked && visible ? "visible" : "none");
    }
    markStyleDirty();
  };

  const saveStyleEditor = async () => {
    styleEditorStatus.textContent = "保存中...";
    const style = createBundledStyle(currentBaseStyle, manifest);
    const sprites = spriteState?.dirty ? await spritePayload(spriteState) : undefined;
    await fetch(new URL("api/style-editor/state", APP_BASE), {
      method: "PUT",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({style, sprites}),
    }).then(checkResponse);
    currentBaseStyle = style;
    styleEditorState.style = style;
    styleDirty = false;
    if (spriteState) spriteState.dirty = false;
    renderStyleEditor();
    styleEditorStatus.textContent = "保存しました";
  };

  const baseLayer = (id) => currentBaseStyle?.layers?.find((layer) => layer.id === id);

  const baseLayerForRuntime = (id) => currentBaseStyle?.layers?.find((layer) => layer.id === id || id.startsWith(`${layer.id}-`));

  const runtimeLayerIds = (id) => map.getStyle().layers
    .filter((layer) => layer.id === id || layer.id.startsWith(`${id}-`))
    .map((layer) => layer.id);

  const editableColorProperties = (layer) => {
    if (layer.type === "symbol" && layer.layout?.["icon-image"]) return ["icon-image"];
    if (layer.type === "symbol" && layer.layout?.["text-field"] && layer.paint?.["text-color"] !== undefined) return ["text-color"];
    if (layer.type === "line" && layer.paint?.["line-color"] !== undefined) return ["line-color"];
    if (layer.type === "circle" && layer.paint?.["circle-color"] !== undefined) return ["circle-color"];
    if (layer.type === "fill") {
      return ["fill-color", "fill-outline-color"].filter((property) => layer.paint?.[property] !== undefined);
    }
    return [];
  };

  const editableKinds = (style) => [...new Set(editableLayers(style).flatMap((layer) => layer.colorKind ? [layer.colorKind] : []))];

  const editableLayers = (style) => (Array.isArray(style.layers) ? style.layers : [])
    .filter((layer) => layer && layer.source === "dm" && typeof layer.id === "string")
    .map((layer) => {
      const colorProperties = editableColorProperties(layer);
      return {
        id: layer.id,
        sourceLayer: layer["source-layer"],
        type: layer.type,
        colorKind: colorKind(layer),
        colorProperties,
        visibility: layer.layout?.visibility === "none" ? "none" : "visible",
        editableColor: colorProperties.length > 0,
        editableVisibility: true,
      };
    })
    .filter((layer) => layer.editableColor || layer.editableVisibility);

  const colorKind = (layer) => {
    const sourceKind = getSourceLayerKind(layer["source-layer"]);
    if (layer.type === "symbol" && layer.layout?.["icon-image"]) return "icon";
    if (layer.type === "symbol" && layer.layout?.["text-field"]) return "text";
    if (layer.type === "circle") return "icon";
    if (layer.type === "line") return sourceKind === "polygon" ? "polygon" : "line";
    if (layer.type === "fill") return "polygon";
    return undefined;
  };

  const createBundledStyle = (style, manifest) => {
    const bundled = structuredClone(style);
    bundled.metadata = {
      ...bundled.metadata,
      "dm:bounds": manifest.bounds,
      "dm:center": manifest.center,
      "dm:sourceLayers": manifest.sourceLayers,
    };
    bundled.sources = {
      ...bundled.sources,
      dm: {
        ...bundled.sources.dm,
        url: `pmtiles://./${manifest.pmtiles}`,
      },
    };
    bundled.sprite = "./sprite/sprite";
    bundled.glyphs = "./glyphs/{fontstack}/{range}.pbf";
    return bundled;
  };

  const recolorSpriteIcon = async (iconId, color) => {
    const hex = color.replace("#", "").toLowerCase();
    const recoloredId = `${baseIconId(iconId)}__color_${hex}`;
    if (!spriteState) spriteState = await loadSpriteState();
    if (!spriteState.sprite.json[recoloredId]) {
      addRecoloredSpriteFrame(spriteState.sprite, iconId, recoloredId, color);
      addRecoloredSpriteFrame(spriteState.sprite2x, iconId, recoloredId, color);
      spriteState.dirty = true;
    }
    const runtimeFrame = spriteState.sprite.json[recoloredId];
    const imageData = spriteState.sprite.context.getImageData(runtimeFrame.x, runtimeFrame.y, runtimeFrame.width, runtimeFrame.height);
    if (!map.hasImage(recoloredId)) map.addImage(recoloredId, imageData);
    return recoloredId;
  };

  const loadSpriteState = async () => ({
    dirty: false,
    sprite: await loadSpriteSheet("sprite"),
    sprite2x: await loadSpriteSheet("sprite@2x"),
  });

  const loadSpriteSheet = async (name) => {
    const [json, image] = await Promise.all([
      fetch(resourceUrl(`${name}.json`)).then(checkResponse).then((response) => response.json()),
      loadImage(resourceUrl(`${name}.png`)),
    ]);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", {willReadFrequently: true});
    context.drawImage(image, 0, 0);
    return {json, canvas, context};
  };

  const addRecoloredSpriteFrame = (sheet, iconId, recoloredId, color) => {
    const frame = sheet.json[baseIconId(iconId)];
    if (!frame) throw new Error(`missing sprite frame ${iconId}`);
    const source = sheet.context.getImageData(frame.x, frame.y, frame.width, frame.height);
    const [red, green, blue] = hexToRgb(color);
    for (let offset = 0; offset < source.data.length; offset += 4) {
      if (source.data[offset + 3] === 0) continue;
      source.data[offset] = red;
      source.data[offset + 1] = green;
      source.data[offset + 2] = blue;
    }
    const y = sheet.canvas.height;
    const nextCanvas = document.createElement("canvas");
    nextCanvas.width = sheet.canvas.width;
    nextCanvas.height = sheet.canvas.height + frame.height;
    const nextContext = nextCanvas.getContext("2d", {willReadFrequently: true});
    nextContext.drawImage(sheet.canvas, 0, 0);
    nextContext.putImageData(source, 0, y);
    sheet.canvas = nextCanvas;
    sheet.context = nextContext;
    sheet.json[recoloredId] = {
      width: frame.width,
      height: frame.height,
      x: 0,
      y,
      pixelRatio: frame.pixelRatio,
    };
  };

  const spritePayload = async (state) => ({
    "sprite.json": state.sprite.json,
    "sprite.png": state.sprite.canvas.toDataURL("image/png"),
    "sprite@2x.json": state.sprite2x.json,
    "sprite@2x.png": state.sprite2x.canvas.toDataURL("image/png"),
  });

  const loadImage = (url) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });

  const baseIconId = (iconId) => iconId.replace(/__color_[0-9a-f]{6}$/i, "");

  const hexToRgb = (color) => {
    const match = /^#?([0-9a-f]{6})$/i.exec(color);
    if (!match) throw new Error(`invalid color ${color}`);
    const value = Number.parseInt(match[1], 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  };

  const toHexColor = (value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;

  select.addEventListener("change", loadStyle);
  for (const [kind, input] of Object.entries(styleKindInputs)) {
    input.addEventListener("input", () => {
      applyKindColor(kind, input.value).catch((error) => {
        styleEditorStatus.textContent = String(error);
      });
    });
  }
  styleLayerSelect.addEventListener("change", renderSelectedStyleLayer);
  styleLayerVisible.addEventListener("change", () => {
    applyLayerVisibility(styleLayerSelect.value, styleLayerVisible.checked);
  });
  styleLayerColor.addEventListener("input", () => {
    applyLayerColor(styleLayerSelect.value, styleLayerColor.value).catch((error) => {
      styleEditorStatus.textContent = String(error);
    });
  });
  styleSave.addEventListener("click", () => {
    saveStyleEditor().catch((error) => {
      styleEditorStatus.textContent = String(error);
    });
  });
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
    for (const layer of map.getStyle().layers) {
      if (layer.source !== "dm") continue;
      const baseVisibility = baseLayerForRuntime(layer.id)?.layout?.visibility ?? "visible";
      map.setLayoutProperty(layer.id, "visibility", dmToggle.checked ? baseVisibility : "none");
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
