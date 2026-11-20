import {inspectCatalogCenter, inspectNavigationTarget, inspectStyleNotice} from "../core/inspect-navigation.js";
import {featureCenter} from "../core/geometry.js";
import {inspectCodeOptions} from "../core/inspect-code-options.js";
import {parseFeatureInventory} from "../core/style-inventory.js";
import {getZoomByScale} from "../core/map-scale.js";
import {relatedQuery} from "../core/inspect-style.js";

export const createPreviewControls = ({app, document, fetch, location}) => {
  const base = new URL(".", location.href);
  const get = id => document.getElementById(id);
  let inventory;
  let selected;
  let navigationRevision = 0;
  let relationRevision = 0;
  const report = error => { get("feature-navigation-status").textContent = error.message ?? String(error); };
  const styleError = error => { get("style-editor-status").textContent = error.message ?? String(error); };
  const json = async (path, query = {}) => {
    const url = new URL(path, base); url.search = new URLSearchParams(query);
    const response = await fetch(url, {cache: "no-store"});
    if (!response.ok) throw new Error(`地物を読み込めません: HTTP ${response.status}`);
    return response.json();
  };
  const scale = () => Number(get("reference-scale").value);
  const navigate = async () => {
    const revision = ++navigationRevision;
    const code = get("feature-code").value;
    get("feature-navigation-status").textContent = "";
    if (!code) { await app.showFeatures({code}); return; }
    const target = inspectNavigationTarget(inventory, code, [scale()])
      ?? inspectNavigationTarget(inventory, code, app.manifest().levels);
    if (!target) {
      await app.showFeatures({code});
      app.selectFeature(undefined);
      get("feature-navigation-status").textContent = "このDMコードの地物は変換結果にありません。";
      return;
    }
    await app.showFeatures({code, layer: target.sourceLayer});
    const result = await json("api/features", {layer: target.sourceLayer, level: target.level, code, pageSize: 1});
    if (revision !== navigationRevision || !result.features[0]) return;
    const feature = result.features[0];
    app.selectFeature(feature);
    const map = app.map();
    const catalogCenter = app.manifest().geojson
      ? inspectCatalogCenter(await map.getSource("dm").getData(), code, target.level) : undefined;
    if (revision !== navigationRevision) return;
    const center = catalogCenter ?? feature.center ?? featureCenter(feature.geometry);
    map.stop();
    if (center) map.jumpTo({center, zoom: getZoomByScale(target.level, center[1])});
    get("feature-navigation-status").textContent = `DMコード${code}・レベル${target.level}の地物へ移動しました。${inspectStyleNotice(inventory, map.getStyle(), app.manifest(), code, target.level)}`;
  };
  const relations = async (page = 1) => {
    const query = relatedQuery(selected);
    if (!query) { get("feature-relations-status").textContent = "生成元の識別情報がありません。"; return; }
    const revision = ++relationRevision;
    const result = await json("api/related", {...query, page});
    if (revision !== relationRevision) return;
    const list = get("feature-relations-list"); list.replaceChildren();
    get("feature-relations-status").textContent = result.source ? "元地物と関連する補助図形" : "生成元を一意に特定できません。";
    for (const feature of [result.source, ...result.features].filter(Boolean)) {
      const button = document.createElement("button"); button.type = "button";
      button.textContent = `${feature.properties.DECORATION ?? "元地物"}: ${feature.tableName} / ${feature.properties.USER_ID}`;
      button.addEventListener("click", () => app.selectFeature(feature)); list.append(button);
    }
    for (const [label, destination] of [["前の補助図形", page - 1], ["次の補助図形", page + 1]]) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = label;
      button.disabled = destination < 1 || (destination - 1) * result.pageSize >= result.total;
      button.addEventListener("click", () => relations(destination).catch(report)); list.append(button);
    }
  };
  get("feature-code").addEventListener("change", () => navigate().catch(report));
  get("zoom-scale").addEventListener("click", () => {
    const map = app.map(); if (!map) return;
    map.stop(); map.setZoom(getZoomByScale(scale(), map.getCenter().lat));
  });
  get("style-reload").addEventListener("click", () => app.reload({standard: get("style-source").value === "standard"}).catch(styleError));
  get("sprite-reload").addEventListener("click", () => app.reloadSprites().catch(styleError));
  get("feature-relations").addEventListener("click", () => relations().catch(report));
  app.onSelection(feature => {
    selected = feature; relationRevision++;
    get("feature-relations").disabled = !feature;
    get("feature-relations-list").replaceChildren(); get("feature-relations-status").textContent = "";
  });
  return {
    refresh: async () => {
      navigationRevision++; relationRevision++;
      inventory = parseFeatureInventory(await json(app.manifest().featureInventory ?? "api/feature-inventory"));
      const code = get("feature-code"); const previous = code.value;
      code.replaceChildren();
      for (const item of [{value: "", label: "すべて"}, ...inspectCodeOptions(inventory, app.manifest().sourceLayers)]) {
        const option = document.createElement("option"); option.value = item.value; option.textContent = item.label; code.append(option);
      }
      if ([...code.options].some(option => option.value === previous)) code.value = previous;
      for (const id of ["feature-code", "reference-scale", "zoom-scale", "style-source", "style-reload", "sprite-reload"]) get(id).disabled = false;
    },
  };
};
