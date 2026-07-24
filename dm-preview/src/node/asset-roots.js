import {existsSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

export const PACKAGE_ROOT = (() => {
  const isBunCompiled = process.argv[1]?.includes("~BUN") || process.argv[1]?.includes("$bunfs");
  if (isBunCompiled) return path.dirname(path.resolve(process.execPath));
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
})();

export const packagePath = (...parts) => path.join(PACKAGE_ROOT, ...parts);

export const resolveVendorFile = (pkg, file) => {
  const fromVendor = packagePath("vendor", file);
  return existsSync(fromVendor) ? fromVendor : packagePath("node_modules", pkg, "dist", file);
};

export const createDefaultAssetRoots = () => {
  const root = resolveDefaultAssetRoot(PACKAGE_ROOT, existsSync);
  return {
    appAssets: path.join(root, "assets"),
    indexHtml: path.join(root, "assets", "index.html"),
    maplibreAssets: path.join(root, "maplibre"),
    vendorFiles: createVendorFiles(resolveVendorFile),
  };
};

export const resolveDefaultAssetRoot = (packageRoot, fileExists) => fileExists(path.join(packageRoot, "assets", "index.html"))
  ? packageRoot
  : path.join(packageRoot, "static");

export const createOutputAssetRoots = (root) => {
  if (existsSync(path.join(root, "style.json"))) {
    return {
      ...createDefaultAssetRoots(),
      maplibreAssets: root,
    };
  }
  if (!existsSync(path.join(root, "index.html"))) return createDefaultAssetRoots();
  return {
    appAssets: path.join(root, "assets"),
    indexHtml: path.join(root, "index.html"),
    maplibreAssets: path.join(root, "maplibre"),
    vendorFiles: createVendorFiles((_, file) => path.join(root, "vendor", file)),
  };
};

const createVendorFiles = (resolveFile) => new Map([
  ["/vendor/maplibre-gl.mjs", resolveFile("maplibre-gl", "maplibre-gl.mjs")],
  ["/vendor/maplibre-gl-shared.mjs", resolveFile("maplibre-gl", "maplibre-gl-shared.mjs")],
  ["/vendor/maplibre-gl-worker.mjs", resolveFile("maplibre-gl", "maplibre-gl-worker.mjs")],
  ["/vendor/maplibre-gl.css", resolveFile("maplibre-gl", "maplibre-gl.css")],
  ["/vendor/pmtiles.js", resolveFile("pmtiles", "pmtiles.js")],
]);
