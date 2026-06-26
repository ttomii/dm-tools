import {createBrowserPreviewApp} from "./browser/browser-preview-app.js";

const app = createBrowserPreviewApp({
  document,
  location,
  history,
  maplibregl: window.maplibregl,
  pmtiles: window.pmtiles,
  fetch: window.fetch.bind(window),
});

app.start().catch((error) => {
  document.getElementById("status").textContent = String(error);
});
