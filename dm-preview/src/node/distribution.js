import {readdir, realpath, stat} from "node:fs/promises";
import path from "node:path";
import {InputError} from "../core/manifest-policy.js";
import {createBundle} from "./bundle.js";
import {readManifest, resolveOutputPath} from "./manifest.js";

export const defaultDistributionPath = async (previewRoot, manifest) =>
  await hasPreviewGeoPackage(previewRoot, manifest) ? path.join(previewRoot, "public") : previewRoot;

export const prepareDistribution = async (previewRoot, manifest, output) => {
  const destination = await resolveDestination(output);
  if (destination === previewRoot) {
    throw new InputError("distribution directory must be separate from preview data");
  }
  const state = await directoryState(destination);
  if (state === "missing" || state === "empty") {
    await createBundle(resolveOutputPath(previewRoot, manifest.pmtiles), destination);
  }
  return readManifest(destination);
};

const hasPreviewGeoPackage = async (root, manifest) => {
  if (!isSafeLayerName(manifest.layerName)) return false;
  try {
    return (await stat(path.join(root, `${manifest.layerName}.gpkg`))).isFile();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
};

const isSafeLayerName = (value) => typeof value === "string" && Boolean(value)
  && !value.includes("/") && !value.includes("\\");

const resolveDestination = async (output) => {
  const absolute = path.resolve(output);
  return realpath(absolute).catch((error) => {
    if (error.code === "ENOENT") return absolute;
    throw error;
  });
};

const directoryState = async (directory) => {
  try {
    const metadata = await stat(directory);
    if (!metadata.isDirectory()) throw new InputError(`distribution is not a directory: ${directory}`);
    return (await readdir(directory)).length ? "non-empty" : "empty";
  } catch (error) {
    if (error.code === "ENOENT") return "missing";
    throw error;
  }
};
