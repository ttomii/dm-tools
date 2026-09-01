import assert from "node:assert/strict";
import {cp, mkdir, mkdtemp, readFile, rm, stat, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {test} from "node:test";
import {createBundle} from "../src/node/bundle.js";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

test("createBundle uses assets next to a packaged executable", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-packaged-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const packageRoot = path.join(root, "package");
  const source = path.join(root, "source");
  const output = path.join(root, "public");
  await mkdir(packageRoot, {recursive: true});
  await cp(path.join(sourceRoot, "src"), path.join(packageRoot, "src"), {recursive: true});
  await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({type: "module"}));
  await mkdir(path.join(packageRoot, "assets"));
  await writeFile(path.join(packageRoot, "assets", "index.html"), "packaged preview");
  await mkdir(path.join(packageRoot, "maplibre", "sprite"), {recursive: true});
  await mkdir(path.join(packageRoot, "maplibre", "glyphs", "Packaged Font"), {recursive: true});
  await writeFile(path.join(packageRoot, "maplibre", "style-2500.json"), JSON.stringify({
    version: 8,
    name: "packaged-default-style",
    sources: {dm: {type: "vector", url: "__PMTILES_URL__"}},
    layers: [],
  }));
  await writeFile(path.join(packageRoot, "maplibre", "sprite", "sprite.json"), "packaged-sprite-json");
  await writeFile(path.join(packageRoot, "maplibre", "sprite", "sprite.png"), "packaged-sprite-png");
  await writeFile(path.join(packageRoot, "maplibre", "sprite", "sprite@2x.json"), "packaged-sprite-2x-json");
  await writeFile(path.join(packageRoot, "maplibre", "sprite", "sprite@2x.png"), "packaged-sprite-2x-png");
  await writeFile(path.join(packageRoot, "maplibre", "glyphs", "Packaged Font", "0-255.pbf"), "packaged-glyph");
  await mkdir(source, {recursive: true});
  await writeFile(path.join(source, "pmtiles-manifest.json"), JSON.stringify(manifest));
  await writeFile(path.join(source, "dm-sample.pmtiles"), "pmtiles");

  const {createBundle: createPackagedBundle} = await import(
    pathToFileURL(path.join(packageRoot, "src/node/bundle.js")).href,
  );
  await createPackagedBundle(path.join(source, "dm-sample.pmtiles"), output);

  const style = JSON.parse(await readFile(path.join(output, "style.json"), "utf8"));
  assert.equal(style.name, "packaged-default-style");
  assert.equal(await readFile(path.join(output, "sprite", "sprite.json"), "utf8"), "packaged-sprite-json");
  assert.equal(await readFile(path.join(output, "glyphs", "Packaged Font", "0-255.pbf"), "utf8"), "packaged-glyph");
});

test("createBundle carries saved style assets into the distribution directory", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const source = path.join(root, "source");
  const output = path.join(root, "public");
  await mkdir(path.join(source, "sprite"), {recursive: true});
  await mkdir(path.join(source, "glyphs", "Saved Font"), {recursive: true});
  await writeFile(path.join(source, "pmtiles-manifest.json"), JSON.stringify(manifest));
  await writeFile(path.join(source, "dm-sample.pmtiles"), "pmtiles");
  await writeFile(path.join(source, "dm-sample.gpkg"), "geopackage");
  await writeFile(path.join(source, "style.json"), JSON.stringify({
    version: 8,
    name: "saved-style",
    sources: {dm: {type: "vector", url: "pmtiles://./dm-sample.pmtiles"}},
    layers: [],
  }));
  await writeFile(path.join(source, "sprite", "sprite.json"), "saved-sprite-json");
  await writeFile(path.join(source, "sprite", "sprite.png"), "saved-sprite-png");
  await writeFile(path.join(source, "sprite", "sprite@2x.json"), "saved-sprite-2x-json");
  await writeFile(path.join(source, "sprite", "sprite@2x.png"), "saved-sprite-2x-png");
  await writeFile(path.join(source, "glyphs", "Saved Font", "0-255.pbf"), "saved-glyph");

  await createBundle(path.join(source, "dm-sample.pmtiles"), output);

  const savedStyle = JSON.parse(await readFile(path.join(output, "style.json"), "utf8"));
  assert.equal(savedStyle.name, "saved-style");
  assert.equal(await readFile(path.join(output, "sprite", "sprite.json"), "utf8"), "saved-sprite-json");
  assert.equal(await readFile(path.join(output, "glyphs", "Saved Font", "0-255.pbf"), "utf8"), "saved-glyph");
  await assert.rejects(stat(path.join(output, "dm-sample.gpkg")), /ENOENT/);
  await assert.rejects(stat(path.join(output, "pmtiles-manifest.json")), /ENOENT/);
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
