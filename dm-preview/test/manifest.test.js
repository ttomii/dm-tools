import assert from "node:assert/strict";
import {mkdir, mkdtemp, rm, symlink, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {test} from "node:test";
import {parseManifest, readManifest} from "../src/node/manifest.js";

const validManifest = {
  version: 1,
  layerName: "dm-sample",
  pmtiles: "dm-sample.pmtiles",
  levels: [2500, 5000],
  sourceLayers: ["dm_2100_line", "dm_3001_polygon", "dm_2205_line_deco_line"],
  bounds: [130, 30, 140, 40],
  center: [135, 35, 15],
};

test("parseManifest accepts version one contract", () => {
  assert.deepEqual(parseManifest(validManifest), validManifest);
  assert.deepEqual(parseManifest({...validManifest, styles: ["style.json"]}), {
    ...validManifest,
    styles: ["style.json"],
  });
});

test("parseManifest rejects invalid coordinates, levels, and paths", () => {
  assert.throws(() => parseManifest({...validManifest, pmtiles: "../sample.pmtiles"}));
  assert.throws(() => parseManifest({...validManifest, bounds: [140, 30, 130, 40]}));
  assert.throws(() => parseManifest({...validManifest, center: [135, 35, 25]}));
  assert.throws(() => parseManifest({...validManifest, levels: []}));
  assert.throws(() => parseManifest({...validManifest, levels: [2500.5]}));
  assert.throws(() => parseManifest({...validManifest, levels: "2500"}));
  assert.throws(() => parseManifest({...validManifest, sourceLayers: "dm_2100_line"}));
  assert.throws(() => parseManifest({...validManifest, sourceLayers: ["dm_default_line"]}));
  assert.throws(() => parseManifest({...validManifest, styles: []}));
  assert.throws(() => parseManifest({...validManifest, styles: ["../style.json"]}));
});

test("readManifest requires the referenced pmtiles file", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const output = path.join(root, "output");
  await mkdir(output);
  await writeFile(`${output}/pmtiles-manifest.json`, JSON.stringify(validManifest));
  await assert.rejects(readManifest(output), /manifest file is missing: dm-sample.pmtiles/);
});

test("readManifest rejects symlinks escaping output", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const output = path.join(root, "output");
  const outside = path.join(root, "outside.pmtiles");
  await mkdir(output);
  await writeFile(outside, "");
  await writeFile(`${output}/pmtiles-manifest.json`, JSON.stringify(validManifest));
  await symlink(outside, `${output}/dm-sample.pmtiles`);
  await assert.rejects(readManifest(output), /manifest path is not a file/);
});

test("readManifest derives preview manifest from style bundle", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const output = path.join(root, "output");
  await mkdir(output);
  await writeFile(path.join(output, "dm-sample.pmtiles"), "");
  await writeFile(path.join(output, "style.json"), JSON.stringify({
    version: 8,
    name: "DM 2500",
    metadata: {
      "dm:map-level": 2500,
      "dm:bounds": validManifest.bounds,
      "dm:center": validManifest.center,
      "dm:sourceLayers": validManifest.sourceLayers,
    },
    sources: {
      dm: {type: "vector", url: "pmtiles://./dm-sample.pmtiles"},
    },
    layers: [],
  }));

  const {manifest} = await readManifest(output);
  assert.deepEqual(manifest, {
    ...validManifest,
    layerName: "DM 2500",
    pmtiles: "dm-sample.pmtiles",
    levels: [2500],
    styles: ["style.json"],
  });
});

test("readManifest exposes saved style beside converter manifest", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const output = path.join(root, "output");
  await mkdir(output);
  await writeFile(path.join(output, "dm-sample.pmtiles"), "");
  await writeFile(path.join(output, "pmtiles-manifest.json"), JSON.stringify(validManifest));
  await writeFile(path.join(output, "style.json"), JSON.stringify({
    version: 8,
    sources: {
      dm: {type: "vector", url: "pmtiles://./dm-sample.pmtiles"},
    },
    layers: [],
  }));

  const {manifest} = await readManifest(output);
  assert.deepEqual(manifest, {...validManifest, styles: ["style.json"]});
});
