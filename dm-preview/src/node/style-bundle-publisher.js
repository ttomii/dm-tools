import {cp, mkdtemp, rename, rm, stat} from "node:fs/promises";
import path from "node:path";

const ASSET_DIRECTORIES = ["sprite", "glyphs"];

export const publishStyleBundle = async (root, staging, options = {}) => {
  const renameFile = options.renameFile ?? rename;
  const copyDirectory = options.copyDirectory ?? cp;
  const backupRoot = await mkdtemp(path.join(root, ".dm-preview-style-backup-"));
  const published = [];
  try {
    await publishAssetDirectories(root, staging, backupRoot, published, renameFile, copyDirectory);
    await renameFile(path.join(staging, "style.json"), path.join(root, "style.json"));
  } catch (error) {
    await recoverPublishedAssets(published, backupRoot, renameFile, error, options.reportCleanupError);
    throw error;
  }
  await cleanupBackup(backupRoot, options.reportCleanupError);
};

const publishAssetDirectories = async (root, staging, backupRoot, published, renameFile, copyDirectory) => {
  for (const name of ASSET_DIRECTORIES) {
    if (!(await exists(path.join(staging, name)))) continue;
    const asset = await backupAssetDirectory(root, backupRoot, name, renameFile);
    published.push(asset);
    await publishAssetDirectory(path.join(staging, name), asset.destination, renameFile, copyDirectory);
  }
};

const publishAssetDirectory = async (source, destination, renameFile, copyDirectory) => {
  try {
    await renameFile(source, destination);
  } catch (error) {
    if (!["EPERM", "EBUSY", "EXDEV"].includes(error.code)) throw error;
    // Windows can reject directory renames even when individual files can be copied.
    // Leave the staging source for the caller to clean up after publication.
    await copyDirectory(source, destination, {recursive: true, force: false, errorOnExist: true});
  }
};

const backupAssetDirectory = async (root, backupRoot, name, renameFile) => {
  const destination = path.join(root, name);
  const backup = path.join(backupRoot, name);
  const hadDestination = await exists(destination);
  if (hadDestination) await renameFile(destination, backup);
  return {backup, destination, hadDestination};
};

const recoverPublishedAssets = async (published, backupRoot, renameFile, originalError, reportCleanupError) => {
  await rollbackPublishedAssets([...published].reverse(), renameFile).catch((rollbackError) => {
    throw new AggregateError([originalError, rollbackError], "style bundle publish and rollback failed");
  });
  await cleanupBackup(backupRoot, reportCleanupError);
};

const rollbackPublishedAssets = async (published, renameFile) => {
  const errors = [];
  for (const asset of published) {
    await restoreAsset(asset, renameFile).catch((error) => errors.push(error));
  }
  if (errors.length) throw new AggregateError(errors, "failed to restore style assets");
};

const restoreAsset = async ({backup, destination, hadDestination}, renameFile) => {
  await rm(destination, {recursive: true, force: true});
  if (hadDestination) await renameFile(backup, destination);
};

const cleanupBackup = async (backupRoot, reportCleanupError) => {
  await rm(backupRoot, {recursive: true, force: true}).catch((error) => reportCleanupError?.(error));
};

const exists = async (file) => stat(file).then(() => true, () => false);
