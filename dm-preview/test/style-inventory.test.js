import assert from "node:assert/strict";
import {test} from "node:test";
import {readFile} from "node:fs/promises";
import {createStyleInventory, parseFeatureInventory} from "../src/core/style-inventory.js";
import {styleOrigin, withStyleOrigins} from "../src/core/style-origin.js";
import {createBundledStyle, mergeAnnotationStyleLayers, splitAnnotationStyleLayers} from "../src/core/style-transform.js";
import {createLevelStyle} from "../src/core/level-style.js";
import {createInventoryView} from "../static/assets/browser/style-inventory.js";
const manifest = {levels: [2500, 5000], sourceLayers: ["dm_9999_line", "dm_1101_line", "dm_annotation"], pmtiles: "test.pmtiles", center: [138, 35, 15]};
const entry = (dmCode, more = {}) => ({level: 2500, dmCode, kind: "line", sourceLayer: `dm_${dmCode}_line`, count: 1, decoration: null, srcLayer: null, ...more});
const layer = (id, sourceLayer, origin, filter) => ({id, source: "dm", "source-layer": sourceLayer, type: "line", filter,
  metadata: origin ? {"dm:style-origin": origin} : {}, layout: {visibility: "none"}, minzoom: 20});
const style = (layers) => ({version: 8, sources: {dm: {type: "vector"}}, layers});
const inventory = (entries) => parseFeatureInventory({version: 1, entries});
const generated = entry(7212, {sourceLayer: "dm_7212_line_deco_line", decoration: "line_symbol", srcLayer: "dm_7212_line_08_2500"});

test("sorts missing definitions before individual or generated rows and then unknown", () => {
  const rows = createStyleInventory(inventory([entry(9999), entry(1101), entry(8888), generated, entry(7777)]), style([
    layer("fallback", "dm_default_line", "default", ["!", ["in", ["get", "DMCODE"], ["literal", [1101, 8888, 7212, 7777]]]]),
    layer("specific", "dm_1101_line", "individual"), layer("external", "dm_7777_line"),
  ]), manifest);
  assert.deepEqual(rows.map((row) => [row.dmCode, row.group, row.entries[0].status]), [
    [8888, 0, "missing"], [9999, 0, "default"], [1101, 1, "individual"], [7212, 1, "missing"], [7777, 2, "unknown"],
  ]);
  assert.equal(rows[3].generated, true);
  const partial = createStyleInventory(inventory([entry(1101)]), style([
    layer("specific", "dm_1101_line", "individual"), layer("external", "dm_1101_line"),
  ]), manifest)[0];
  assert.equal(partial.group, 1);
  assert.equal(partial.partial, true);
  assert.equal(partial.entries[0].status, "unknown");

});

test("annotation matching uses code and level and preserves partial definitions", () => {
  const annotation = (origin, codes) => ({...layer(origin, "dm_annotation", origin, ["all", ["==", ["get", "LEVEL"], 2500],
    ["in", ["get", "DMCODE"], ["literal", codes]], ["!=", ["get", "VERTICAL"], 1]]), type: "symbol", layout: {"text-field": ["get", "TEXT"]}});
  const rows = createStyleInventory(inventory([entry(7101, {kind: "text", sourceLayer: "dm_annotation"}),
    entry(7102, {kind: "text", sourceLayer: "dm_annotation"}), entry(7101, {level: 5000, kind: "text", sourceLayer: "dm_annotation"})]),
  style([annotation("individual", [7101]), annotation("default", [7101])]), manifest);
  assert.deepEqual(rows.map((row) => [row.level, row.dmCode, row.entries[0].status]), [[2500, 7102, "missing"], [5000, 7101, "missing"], [2500, 7101, "mixed"]]);
});

test("old data and unsupported filters are unknown, invalid inventories are rejected", () => {
  const rows = createStyleInventory(inventory([entry(1101)]), style([layer("custom", "dm_1101_line", "individual", ["==", ["to-number", ["get", "DMCODE"]], 1101])]), manifest);
  assert.equal(rows[0].group, 2);
  const old = createStyleInventory({complete: false}, style([]), manifest);
  assert.equal(old.length, 4);
  assert.ok(old.every((row) => row.group === 2 && !row.complete));
  assert.deepEqual(inventory([]), {version: 1, entries: [], complete: true});
  for (const value of [{version: 2, entries: []}, {version: 1}, {version: 1, entries: [entry(1, {count: 0})]}]) assert.throws(() => parseFeatureInventory(value));
});

test("provenance survives level composition, expansion, editing, saving and annotation merging", async () => {
  assert.equal(styleOrigin(layer("dm-default-line-2500-line-level-2500-9999", "dm_9999_line")), "default");
  assert.equal(styleOrigin(layer("dm-1101-line-2500-line-level-2500", "dm_1101_line")), "individual");
  assert.equal(styleOrigin(layer("arbitrary", "dm_1101_line")), "unknown");
  const annotation = (id, code, origin) => ({...layer(id, "dm_annotation", origin, ["==", ["get", "DMCODE"], code]), type: "symbol", layout: {"text-field": ["get", "TEXT"]}});
  const merged = mergeAnnotationStyleLayers(style([annotation("a", 1, "individual"), annotation("b", 2, "default"), annotation("c", 3, "individual")]));
  assert.equal(merged.layers.length, 2);
  assert.equal(splitAnnotationStyleLayers(merged).layers.length, 3);
  const template = JSON.parse(await readFile(new URL("../static/maplibre/style-2500.json", import.meta.url)));
  const saved = createBundledStyle(createLevelStyle({2500: template, 5000: template}, manifest), manifest);
  assert.equal(saved.layers.find((item) => item.id.includes("default-line") && item["source-layer"] === "dm_9999_line").metadata["dm:style-origin"], "default");
  const clone = JSON.parse(JSON.stringify(saved));
  clone.layers.forEach((item) => { item.paint = {"line-color": "#123456"}; });
  assert.deepEqual(createStyleInventory(inventory([entry(9999), entry(1101)]), clone, manifest).map((row) => [row.group, row.entries[0].status]), [[0, "default"], [1, "individual"]]);
  assert.equal(withStyleOrigins(style([layer("x", "dm_default_line")])).layers[0].metadata["dm:style-origin"], "default");
});

const container = () => {
  const document = {createElement: (tagName) => ({tagName, ownerDocument: document, children: [], textContent: "", value: "", handlers: {},
    setAttribute(name, value) { this[name] = value; }, addEventListener(name, handler) { this.handlers[name] = handler; },
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; this.textContent = ""; },
  })};
  return document.createElement("div");
};
const text = (node) => [node.textContent, ...node.children.map(text)].join(" ");

test("view shows generated sources, grouping, filters and unsaved changes without DMI", async () => {
  const target = container();
  const view = createInventoryView(target, {...manifest, featureInventory: "api/feature-inventory"});
  await view.load({resourceUrl: (path) => path, style: async () => inventory([entry(9999), generated])});
  view.setStyle(style([layer("fallback", "dm_default_line", "default")]));
  assert.ok(text(target).indexOf("個別定義なし（") < text(target).indexOf("個別定義あり／自動生成図形あり（"));
  assert.match(text(target), /line_symbol.*線.*描画定義なし/);
  assert.match(text(target), /生成元: dm_7212_line_08_2500/);
  const [search, level, group] = target.children[0].children;
  search.value = "7212"; search.handlers.input();
  assert.doesNotMatch(text(target.children[2]), /9999/);
  level.value = "5000"; level.handlers.change();
  assert.match(text(target), /該当するDMコードはありません/);
  level.value = ""; search.value = ""; group.value = "0"; group.handlers.change();
  assert.doesNotMatch(text(target.children[2]), /7212/);
  group.value = "";
  view.setStyle(style([layer("individual", "dm_9999_line", "individual")]));
  assert.doesNotMatch(text(target.children[2]), /個別定義なし（/);
});

test("absent and failed inventory loads still render old data as unknown", async () => {
  for (const metadata of [{}, {featureInventory: "api/feature-inventory"}]) {
    const target = container();
    const view = createInventoryView(target, {...manifest, ...metadata});
    await view.load({resourceUrl: (path) => path, style: async () => { throw new Error("unavailable"); }});
    view.setStyle(style([]));
    assert.match(text(target), /判定不明/);
    if (metadata.featureInventory) assert.match(text(target), /読み込めません.*unavailable/);
  }
});
