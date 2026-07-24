import {cpSync, mkdirSync, rmSync} from "node:fs";

rmSync("dist/vendor", {recursive: true, force: true});
mkdirSync("dist/vendor", {recursive: true});
cpSync("node_modules/maplibre-gl/dist/maplibre-gl.mjs", "dist/vendor/maplibre-gl.mjs");
cpSync("node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs", "dist/vendor/maplibre-gl-shared.mjs");
cpSync("node_modules/maplibre-gl/dist/maplibre-gl.css", "dist/vendor/maplibre-gl.css");
cpSync("node_modules/pmtiles/dist/pmtiles.js", "dist/vendor/pmtiles.js");
cpSync("static/assets", "dist/assets", {recursive: true});
cpSync("static/maplibre", "dist/maplibre", {recursive: true});
