import assert from "node:assert/strict";
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from "node:fs/promises";
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

test("createBundle writes style and referenced data only", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const source = path.join(root, "source");
  const output = path.join(root, "public");
  await mkdir(source, {recursive: true});
  await writeFile(path.join(source, "pmtiles-manifest.json"), JSON.stringify(manifest));
  await writeFile(path.join(source, "dm-sample.pmtiles"), "pmtiles");

  const destination = await createBundle(path.join(source, "dm-sample.pmtiles"), output);
  const style = JSON.parse(await readFile(path.join(output, "style.json"), "utf8"));

  assert.equal(destination, output);
  assert.equal(style.sources.dm.url, "pmtiles://./dm-sample.pmtiles");
  assert.equal(style.sprite, "./sprite/sprite");
  assert.equal(style.glyphs, "./glyphs/{fontstack}/{range}.pbf");
  assert.deepEqual(style.metadata["dm:center"], manifest.center);
  assert.equal(await readFile(path.join(output, "dm-sample.pmtiles"), "utf8"), "pmtiles");
  assert.ok((await stat(path.join(output, "sprite", "sprite.json"))).isFile());
  assert.ok((await stat(path.join(output, "glyphs", "BIZ UDPGothic Regular", "0-255.pbf"))).isFile());
  await assert.rejects(readFile(path.join(output, "index.html")), /ENOENT/);
  await assert.rejects(readFile(path.join(output, "pmtiles-manifest.json")), /ENOENT/);
  await assert.rejects(readFile(path.join(output, "sprite", "README.md")), /ENOENT/);
  await assert.rejects(readFile(path.join(output, "glyphs", "README.md")), /ENOENT/);
  await assert.rejects(stat(path.join(output, "assets")), /ENOENT/);
  await assert.rejects(stat(path.join(output, "vendor")), /ENOENT/);
  await assert.rejects(stat(path.join(output, "maplibre")), /ENOENT/);
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

test("createBundle rejects non-empty output directory", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const source = path.join(root, "source");
  const output = path.join(root, "public");
  await mkdir(source, {recursive: true});
  await mkdir(output);
  await writeFile(path.join(source, "pmtiles-manifest.json"), JSON.stringify(manifest));
  await writeFile(path.join(source, "dm-sample.pmtiles"), "pmtiles");
  await writeFile(path.join(output, "old.txt"), "old");

  await assert.rejects(createBundle(path.join(source, "dm-sample.pmtiles"), output), /output directory must be empty/);
});
