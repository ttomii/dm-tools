import path from "node:path";
import {fileURLToPath} from "node:url";
import {generateMaplibreAssets} from "./maplibre-assets/generator.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

generateMaplibreAssets({
  packageRoot,
  selectedValues: process.argv.slice(2),
});
