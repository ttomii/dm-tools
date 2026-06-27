import {cp, mkdir, readFile, readdir, realpath, stat, writeFile} from "node:fs/promises";
import path from "node:path";
import {InputError, MANIFEST_FILENAME, parseManifest} from "../core/manifest-policy.js";
import {createBundledStyle} from "../core/style-transform.js";
import {packagePath} from "./asset-roots.js";
import {resolveOutputPath} from "./manifest.js";

export const createBundle = async (pmtiles, output) => {
  const source = await readSource(pmtiles);
  const destination = await prepareOutput(output);
  const pmtilesName = path.basename(source.pmtiles);
  const style = await createStyle(source.manifest, pmtilesName);

  await Promise.all([
    cp(source.pmtiles, path.join(destination, pmtilesName)),
    writeFile(path.join(destination, "style.json"), `${JSON.stringify(style, undefined, 2)}\n`),
    copyStyleAssets(destination),
  ]);
  return destination;
};

const readSource = async (pmtiles) => {
  const pmtilesFile = await requireFile(pmtiles, "pmtiles");
  const root = path.dirname(pmtilesFile);
  const manifestPath = path.join(root, MANIFEST_FILENAME);
  const manifest = parseManifest(await readJson(manifestPath));
  const manifestPmtiles = await realpath(resolveOutputPath(root, manifest.pmtiles)).catch(() => "");
  if (manifestPmtiles !== pmtilesFile) {
    throw new InputError(`manifest pmtiles does not match input: ${manifest.pmtiles}`);
  }
  return {manifest, pmtiles: pmtilesFile};
};

const prepareOutput = async (output) => {
  await mkdir(output, {recursive: true});
  const metadata = await stat(output);
  if (!metadata.isDirectory()) throw new InputError(`output is not a directory: ${output}`);
  if ((await readdir(output)).length) {
    throw new InputError(`output directory must be empty: ${output}`);
  }
  return realpath(output);
};

const createStyle = async (manifest, pmtilesName) => {
  if (manifest.levels.length !== 1) {
    throw new InputError("bundle requires a manifest with exactly one level");
  }
  const style = await readJson(packagePath("static", "maplibre", `style-${manifest.levels[0]}.json`));
  return createBundledStyle(style, manifest, {pmtiles: pmtilesName});
};

const copyStyleAssets = async (destination) => {
  await Promise.all([
    copySpriteFiles(destination),
    copyGlyphFiles(packagePath("static", "maplibre", "glyphs"), path.join(destination, "glyphs")),
  ]);
};

const copySpriteFiles = async (destination) => {
  const spriteRoot = path.join(destination, "sprite");
  await mkdir(spriteRoot, {recursive: true});
  await Promise.all(["sprite.json", "sprite.png", "sprite@2x.json", "sprite@2x.png"]
    .map((file) => cp(packagePath("static", "maplibre", "sprite", file), path.join(spriteRoot, file))));
};

const copyGlyphFiles = async (source, destination) => {
  await mkdir(destination, {recursive: true});
  const entries = await readdir(source, {withFileTypes: true});
  await Promise.all(entries.map((entry) => copyGlyphEntry(source, destination, entry)));
};

const copyGlyphEntry = async (source, destination, entry) => {
  const sourcePath = path.join(source, entry.name);
  const destinationPath = path.join(destination, entry.name);
  if (entry.isDirectory()) {
    await copyGlyphFiles(sourcePath, destinationPath);
    return;
  }
  if (entry.isFile() && entry.name.endsWith(".pbf")) {
    await cp(sourcePath, destinationPath);
  }
};

const requireFile = async (file, name) => {
  let metadata;
  try {
    metadata = await stat(file);
  } catch (error) {
    throw new InputError(`${name} cannot be read: ${file}: ${error.message}`);
  }
  if (!metadata.isFile()) throw new InputError(`${name} is not a file: ${file}`);
  return realpath(file);
};

const readJson = async (file) => {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new InputError(`manifest cannot be read: ${file}: ${error.message}`);
  }
};
