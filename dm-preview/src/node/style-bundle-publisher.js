import {mkdtemp, rename, rm, stat} from "node:fs/promises";
import path from "node:path";

const ASSET_DIRECTORIES = ["sprite", "glyphs"];

export const publishStyleBundle = async (root, staging, options = {}) => {
  const renameFile = options.renameFile ?? rename;
  const backupRoot = await mkdtemp(path.join(root, ".dm-preview-style-backup-"));
  const published = [];
  try {
    await publishAssetDirectories(root, staging, backupRoot, published, renameFile);
    await renameFile(path.join(staging, "style.json"), path.join(root, "style.json"));
  } catch (error) {
    await recoverPublishedAssets(published, backupRoot, renameFile, error, options.reportCleanupError);
    throw error;
  }
  await cleanupBackup(backupRoot, options.reportCleanupError);
};

const publishAssetDirectories = async (root, staging, backupRoot, published, renameFile) => {
  for (const name of ASSET_DIRECTORIES) {
    if (!(await exists(path.join(staging, name)))) continue;
    const asset = await backupAssetDirectory(root, backupRoot, name, renameFile);
    published.push(asset);
    await renameFile(path.join(staging, name), asset.destination);
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
