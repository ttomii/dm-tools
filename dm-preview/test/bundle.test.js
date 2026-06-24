import assert from "node:assert/strict";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {test} from "node:test";
import {createBundle} from "../src/bundle.js";

const manifest = {
  version: 1,
  layerName: "dm-sample",
  pmtiles: "dm-sample.pmtiles",
  levels: [2500],
  sourceLayers: ["dm_7100_point"],
  bounds: [130, 30, 140, 40],
  center: [135, 35, 15],
};

test("createBundle copies preview assets and rewrites pmtiles path", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const source = path.join(root, "source");
  const output = path.join(root, "public");
  await mkdir(source, {recursive: true});
  await writeFile(path.join(source, "pmtiles-manifest.json"), JSON.stringify(manifest));
  await writeFile(path.join(source, "dm-sample.pmtiles"), "pmtiles");

  const destination = await createBundle(path.join(source, "dm-sample.pmtiles"), output);
  const bundledManifest = JSON.parse(await readFile(path.join(output, "pmtiles-manifest.json"), "utf8"));

  assert.equal(destination, output);
  assert.equal(bundledManifest.pmtiles, "dm-sample.pmtiles");
  assert.equal(await readFile(path.join(output, "dm-sample.pmtiles"), "utf8"), "pmtiles");
  assert.match(await readFile(path.join(output, "index.html"), "utf8"), /DM MapLibre Preview/);
  assert.match(await readFile(path.join(output, "assets", "app.js"), "utf8"), /pmtiles-manifest/);
  assert.ok(await readFile(path.join(output, "vendor", "maplibre-gl.js")));
  assert.ok(await readFile(path.join(output, "maplibre", "style-2500.json")));
});

test("createBundle rejects pmtiles not referenced by manifest", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  await writeFile(path.join(root, "pmtiles-manifest.json"), JSON.stringify({
    ...manifest,
    pmtiles: "expected.pmtiles",
  }));
  await writeFile(path.join(root, "actual.pmtiles"), "pmtiles");

  await assert.rejects(createBundle(path.join(root, "actual.pmtiles"), path.join(root, "public")), /does not match/);
});
