import assert from "node:assert/strict";
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {test} from "node:test";
import {copyMaplibreRuntimeAssets} from "../scripts/copy-maplibre-runtime-assets.mjs";

const files = {
  "glyphs/BIZ UDPGothic Regular/0-255.pbf": "glyph",
  "glyphs/FONTNIK_LICENSE.txt": "fontnik license",
  "glyphs/OFL.txt": "font license",
  "glyphs/README.md": "font provenance",
  "icons/LICENSE.txt": "icon license",
  "icons/icon-mapping.csv": "icon mapping",
  "icons/png/7100.png": "generated icon",
  "icons/source/7100.svg": "icon source",
  "README.md": "development notes",
  "sprite/README.md": "sprite generation notes",
  "sprite/sprite.json": "{}",
  "sprite/sprite.png": "sprite",
  "sprite/sprite@2x.json": "{}",
  "sprite/sprite@2x.png": "sprite 2x",
  "style-500.json": "{}",
  "style-1000.json": "{}",
  "style-2500.json": "{}",
  "style-5000.json": "{}",
  "style-mapping.csv": "style mapping",
};

test("copyMaplibreRuntimeAssets excludes development assets and retains notices", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-preview-build-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  const source = path.join(root, "source");
  const destination = path.join(root, "destination");
  await Promise.all(Object.entries(files).map(async ([relativePath, contents]) => {
    const file = path.join(source, relativePath);
    await mkdir(path.dirname(file), {recursive: true});
    await writeFile(file, contents);
  }));
  await mkdir(path.join(destination, "icons", "source"), {recursive: true});
  await writeFile(path.join(destination, "icons", "source", "stale.svg"), "stale icon source");

  copyMaplibreRuntimeAssets(source, destination);

  assert.equal(await readFile(path.join(destination, "style-2500.json"), "utf8"), "{}");
  assert.equal(await readFile(path.join(destination, "sprite", "sprite.png"), "utf8"), "sprite");
  assert.equal(
    await readFile(path.join(destination, "glyphs", "BIZ UDPGothic Regular", "0-255.pbf"), "utf8"),
    "glyph",
  );
  assert.equal(await readFile(path.join(destination, "licenses", "ICONS.txt"), "utf8"), "icon license");
  assert.equal(
    await readFile(path.join(destination, "licenses", "BIZ_UDPGOTHIC_OFL.txt"), "utf8"),
    "font license",
  );
  assert.equal(
    await readFile(path.join(destination, "licenses", "BIZ_UDPGOTHIC_PROVENANCE.md"), "utf8"),
    "font provenance",
  );
  await assert.rejects(stat(path.join(destination, "icons")), /ENOENT/);
  await assert.rejects(stat(path.join(destination, "style-mapping.csv")), /ENOENT/);
  await assert.rejects(stat(path.join(destination, "README.md")), /ENOENT/);
  await assert.rejects(stat(path.join(destination, "sprite", "README.md")), /ENOENT/);
});
