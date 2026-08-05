import {cp, mkdir, readFile, readdir, realpath, stat, writeFile} from "node:fs/promises";
import path from "node:path";
import {InputError, MANIFEST_FILENAME, parseManifest} from "../core/manifest-policy.js";
import {createBundledStyle} from "../core/style-transform.js";
import {packagePath} from "./asset-roots.js";
import {resolveOutputPath} from "./manifest.js";

export const createBundle = async (pmtiles, output, options = {}) => {
  const source = await readSource(pmtiles);
  const destination = await prepareOutput(output);
  const pmtilesName = path.basename(source.pmtiles);
  const style = await createStyle(source, pmtilesName, options);
  const files = [
    cp(source.pmtiles, path.join(destination, pmtilesName)),
    copyStyleAssets(source.root, destination),
  ];
  if (style) files.push(writeFile(path.join(destination, "style.json"), `${JSON.stringify(style, undefined, 2)}\n`));

  await Promise.all(files);
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
  return {manifest, pmtiles: pmtilesFile, root};
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

const createStyle = async (source, pmtilesName, options) => {
  const {manifest} = source;
  if (manifest.levels.length !== 1) {
    throw new InputError("bundle requires a manifest with exactly one level");
  }
  const savedStyle = await readSavedStyle(source.root);
  if (savedStyle) return createBundledStyle(savedStyle, manifest, {pmtiles: pmtilesName});
  if (options.includeDefaultStyle === false) return undefined;
  const style = await readJson(packagePath("static", "maplibre", `style-${manifest.levels[0]}.json`));
  return createBundledStyle(style, manifest, {pmtiles: pmtilesName});
};

const copyStyleAssets = async (source, destination) => {
  await Promise.all([
    copySpriteFiles(
      await assetDirectory(source, "sprite", packagePath("static", "maplibre", "sprite")),
      destination,
    ),
    copyGlyphFiles(
      await assetDirectory(source, "glyphs", packagePath("static", "maplibre", "glyphs")),
      path.join(destination, "glyphs"),
    ),
  ]);
};

const copySpriteFiles = async (source, destination) => {
  const spriteRoot = path.join(destination, "sprite");
  await mkdir(spriteRoot, {recursive: true});
  await Promise.all(["sprite.json", "sprite.png", "sprite@2x.json", "sprite@2x.png"]
    .map((file) => cp(path.join(source, file), path.join(spriteRoot, file))));
};

const readSavedStyle = async (root) => {
  const file = path.join(root, "style.json");
  try {
    const metadata = await stat(file);
    if (!metadata.isFile()) throw new InputError(`saved style is not a file: ${file}`);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
  return readJson(file);
};

const assetDirectory = async (root, name, fallback) => {
  const candidate = path.join(root, name);
  try {
    const metadata = await stat(candidate);
    if (!metadata.isDirectory()) throw new InputError(`saved ${name} is not a directory: ${candidate}`);
    return candidate;
  } catch (error) {
    if (error.code === "ENOENT" && fallback) return fallback;
    throw error;
  }
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
