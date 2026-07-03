import {
  editableColorProperties,
  editableKinds,
  editableLayers,
  findBaseLayerForRuntime,
  findLayerById,
  layerVisibility,
  runtimeLayerIds,
  runtimeVisibility,
  setVerticalLongSoundAnnotationStyle,
  toHexColor,
  verticalLongSoundAnnotationStyleEnabled,
} from "../core/style-editing.js";
import {createBundledStyle, createRuntimeStyle, styleLabel} from "../core/style-transform.js";
import {getInitialCamera, getScaleByZoom} from "../core/map-scale.js";
import {toGeoJsonFeature} from "../core/geometry.js";
import {createApiClient} from "./api-client.js";
import {
  addHighlightLayers,
  clearFeatureList,
  getClickedDmFeatures,
  renderFeatureList,
  renderHitFeatures,
  selectHitFeature,
  selectListedFeature,
  setHighlightedFeature,
  setSelectedFeature,
  setupFeatureLayerOptions,
} from "./feature-panel.js";
import {recolorSpriteIcon, spritePayload} from "./sprite-editor.js";

const FEATURE_PAGE_SIZE = 50;
const FEATURE_LAYER_PARAMETER = "layers";

export const createBrowserPreviewApp = ({elements, location, history, maplibregl, pmtiles, fetch}) => {
  const appBase = new URL(".", location.href);
  const api = createApiClient({appBase, fetch});
  const state = {
    map: undefined,
    dark: false,
    currentFeaturePage: 1,
    currentBaseStyle: undefined,
    styleEditorState: {writable: false, editableLayers: []},
    spriteState: undefined,
    styleDirty: false,
    activeDetailTab: "style-editor",
  };

  const setDetailTab = (tab) => {
    state.activeDetailTab = tab;
    const isStyleEditor = tab === "style-editor";
    const isFeatureDetails = tab === "feature-details";
    elements.styleEditorPanel.hidden = !isStyleEditor;
    elements.featureDetailsPanel.hidden = !isFeatureDetails;
    elements.tabStyleEditor.setAttribute("aria-selected", String(isStyleEditor));
    elements.tabFeatureDetails.setAttribute("aria-selected", String(isFeatureDetails));
  };

  const getRuntimeLayerIds = (id) => runtimeLayerIds(state.map.getStyle(), id);
  const baseLayer = (id) => findLayerById(state.currentBaseStyle, id);

  const renderSelectedStyleLayer = () => {
    const layer = baseLayer(elements.styleLayerSelect.value);
    if (!layer) return;
    elements.styleLayerVisible.checked = layerVisibility(layer) !== "none";
    const property = editableColorProperties(layer)[0];
    elements.styleLayerColor.disabled = !state.styleEditorState.writable || !property;
    elements.styleLayerColor.value = property && property !== "icon-image"
      ? toHexColor(layer.paint?.[property]) ?? "#000000"
      : "#000000";
  };

  const renderStyleEditor = () => {
    const layers = state.styleEditorState.editableLayers ?? [];
    elements.styleLayerSelect.replaceChildren(...layers.map((layer) => {
      const option = document.createElement("option");
      option.value = layer.id;
      option.textContent = layer.id;
      return option;
    }));
    elements.styleLayerSelect.disabled = layers.length === 0;
    for (const [kind, input] of Object.entries(elements.styleKindInputs)) {
      input.disabled = !state.styleEditorState.writable || !layers.some((layer) => layer.colorKind === kind);
    }
    elements.styleLayerVisible.disabled = !state.styleEditorState.writable || layers.length === 0;
    elements.styleLayerColor.disabled = !state.styleEditorState.writable || layers.length === 0;
    elements.styleVerticalLongSound.disabled = !state.styleEditorState.writable;
    elements.styleVerticalLongSound.checked = verticalLongSoundAnnotationStyleEnabled(state.currentBaseStyle);
    elements.styleSave.disabled = !state.styleEditorState.writable || !state.styleDirty;
    elements.styleEditorStatus.textContent = state.styleEditorState.writable ? "保存できます" : "保存できません";
    renderSelectedStyleLayer();
  };

  const markStyleDirty = () => {
    state.styleDirty = true;
    elements.styleSave.disabled = !state.styleEditorState.writable;
    elements.styleEditorStatus.textContent = "未保存の変更があります";
  };

  const isLayerIconColor = (id) => {
    const layer = baseLayer(id);
    return Boolean(layer && editableColorProperties(layer).includes("icon-image"));
  };

  const isKindIconColor = (kind) => state.styleEditorState.editableLayers
    .some((layer) => layer.colorKind === kind && isLayerIconColor(layer.id));

  const applyLayerColor = async (id, color, dirty = true) => {
    setDetailTab("style-editor");
    const layer = baseLayer(id);
    if (!layer) return;
    const properties = editableColorProperties(layer);
    if (properties.includes("icon-image")) {
      const result = await recolorSpriteIcon({
        iconId: layer.layout["icon-image"],
        color,
        map: state.map,
        spriteState: state.spriteState,
        resourceUrl: api.resourceUrl,
      });
      state.spriteState = result.spriteState;
      layer.layout["icon-image"] = result.iconId;
      for (const layerId of getRuntimeLayerIds(id)) {
        state.map.setLayoutProperty(layerId, "icon-image", result.iconId);
      }
    } else {
      layer.paint = {...layer.paint};
      for (const property of properties) {
        layer.paint[property] = color;
        for (const layerId of getRuntimeLayerIds(id)) {
          state.map.setPaintProperty(layerId, property, color);
        }
      }
    }
    if (dirty) markStyleDirty();
  };

  const applyKindColor = async (kind, color) => {
    setDetailTab("style-editor");
    for (const layer of state.styleEditorState.editableLayers.filter((candidate) => candidate.colorKind === kind)) {
      await applyLayerColor(layer.id, color, false);
    }
    markStyleDirty();
  };

  const applyLayerVisibility = (id, visible) => {
    setDetailTab("style-editor");
    const layer = baseLayer(id);
    if (!layer) return;
    layer.layout = {...layer.layout, visibility: visible ? "visible" : "none"};
    for (const layerId of getRuntimeLayerIds(id)) {
      state.map.setLayoutProperty(layerId, "visibility", runtimeVisibility({dmVisible: elements.dmToggle.checked, layerVisible: visible}));
    }
    markStyleDirty();
  };

  const applyVerticalLongSoundAnnotationStyle = (enabled) => {
    setDetailTab("style-editor");
    setVerticalLongSoundAnnotationStyle(state.currentBaseStyle, enabled);
    for (const layer of state.currentBaseStyle.layers.filter((candidate) => candidate.source === "dm")) {
      const textField = layer.layout?.["text-field"];
      if (!textField || !Array.isArray(layer.layout?.["text-writing-mode"])) continue;
      if (!layer.layout["text-writing-mode"].includes("vertical")) continue;
      for (const layerId of getRuntimeLayerIds(layer.id)) {
        state.map.setLayoutProperty(layerId, "text-field", textField);
      }
    }
    markStyleDirty();
  };

  const loadStyleEditorState = async () => {
    state.styleEditorState = await api.styleEditorState();
    if (state.styleEditorState.style) {
      state.currentBaseStyle = state.styleEditorState.style;
    } else {
      state.styleEditorState = {
        ...state.styleEditorState,
        editableKinds: editableKinds(state.currentBaseStyle),
        editableLayers: editableLayers(state.currentBaseStyle),
      };
    }
    state.styleDirty = false;
    renderStyleEditor();
  };

  const saveStyleEditor = async (manifest) => {
    setDetailTab("style-editor");
    elements.styleEditorStatus.textContent = "保存中...";
    const style = createBundledStyle(state.currentBaseStyle, manifest);
    const sprites = state.spriteState?.dirty ? await spritePayload(state.spriteState) : undefined;
    await api.saveStyleEditorState({style, sprites});
    state.currentBaseStyle = style;
    state.styleEditorState.style = style;
    state.styleDirty = false;
    if (state.spriteState) state.spriteState.dirty = false;
    renderStyleEditor();
    elements.styleEditorStatus.textContent = "保存しました";
  };

  const loadFeaturePage = async (page = 1) => {
    if (!elements.featureLayerSelect.value) {
      clearFeatureList(elements.featureList, elements.featureListStatus, elements.featurePage, elements.featurePrev, elements.featureNext);
      return;
    }
    elements.featureListStatus.textContent = "読み込み中...";
    const result = await api.features({
      layer: elements.featureLayerSelect.value,
      page,
      pageSize: FEATURE_PAGE_SIZE,
    });
    state.currentFeaturePage = result.page;
    renderFeatureList({
      result,
      list: elements.featureList,
      status: elements.featureListStatus,
      page: elements.featurePage,
      prev: elements.featurePrev,
      next: elements.featureNext,
      onSelect: (feature) => {
        setDetailTab("feature-details");
        selectListedFeature(state.map, elements.properties, feature);
      },
    });
  };

  const loadStyle = async (manifest) => {
    const camera = state.map
      ? {center: state.map.getCenter().toArray(), zoom: state.map.getZoom()}
      : getInitialCamera(new URL(location.href), manifest.center);
    state.currentBaseStyle = await api.style(elements.select.value);
    const runtimeStyle = createRuntimeStyle(state.currentBaseStyle, manifest, {
      basemapVisible: elements.basemap.checked,
      dmVisible: elements.dmToggle.checked,
      resourceUrl: api.resourceUrl,
    });
    if (state.map) state.map.remove();
    state.map = new maplibregl.Map({
      container: "map",
      style: runtimeStyle,
      center: camera.center,
      zoom: camera.zoom,
      maxZoom: 24,
    });
    setupFeatureLayerOptions(elements.featureLayerSelect, runtimeStyle, {
      kind: elements.featureKindSelect.value,
      selectedLayer: featureLayerParameter(location),
    });
    updateFeatureLayerParameter(location, history, elements.featureLayerSelect.value);
    await loadStyleEditorState().catch((error) => {
      elements.styleEditorStatus.textContent = String(error);
      elements.styleSave.disabled = true;
    });
    state.map.addControl(new maplibregl.NavigationControl());
    state.map.on("load", () => addHighlightLayers(state.map));
    state.map.on("moveend", () => updateMapParameters(location, history, state.map));
    state.map.on("mousemove", (event) => updateStatus(elements.status, state.map, event));
    state.map.on("click", (event) => {
      const features = getClickedDmFeatures(state.map, event.point);
      setDetailTab("feature-details");
      renderHitFeatures({
        features,
        list: elements.hitList,
        status: elements.hitListStatus,
        onSelect: (feature) => {
          setDetailTab("feature-details");
          selectHitFeature(state.map, elements.properties, feature);
        },
      });
      setSelectedFeature(state.map, elements.properties, features[0] ? toGeoJsonFeature(features[0]) : undefined);
    });
    await loadFeaturePage(1).catch((error) => {
      elements.featureListStatus.textContent = String(error);
      elements.featureList.replaceChildren();
    });
  };

  const wireEvents = (manifest) => {
    const paintColorScheduler = createLatestAsyncScheduler({
      delay: 16,
      onError: (error) => {
        elements.styleEditorStatus.textContent = String(error);
      },
    });
    const iconColorScheduler = createLatestAsyncScheduler({
      delay: 180,
      onError: (error) => {
        elements.styleEditorStatus.textContent = String(error);
      },
    });
    elements.select.addEventListener("change", () => loadStyle(manifest));
    for (const [kind, input] of Object.entries(elements.styleKindInputs)) {
      input.addEventListener("input", () => {
        const scheduler = isKindIconColor(kind) ? iconColorScheduler : paintColorScheduler;
        scheduler.schedule(() => applyKindColor(kind, input.value));
      });
    }
    elements.styleLayerSelect.addEventListener("change", renderSelectedStyleLayer);
    elements.styleLayerVisible.addEventListener("change", () => applyLayerVisibility(elements.styleLayerSelect.value, elements.styleLayerVisible.checked));
    elements.styleVerticalLongSound.addEventListener("change", () => applyVerticalLongSoundAnnotationStyle(elements.styleVerticalLongSound.checked));
    elements.styleLayerColor.addEventListener("input", () => {
      const scheduler = isLayerIconColor(elements.styleLayerSelect.value) ? iconColorScheduler : paintColorScheduler;
      scheduler.schedule(() => applyLayerColor(elements.styleLayerSelect.value, elements.styleLayerColor.value));
    });
    elements.styleSave.addEventListener("click", () => {
      Promise.all([paintColorScheduler.flush(), iconColorScheduler.flush()])
        .then(() => saveStyleEditor(manifest))
        .catch((error) => {
          elements.styleEditorStatus.textContent = String(error);
        });
    });
    elements.tabStyleEditor.addEventListener("click", () => setDetailTab("style-editor"));
    elements.tabFeatureDetails.addEventListener("click", () => setDetailTab("feature-details"));
    elements.featureKindSelect.addEventListener("change", () => {
      setupFeatureLayerOptions(elements.featureLayerSelect, state.map.getStyle(), elements.featureKindSelect.value);
      updateFeatureLayerParameter(location, history, elements.featureLayerSelect.value);
      loadFeaturePage(1).catch((error) => {
        elements.featureListStatus.textContent = String(error);
        elements.featureList.replaceChildren();
      });
    });
    elements.featureLayerSelect.addEventListener("change", () => {
      updateFeatureLayerParameter(location, history, elements.featureLayerSelect.value);
      loadFeaturePage(1).catch((error) => {
        elements.featureListStatus.textContent = String(error);
        elements.featureList.replaceChildren();
      });
    });
    elements.featurePrev.addEventListener("click", () => loadFeaturePage(state.currentFeaturePage - 1).catch((error) => {
      elements.featureListStatus.textContent = String(error);
    }));
    elements.featureNext.addEventListener("click", () => loadFeaturePage(state.currentFeaturePage + 1).catch((error) => {
      elements.featureListStatus.textContent = String(error);
    }));
    elements.background.addEventListener("click", () => {
      state.dark = !state.dark;
      state.map.setPaintProperty("background", "background-color", state.dark ? "#20242a" : "#ffffff");
    });
    elements.basemap.addEventListener("change", () => {
      state.map.setLayoutProperty("gsi-pale", "visibility", elements.basemap.checked ? "visible" : "none");
    });
    elements.dmToggle.addEventListener("change", () => {
      for (const layer of state.map.getStyle().layers) {
        if (layer.source !== "dm") continue;
        const baseVisibility = layerVisibility(findBaseLayerForRuntime(state.currentBaseStyle, layer.id));
        state.map.setLayoutProperty(layer.id, "visibility", elements.dmToggle.checked ? baseVisibility : "none");
      }
      if (!elements.dmToggle.checked) setHighlightedFeature(state.map);
    });
  };

  const start = async () => {
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);
    const manifest = await api.manifest();
    const styles = manifest.styles ?? manifest.levels.map((level) => `maplibre/style-${level}.json`);
    for (const styleUrl of styles) {
      const option = document.createElement("option");
      option.value = api.resourceUrl(styleUrl);
      option.textContent = styleLabel(styleUrl, manifest);
      elements.select.append(option);
    }
    elements.select.disabled = styles.length === 1;
    wireEvents(manifest);
    setDetailTab(state.activeDetailTab);
    await loadStyle(manifest);
  };

  return {start};
};

const updateStatus = (status, map, event) => {
  const center = map.getCenter();
  status.textContent = `z${map.getZoom().toFixed(2)} center ${center.lng.toFixed(6)},${center.lat.toFixed(6)} cursor ${event.lngLat.lng.toFixed(6)},${event.lngLat.lat.toFixed(6)}`;
};

const updateMapParameters = (location, history, map) => {
  const center = map.getCenter();
  const url = new URL(location.href);
  url.searchParams.set("coords", `${center.lng},${center.lat}`);
  url.searchParams.set("scale", String(getScaleByZoom(map.getZoom(), center.lat)));
  history.replaceState("", "", url);
};

export const featureLayerParameter = (location) => new URL(location.href).searchParams.get(FEATURE_LAYER_PARAMETER) ?? "";

export const updateFeatureLayerParameter = (location, history, layer) => {
  const url = new URL(location.href);
  if (layer) {
    url.searchParams.set(FEATURE_LAYER_PARAMETER, layer);
  } else {
    url.searchParams.delete(FEATURE_LAYER_PARAMETER);
  }
  history.replaceState("", "", url);
};

const createLatestAsyncScheduler = ({delay, onError}) => {
  let latestTask = undefined;
  let timer = undefined;
  let running = false;
  let queuedWhileRunning = false;
  let activeTask = Promise.resolve();

  const requestRun = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void runLatest();
    }, delay);
  };

  const runLatest = async () => {
    if (running) {
      queuedWhileRunning = true;
      return activeTask;
    }
    const task = latestTask;
    if (!task) return;
    running = true;
    activeTask = (async () => {
      try {
        await task();
      } catch (error) {
        onError(error);
      } finally {
        running = false;
        if (queuedWhileRunning && latestTask !== task) {
          queuedWhileRunning = false;
          await runLatest();
        }
      }
    })();
    return activeTask;
  };

  return {
    flush: () => {
      clearTimeout(timer);
      return runLatest();
    },
    schedule: (task) => {
      latestTask = task;
      requestRun();
    },
  };
};
