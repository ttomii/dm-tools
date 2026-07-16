import assert from "node:assert/strict";
import {mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {publishStyleBundle} from "../src/node/style-bundle-publisher.js";

test("publishStyleBundle restores every asset when a later publish fails", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-publish-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const staging = path.join(root, ".staging");
  await writeBundle(root, "old");
  await writeBundle(staging, "new");
  const renameFile = async (source, destination) => {
    if (source === path.join(staging, "glyphs")) throw new Error("glyph publish failed");
    await rename(source, destination);
  };

  await assert.rejects(publishStyleBundle(root, staging, {renameFile}), /glyph publish failed/);

  assert.equal(await readFile(path.join(root, "style.json"), "utf8"), "old-style");
  assert.equal(await readFile(path.join(root, "sprite", "value"), "utf8"), "old-sprite");
  assert.equal(await readFile(path.join(root, "glyphs", "value"), "utf8"), "old-glyphs");
  assert.deepEqual((await readdir(root)).filter((name) => name.includes("backup")), []);
});

test("publishStyleBundle restores every asset when style publication fails", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-publish-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const staging = path.join(root, ".staging");
  await writeBundle(root, "old");
  await writeBundle(staging, "new");
  const renameFile = async (source, destination) => {
    if (source === path.join(staging, "style.json")) throw new Error("style publish failed");
    await rename(source, destination);
  };

  await assert.rejects(publishStyleBundle(root, staging, {renameFile}), /style publish failed/);

  assert.equal(await readFile(path.join(root, "style.json"), "utf8"), "old-style");
  assert.equal(await readFile(path.join(root, "sprite", "value"), "utf8"), "old-sprite");
  assert.equal(await readFile(path.join(root, "glyphs", "value"), "utf8"), "old-glyphs");
});

const writeBundle = async (root, value) => {
  await mkdir(path.join(root, "sprite"), {recursive: true});
  await mkdir(path.join(root, "glyphs"), {recursive: true});
  await writeFile(path.join(root, "style.json"), `${value}-style`);
  await writeFile(path.join(root, "sprite", "value"), `${value}-sprite`);
  await writeFile(path.join(root, "glyphs", "value"), `${value}-glyphs`);
};
