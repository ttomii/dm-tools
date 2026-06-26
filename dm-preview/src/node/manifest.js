import {readFile, realpath, stat} from "node:fs/promises";
import path from "node:path";
import {
  InputError,
  isStyle,
  MANIFEST_FILENAME,
  manifestPaths,
  parseManifest,
  parseRelativePath,
  parseStyleManifest,
} from "../core/manifest-policy.js";

export {InputError, MANIFEST_FILENAME, parseManifest};

export const readManifest = async (output) => {
  const root = await requireDirectory(output);
  const manifestPath = path.join(root, MANIFEST_FILENAME);
  const value = await readJson(manifestPath).catch(async (error) => {
    if (error.code === "ENOENT") return readJson(path.join(root, "style.json"));
    throw error;
  });
  if (isStyle(value)) {
    const manifest = parseStyleManifest(value);
    await requireFile(root, manifest.pmtiles);
    return {manifest, root};
  }
  const manifest = parseManifest(value);
  await Promise.all(manifestPaths(manifest).map((relative) => requireFile(root, relative)));
  return {manifest, root};
};

export const resolveOutputPath = (root, relative) => {
  const validated = parseRelativePath(relative, "path");
  return path.join(root, ...validated.split("/"));
};

const requireDirectory = async (output) => {
  let metadata;
  try {
    metadata = await stat(output);
  } catch (error) {
    throw new InputError(`output cannot be read: ${output}: ${error.message}`);
  }
  if (!metadata.isDirectory()) {
    throw new InputError(`output is not a directory: ${output}`);
  }
  return realpath(output);
};

const readJson = async (file) => {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    const wrapped = new InputError(`manifest cannot be read: ${file}: ${error.message}`);
    wrapped.code = error.code;
    throw wrapped;
  }
};

const requireFile = async (root, relative) => {
  const file = resolveOutputPath(root, relative);
  let metadata;
  try {
    metadata = await stat(file);
  } catch {
    throw new InputError(`manifest file is missing: ${relative}`);
  }
  const canonical = await realpath(file);
  if (!isWithin(root, canonical) || !metadata.isFile()) {
    throw new InputError(`manifest path is not a file: ${relative}`);
  }
};

const isWithin = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`);
