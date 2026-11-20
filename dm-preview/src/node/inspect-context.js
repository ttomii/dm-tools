import {readInspectGpkgManifest} from "./inspect-gpkg.js";
import path from "node:path";
import {readManifest} from "./manifest.js";
import {createLazyFeatureStore} from "./gpkg-features.js";

export const createInspectContext = async (root, presentation, id, dependencies) => {
  const output = path.join(root, "runs", id);
  const catalog = await readInspectGpkgManifest(output).catch(error => { if (error.code !== "ENOENT") throw error; });
  if (catalog) return {root: output, manifest: catalog, featureManifest: catalog, featureRoot: output,
    featureStore: createLazyFeatureStore(output, catalog, dependencies), styleRoot: presentation};
  const preview = await readManifest(output);
  const manifest = {...preview.manifest, pmtiles: `inspect-data/${id}/${preview.manifest.pmtiles}`};
  return {root: output, manifest, featureManifest: preview.manifest, featureRoot: output,
    featureStore: createLazyFeatureStore(output, preview.manifest, dependencies), styleRoot: presentation};
};
