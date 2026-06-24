import {cp, mkdir, readFile, realpath, stat, writeFile} from "node:fs/promises";
import path from "node:path";
import {createDefaultAssetRoots, packagePath} from "./asset-roots.js";
import {InputError, MANIFEST_FILENAME, parseManifest, resolveOutputPath} from "./manifest.js";

export const createBundle = async (pmtiles, output) => {
  const source = await readSource(pmtiles);
  const destination = await prepareOutput(output);
  const pmtilesName = path.basename(source.pmtiles);
  const manifest = {...source.manifest, pmtiles: pmtilesName};

  await Promise.all([
    cp(source.pmtiles, path.join(destination, pmtilesName)),
    writeFile(path.join(destination, MANIFEST_FILENAME), `${JSON.stringify(manifest, undefined, 2)}\n`),
    copyPreviewAssets(destination),
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
  return realpath(output);
};

const copyPreviewAssets = async (destination) => {
  const assets = createDefaultAssetRoots();
  await mkdir(path.join(destination, "assets"), {recursive: true});
  await Promise.all([
    cp(path.join(assets.appAssets, "index.html"), path.join(destination, "index.html")),
    cp(path.join(assets.appAssets, "app.css"), path.join(destination, "assets", "app.css")),
    cp(path.join(assets.appAssets, "app.js"), path.join(destination, "assets", "app.js")),
    cp(packagePath("maplibre"), path.join(destination, "maplibre"), {recursive: true}),
    copyVendorFiles(destination, assets.vendorFiles),
  ]);
};

const copyVendorFiles = async (destination, vendorFiles) => {
  await mkdir(path.join(destination, "vendor"), {recursive: true});
  await Promise.all([...vendorFiles].map(([route, file]) => cp(file, path.join(destination, route))));
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
