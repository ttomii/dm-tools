import assert from "node:assert/strict";
import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {test} from "node:test";
import {parseManifest, readManifest} from "../src/node/manifest.js";
import {createBundle} from "../src/node/bundle.js";
import {prepareDistribution} from "../src/node/distribution.js";
import {loadDmiInfo, renderDmiInfo} from "../static/assets/browser/dmi-info.js";

const manifest = {
  version: 1, layerName: "sample", pmtiles: "sample.pmtiles", levels: [2500, 10000],
  sourceLayers: [], bounds: [138, 34, 139, 36], center: [138.5, 35, 15], dmiInfo: "metadata/dmi.json",
};
const index = {
  source: "fine/index.dmi", mapLevels: [2500], dmFiles: ["fine/01.dm"],
  zone: 8, planner: "静岡市", meshCount: 1, meshes: ["1"], classificationCount: 1,
  displacement: 0, interruption: 1, ruleYear: 2008, ruleName: "公共測量作業規程", formatVersion: 2, spareUsage: 0,
  classifications: [{usedCode: "9999", standardCode: "1103", types: [0, 1, 0, 0, 0, 0, 0, 0, 0],
    direction: 1, dimension: 3, description: "<img src=x onerror=alert(1)>"}],
};
const info = {version: 1, indexes: [index, {...index, source: "coarse/index.dmi", mapLevels: [10000]}]};

const createSource = async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-dmi-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const source = path.join(root, "source");
  await mkdir(path.join(source, "metadata"), {recursive: true});
  await writeFile(path.join(source, "pmtiles-manifest.json"), JSON.stringify(manifest));
  await writeFile(path.join(source, manifest.pmtiles), "pmtiles");
  await writeFile(path.join(source, manifest.dmiInfo), JSON.stringify(info));
  return {root, source};
};

test("DMI reference validates relative paths, missing files and symlink boundaries", async (context) => {
  assert.equal(parseManifest(manifest).dmiInfo, manifest.dmiInfo);
  for (const dmiInfo of ["../private.json", "/private.json", "a\\b.json", "", null, 123]) {
    assert.throws(() => parseManifest({...manifest, dmiInfo}));
  }
  const {root, source} = await createSource(context);
  assert.equal((await readManifest(source)).manifest.dmiInfo, manifest.dmiInfo);
  await rm(path.join(source, manifest.dmiInfo));
  await assert.rejects(readManifest(source), /manifest file is missing/);
  const outside = path.join(root, "outside.json");
  await writeFile(outside, "{}");
  await symlink(outside, path.join(source, manifest.dmiInfo));
  await assert.rejects(readManifest(source), /manifest path is not a file/);
  await assert.rejects(createBundle(path.join(source, manifest.pmtiles), path.join(root, "rejected")), /manifest path is not a file/);
});

test("bundle preserves DMI reference without the original input files", async (context) => {
  const {root, source} = await createSource(context);
  const output = path.join(root, "public");
  await createBundle(path.join(source, manifest.pmtiles), output);
  await rm(source, {recursive: true});
  const result = await readManifest(output);
  assert.equal(result.manifest.dmiInfo, "dmi-info.json");
  assert.deepEqual(result.manifest.styles, ["style.json"]);
  assert.deepEqual(JSON.parse(await readFile(path.join(output, result.manifest.dmiInfo))), info);
});

test("existing distribution persists refreshed DMI reference across restarts", async (context) => {
  const {root, source} = await createSource(context);
  const output = path.join(root, "public");
  await mkdir(output);
  const {dmiInfo: ignored, ...oldManifest} = manifest;
  await writeFile(path.join(output, "pmtiles-manifest.json"), JSON.stringify(oldManifest));
  await writeFile(path.join(output, manifest.pmtiles), "existing-pmtiles");
  await prepareDistribution(source, manifest, output);
  assert.equal((await readManifest(output)).manifest.dmiInfo, "dmi-info.json");
  assert.deepEqual(JSON.parse(await readFile(path.join(output, "dmi-info.json"))), info);
  assert.equal(await readFile(path.join(output, manifest.pmtiles), "utf8"), "existing-pmtiles");
  const updated = {...info, indexes: [index]};
  await writeFile(path.join(source, manifest.dmiInfo), JSON.stringify(updated));
  await prepareDistribution(source, manifest, output);
  assert.deepEqual(JSON.parse(await readFile(path.join(output, "dmi-info.json"))), updated);
});

const createContainer = () => {
  const document = {createElement: (tagName) => ({
    tagName, ownerDocument: document, children: [], textContent: "",
    setAttribute(name, value) { this.attributes ??= {}; this.attributes[name] = String(value); },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; this.textContent = ""; },
  })};
  return document.createElement("div");
};
const text = (element) => [element.textContent, ...element.children.map(text)].join(" ");

test("DMI view switches indexes and renders code mapping, directions and descriptions as text", () => {
  const container = createContainer();
  renderDmiInfo(container, info);
  assert.equal(container.children.length, 2);
  const [selector, details] = container.children;
  assert.equal(selector.tagName, "select");
  assert.equal(selector.attributes["aria-label"], "DMI情報の切り替え");
  assert.match(text(selector.children[0]), /2500.*fine\/index.dmi/);
  assert.match(text(selector.children[1]), /10000.*coarse\/index.dmi/);
  assert.match(text(details), /2500.*fine\/index.dmi/);
  assert.doesNotMatch(text(details), /coarse\/index.dmi/);
  selector.value = "1";
  selector.onchange();
  assert.match(text(details), /10000.*coarse\/index.dmi/);
  assert.doesNotMatch(text(details), /fine\/index.dmi/);
  assert.match(text(container), /9999.*1103.*線.*独自.*3次元/);
  assert.match(text(container), /<img src=x onerror=alert\(1\)>/);
  renderDmiInfo(container, {version: 1, indexes: [{...index, mapLevels: [], dmFiles: []}]});
  assert.match(text(container), /未確認/);
});

test("DMI loading distinguishes absent metadata, failures and unsupported versions", async () => {
  const container = createContainer();
  await loadDmiInfo(container, {}, {});
  assert.match(container.textContent, /DMI情報はありません/);
  await loadDmiInfo(container, manifest, {
    resourceUrl: (value) => value, style: async () => { throw new Error("404"); },
  });
  assert.match(container.textContent, /読み込めません: 404/);
  await loadDmiInfo(container, manifest, {resourceUrl: (value) => value, style: async () => ({version: 2})});
  assert.match(container.textContent, /未対応/);
  await loadDmiInfo(container, manifest, {resourceUrl: (value) => value, style: async () => info});
  assert.match(text(container), /静岡市/);
});
