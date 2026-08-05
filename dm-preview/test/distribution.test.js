import assert from "node:assert/strict";
import {mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {test} from "node:test";
import {defaultDistributionPath, prepareDistribution} from "../src/node/distribution.js";

const manifest = {
  version: 1,
  layerName: "dm-sample",
  pmtiles: "dm-sample.pmtiles",
  levels: [2500],
  sourceLayers: ["dm_7100_point"],
  bounds: [130, 30, 140, 40],
  center: [135, 35, 15],
};

test("defaultDistributionPath separates preview data when a GeoPackage is present", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  await writeFile(path.join(root, "dm-sample.gpkg"), "geopackage");

  assert.equal(await defaultDistributionPath(root, manifest), path.join(root, "public"));
});

test("defaultDistributionPath keeps a clean bundle as the preview root", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-"));
  context.after(() => rm(root, {recursive: true, force: true}));

  assert.equal(await defaultDistributionPath(root, manifest), root);
});

test("prepareDistribution creates a clean bundle beside preview data", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const preview = path.join(root, "preview-data");
  const distribution = path.join(root, "public");
  await mkdir(preview);
  await writeFile(path.join(preview, "pmtiles-manifest.json"), JSON.stringify(manifest));
  await writeFile(path.join(preview, "dm-sample.pmtiles"), "pmtiles");
  await writeFile(path.join(preview, "dm-sample.gpkg"), "geopackage");

  const result = await prepareDistribution(preview, manifest, distribution);

  assert.equal(result.root, distribution);
  assert.deepEqual(result.manifest, manifest);
  assert.equal(await readFile(path.join(distribution, "dm-sample.pmtiles"), "utf8"), "pmtiles");
  await assert.rejects(stat(path.join(distribution, "dm-sample.gpkg")), /ENOENT/);
  await assert.rejects(stat(path.join(distribution, "style.json")), /ENOENT/);
  assert.deepEqual((await readdir(distribution)).sort(), [
    "dm-sample.pmtiles",
    "glyphs",
    "sprite",
  ]);
});

test("prepareDistribution carries a saved style into a clean distribution", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const preview = path.join(root, "preview-data");
  const distribution = path.join(root, "public");
  await mkdir(preview);
  await writeFile(path.join(preview, "pmtiles-manifest.json"), JSON.stringify(manifest));
  await writeFile(path.join(preview, "dm-sample.pmtiles"), "pmtiles");
  await writeFile(path.join(preview, "style.json"), JSON.stringify({
    version: 8,
    name: "saved-style",
    sources: {dm: {type: "vector", url: "pmtiles://./dm-sample.pmtiles"}},
    layers: [],
  }));

  const result = await prepareDistribution(preview, manifest, distribution);

  assert.equal(result.manifest.styles[0], "style.json");
  assert.equal(JSON.parse(await readFile(path.join(distribution, "style.json"), "utf8")).name, "saved-style");
});

test("prepareDistribution reuses an existing distribution bundle", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const preview = path.join(root, "preview-data");
  const distribution = path.join(root, "public");
  await mkdir(preview);
  await mkdir(distribution);
  await writeFile(path.join(preview, "pmtiles-manifest.json"), JSON.stringify(manifest));
  await writeFile(path.join(preview, "dm-sample.pmtiles"), "preview-pmtiles");
  await writeFile(path.join(distribution, "dm-sample.pmtiles"), "distribution-pmtiles");
  await writeFile(path.join(distribution, "style.json"), JSON.stringify({
    version: 8,
    name: "saved",
    metadata: {
      "dm:bounds": manifest.bounds,
      "dm:center": manifest.center,
      "dm:map-level": 2500,
      "dm:sourceLayers": manifest.sourceLayers,
    },
    sources: {dm: {type: "vector", url: "pmtiles://./dm-sample.pmtiles"}},
    layers: [],
  }));

  const result = await prepareDistribution(preview, manifest, distribution);

  assert.equal(result.root, distribution);
  assert.equal(result.manifest.styles[0], "style.json");
  assert.equal(await readFile(path.join(distribution, "dm-sample.pmtiles"), "utf8"), "distribution-pmtiles");
});
