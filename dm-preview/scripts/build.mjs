import {cpSync, mkdirSync} from "node:fs";

mkdirSync("dist/vendor", {recursive: true});
cpSync("node_modules/maplibre-gl/dist/maplibre-gl.js", "dist/vendor/maplibre-gl.js");
cpSync("node_modules/maplibre-gl/dist/maplibre-gl.css", "dist/vendor/maplibre-gl.css");
cpSync("node_modules/pmtiles/dist/pmtiles.js", "dist/vendor/pmtiles.js");
cpSync("static/assets", "dist/static/assets", {recursive: true});
cpSync("static/maplibre", "dist/static/maplibre", {recursive: true});
