import {createBrowserPreviewApp} from "./browser/browser-preview-app.js";

const app = createBrowserPreviewApp({
  elements: resolveElements(document),
  location,
  history,
  maplibregl: window.maplibregl,
  pmtiles: window.pmtiles,
  fetch: window.fetch.bind(window),
});

app.start().catch((error) => {
  document.getElementById("status").textContent = String(error);
});

const resolveElements = (document) => ({
  status: document.getElementById("status"),
  select: document.getElementById("style"),
  background: document.getElementById("background"),
  basemap: document.getElementById("basemap"),
  dmToggle: document.getElementById("dm"),
  properties: document.getElementById("properties"),
  featureKindSelect: document.getElementById("feature-kind"),
  featureLayerSelect: document.getElementById("feature-layer"),
  featureList: document.getElementById("feature-list"),
  featureListStatus: document.getElementById("feature-list-status"),
  featurePage: document.getElementById("feature-page"),
  featurePrev: document.getElementById("feature-prev"),
  featureNext: document.getElementById("feature-next"),
  hitListStatus: document.getElementById("hit-list-status"),
  hitList: document.getElementById("hit-list"),
  tabStyleEditor: document.getElementById("tab-style-editor"),
  tabFeatureDetails: document.getElementById("tab-feature-details"),
  styleEditorPanel: document.getElementById("style-editor"),
  featureDetailsPanel: document.getElementById("feature-details"),
  styleEditorStatus: document.getElementById("style-editor-status"),
  styleSave: document.getElementById("style-save"),
  styleLayerSelect: document.getElementById("style-layer"),
  styleLayerVisible: document.getElementById("style-layer-visible"),
  styleLayerColor: document.getElementById("style-layer-color"),
  styleKindInputs: {
    icon: document.getElementById("style-kind-icon"),
    line: document.getElementById("style-kind-line"),
    polygon: document.getElementById("style-kind-polygon"),
    text: document.getElementById("style-kind-text"),
  },
});
