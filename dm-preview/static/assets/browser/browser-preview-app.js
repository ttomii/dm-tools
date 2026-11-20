import {diagnosticStyle, applyInspectMode} from "../core/inspect-style.js";
import {createInventoryView} from "./style-inventory.js";
import {loadDmiInfo} from "./dmi-info.js";
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
import {createBundledStyle, createRuntimeStyle, splitAnnotationStyleLayers, styleLabel} from "../core/style-transform.js";
import {createLevelStyle, presentationLevel} from "../core/level-style.js";
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

export const canSaveStyle = (styleEditorState, styleDirty) =>
  styleEditorState.writable && (styleDirty || !styleEditorState.style);

export const createBrowserPreviewApp = ({elements, location, history, maplibregl, pmtiles, fetch}) => {
  const appBase = new URL(".", location.href);
  const api = createApiClient({appBase, fetch});
  const state = {
    map: undefined,
    manifest: undefined,
    inspection: undefined,
    featureCode: "",
    selectedFeature: undefined,
    currentFeaturePage: 1,
    currentBaseStyle: undefined,
    inventoryView: undefined,
    styleEditorState: {writable: false, editableLayers: []},
    spriteState: undefined,
    spriteRevision: 0,
    styleDirty: false,
    activeDetailTab: "style-editor",
  };

  let styleRevision = 0;
  let featureRevision = 0;
  const selectionListeners = new Set();
  const rememberSelection = (feature) => {
    state.selectedFeature = feature;
    for (const listener of selectionListeners) listener(feature);
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

  const setListTab = (tab) => {
    const isDmiInfo = tab === "dmi-info";
    elements.featureListPanel.hidden = isDmiInfo;
    elements.dmiInfoPanel.hidden = !isDmiInfo;
    elements.tabFeatureList.setAttribute("aria-selected", String(!isDmiInfo));
    elements.tabDmiInfo.setAttribute("aria-selected", String(isDmiInfo));
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
    state.inventoryView?.setStyle(state.currentBaseStyle);
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
    elements.styleSave.disabled = !canSaveStyle(state.styleEditorState, state.styleDirty);
    elements.styleEditorStatus.textContent = state.styleEditorState.writable ? "保存できます" : "保存できません";
    renderSelectedStyleLayer();
  };

  const markStyleDirty = () => {
    state.inventoryView?.setStyle(state.currentBaseStyle);
    state.styleDirty = true;
    elements.styleSave.disabled = !canSaveStyle(state.styleEditorState, state.styleDirty);
    elements.styleEditorStatus.textContent = "未保存の変更があります";
  };

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

  const loadStyleEditorState = async (manifest) => {
    const editorState = await api.styleEditorState();
    const style = editorState.style ?? state.currentBaseStyle;
    state.currentBaseStyle = usesCommonAnnotationSourceLayer(manifest)
      ? splitAnnotationStyleLayers(style)
      : style;
    state.styleEditorState = {
      ...editorState,
      style: editorState.style ? state.currentBaseStyle : editorState.style,
      editableKinds: editableKinds(state.currentBaseStyle),
      editableLayers: editableLayers(state.currentBaseStyle),
    };
    state.styleDirty = false;
    renderStyleEditor();
  };

  const saveStyleEditor = async (manifest) => {
    setDetailTab("style-editor");
    elements.styleEditorStatus.textContent = "保存中...";
    const style = createBundledStyle(state.currentBaseStyle, manifest);
    const sprites = state.spriteState?.dirty ? await spritePayload(state.spriteState) : undefined;
    await api.saveStyleEditorState({style, sprites});
    if (sprites) api.useStandardSprites(false);
    state.currentBaseStyle = usesCommonAnnotationSourceLayer(manifest)
      ? splitAnnotationStyleLayers(style)
      : style;
    state.styleEditorState = {
      ...state.styleEditorState,
      style: state.currentBaseStyle,
      editableKinds: editableKinds(state.currentBaseStyle),
      editableLayers: editableLayers(state.currentBaseStyle),
    };
    state.styleDirty = false;
    if (state.spriteState) state.spriteState.dirty = false;
    renderStyleEditor();
    elements.styleEditorStatus.textContent = "保存しました";
  };

  const loadFeaturePage = async (page = 1) => {
    const revision = ++featureRevision;
    if (!elements.featureLayerSelect.value) {
      clearFeatureList(elements.featureList, elements.featureListStatus, elements.featurePage, elements.featurePrev, elements.featureNext);
      return;
    }
    elements.featureListStatus.textContent = "読み込み中...";
    const result = await api.features({
      layer: elements.featureLayerSelect.value,
      page,
      pageSize: FEATURE_PAGE_SIZE,
      ...(state.inspection?.level ? {level: state.inspection.level} : {}),
      ...(state.featureCode ? {code: state.featureCode} : {}),
    });
    if (revision !== featureRevision) return;
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
        rememberSelection(feature);
        selectListedFeature(state.map, elements.properties, feature);
      },
    });
  };

  const backgroundPaint = () => ({
    "background-color": elements.background.value,
    "background-opacity": Number(elements.backgroundOpacity.value) / 100,
  });

  const applyBackground = () => {
    elements.backgroundOpacityValue.textContent = `${elements.backgroundOpacity.value}%`;
    for (const [property, value] of Object.entries(backgroundPaint())) {
      state.map.setPaintProperty("background", property, value);
    }
  };

  const loadStyle = async (manifest, {standard = false, preserveStyle = false} = {}) => {
    const revision = ++styleRevision;
    featureRevision++;
    const camera = state.map
      ? {center: state.map.getCenter().toArray(), zoom: state.map.getZoom()}
      : getInitialCamera(new URL(location.href), manifest.center);
    if (!preserveStyle) state.currentBaseStyle = elements.select.value === "diagnostic"
      ? diagnosticStyle(manifest)
      : elements.select.value === "automatic"
      ? createLevelStyle(Object.fromEntries(await Promise.all(
        [...new Set(manifest.levels.map(presentationLevel))].map(async (level) => [
          level, await api.style(api.resourceUrl(`maplibre/style-${level}.json`)),
        ]),
      )), manifest, {automatic: !manifest.geojson && !state.inspection?.formalOnly})
      : await api.style(elements.select.value);
    if (!preserveStyle && !standard && elements.select.value !== "diagnostic") await loadStyleEditorState(manifest).catch((error) => {
      elements.styleEditorStatus.textContent = String(error);
      elements.styleSave.disabled = true;
      state.currentBaseStyle = usesCommonAnnotationSourceLayer(manifest)
        ? splitAnnotationStyleLayers(state.currentBaseStyle)
        : state.currentBaseStyle;
    });
    if (standard || elements.select.value === "diagnostic") {
      state.styleEditorState = {...state.styleEditorState, writable: true,
        editableKinds: editableKinds(state.currentBaseStyle), editableLayers: editableLayers(state.currentBaseStyle)};
      renderStyleEditor();
    }
    state.inventoryView?.setStyle(state.currentBaseStyle);
    const displayStyle = state.inspection?.mode === "original" || state.inspection?.mode === "generated"
      ? diagnosticStyle(manifest) : state.currentBaseStyle;
    const runtimeStyle = createRuntimeStyle(applyInspectMode(displayStyle, state.inspection), manifest, {
      basemapVisible: elements.basemap.checked,
      dmVisible: elements.dmToggle.checked,
      mergeAnnotationLayers: false,
      resourceUrl: api.resourceUrl,
      styleUrl: elements.select.value,
    });
    let background = runtimeStyle.layers.find((layer) => layer.id === "background");
    if (!background) {
      background = {id: "background", type: "background"};
      runtimeStyle.layers.unshift(background);
    }
    background.paint = {...background.paint, ...backgroundPaint()};
    if (state.inspection || state.spriteRevision) runtimeStyle.sprite += `?v=${state.spriteRevision || Date.now()}`;
    if (revision !== styleRevision) return;
    if (state.map) state.map.remove();
    state.map = new maplibregl.Map({
      container: "map",
      style: runtimeStyle,
      center: camera.center,
      zoom: camera.zoom,
      maxZoom: 24,
      localIdeographFontFamily: false,
    });
    setupFeatureLayerOptions(elements.featureLayerSelect, runtimeStyle, {
      kind: elements.featureKindSelect.value,
      query: elements.featureLayerFilter.value,
      selectedLayer: featureLayerParameter(location),
    });
    updateFeatureLayerParameter(location, history, elements.featureLayerSelect.value);
    state.map.addControl(new maplibregl.NavigationControl());
    state.map.on("load", () => {
      if (revision !== styleRevision) return;
      addHighlightLayers(state.map);
      if (state.selectedFeature) setSelectedFeature(state.map, elements.properties, toGeoJsonFeature(state.selectedFeature));
    });
    updateStatus(elements.status, state.map);
    state.map.on("move", () => updateStatus(elements.status, state.map));
    state.map.on("moveend", () => updateMapParameters(location, history, state.map));
    state.map.on("click", (event) => {
      const features = getClickedDmFeatures(state.map, event.point);
      setDetailTab("feature-details");
      renderHitFeatures({
        features,
        list: elements.hitList,
        status: elements.hitListStatus,
        onSelect: (feature) => {
          setDetailTab("feature-details");
          rememberSelection(feature);
          selectHitFeature(state.map, elements.properties, feature);
        },
      });
      rememberSelection(features[0]);
      setSelectedFeature(state.map, elements.properties, features[0] ? toGeoJsonFeature(features[0]) : undefined);
    });
    await loadFeaturePage(1).catch((error) => {
      elements.featureListStatus.textContent = String(error);
      elements.featureList.replaceChildren();
    });
  };

  const wireEvents = () => {
    const colorChangeScheduler = createLatestAsyncScheduler({
      delay: 16,
      onError: (error) => {
        elements.styleEditorStatus.textContent = String(error);
      },
    });
    elements.select.addEventListener("change", () => loadStyle(state.manifest));
    for (const [kind, input] of Object.entries(elements.styleKindInputs)) {
      input.addEventListener("change", () => {
        colorChangeScheduler.schedule(() => applyKindColor(kind, input.value));
      });
    }
    elements.styleLayerSelect.addEventListener("change", renderSelectedStyleLayer);
    elements.styleLayerVisible.addEventListener("change", () => applyLayerVisibility(elements.styleLayerSelect.value, elements.styleLayerVisible.checked));
    elements.styleVerticalLongSound.addEventListener("change", () => applyVerticalLongSoundAnnotationStyle(elements.styleVerticalLongSound.checked));
    elements.styleLayerColor.addEventListener("change", () => {
      colorChangeScheduler.schedule(() => applyLayerColor(elements.styleLayerSelect.value, elements.styleLayerColor.value));
    });
    elements.styleSave.addEventListener("click", () => {
      colorChangeScheduler.flush()
        .then(() => saveStyleEditor(state.manifest))
        .catch((error) => {
          elements.styleEditorStatus.textContent = String(error);
        });
    });
    elements.featureKindSelect.addEventListener("change", () => {
      setupFeatureLayerOptions(elements.featureLayerSelect, state.map.getStyle(), {
        kind: elements.featureKindSelect.value,
        query: elements.featureLayerFilter.value,
      });
      updateFeatureLayerParameter(location, history, elements.featureLayerSelect.value);
      loadFeaturePage(1).catch((error) => {
        elements.featureListStatus.textContent = String(error);
        elements.featureList.replaceChildren();
      });
    });
    elements.featureLayerFilter.addEventListener("input", () => {
      setupFeatureLayerOptions(elements.featureLayerSelect, state.map.getStyle(), {
        kind: elements.featureKindSelect.value,
        query: elements.featureLayerFilter.value,
      });
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
    elements.background.addEventListener("input", applyBackground);
    elements.backgroundOpacity.addEventListener("input", applyBackground);
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
    wireEvents();
    setDetailTab(state.activeDetailTab);
    await reload();
  };

  const reload = async ({dataChanged = false, standard = false} = {}) => {
    if (dataChanged) {
      rememberSelection(undefined); elements.properties.replaceChildren(); elements.hitList.replaceChildren();
    }
    const manifest = await api.manifest();
    state.manifest = manifest;
    state.inventoryView = createInventoryView(elements.styleInventory, manifest);
    await Promise.all([loadDmiInfo(elements.dmiContent, manifest, api), state.inventoryView.load(api)]);
    const previousStyle = elements.select.value;
    elements.select.replaceChildren();
    const styles = (manifest.styles ?? ["automatic"]).filter((style) => !state.inspection?.formalOnly || style !== "diagnostic");
    for (const styleUrl of styles) {
      const option = document.createElement("option");
      option.value = ["automatic", "diagnostic"].includes(styleUrl) ? styleUrl : api.resourceUrl(styleUrl);
      option.textContent = styleUrl === "diagnostic" ? "原形状（診断用）"
        : styleUrl === "automatic" ? (manifest.geojson || state.inspection?.formalOnly ? "正式図式" : "自動（縮尺で切り替え）") : styleLabel(styleUrl, manifest);
      elements.select.append(option);
    }
    if (elements.select.options && [...elements.select.options].some((option) => option.value === previousStyle)) elements.select.value = previousStyle;
    elements.select.disabled = styles.length === 1;
    await loadStyle(manifest, {standard});
  };

  elements.tabFeatureList.addEventListener("click", () => setListTab("feature-list"));
  elements.tabDmiInfo.addEventListener("click", () => setListTab("dmi-info"));
  elements.tabStyleEditor.addEventListener("click", () => setDetailTab("style-editor"));
  elements.tabFeatureDetails.addEventListener("click", () => setDetailTab("feature-details"));

  return {start, reload, reloadSprites: async () => {
    api.useStandardSprites(); state.spriteState = undefined;
    state.spriteRevision = Math.max(Date.now(), state.spriteRevision + 1);
    if (state.manifest) await loadStyle(state.manifest, {preserveStyle: true});
  }, map: () => state.map, manifest: () => state.manifest,
    inspect: async (options) => { state.inspection = options; if (state.manifest) await loadStyle(state.manifest, {preserveStyle: true}); },
    onSelection: (listener) => selectionListeners.add(listener),
    showFeatures: async ({code, layer}) => {
      state.featureCode = code;
      if (layer) elements.featureLayerSelect.value = layer;
      updateFeatureLayerParameter(location, history, elements.featureLayerSelect.value);
      await loadFeaturePage(1);
    },
    selectFeature: (feature) => {
      rememberSelection(feature); setDetailTab("feature-details");
      if (!feature) {
        setSelectedFeature(state.map, elements.properties, undefined);
        elements.hitList.replaceChildren(); elements.hitListStatus.textContent = "";
        return;
      }
      selectListedFeature(state.map, elements.properties, feature);
    },
  };
};

const usesCommonAnnotationSourceLayer = (manifest) => manifest.sourceLayers?.includes("dm_annotation") ?? false;

export const updateStatus = (status, map) => {
  const center = map.getCenter();
  status.textContent = `z${map.getZoom().toFixed(2)} center ${center.lng.toFixed(6)},${center.lat.toFixed(6)}`;
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
