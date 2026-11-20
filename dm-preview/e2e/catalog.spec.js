import {spawn} from "node:child_process";
import {once} from "node:events";
import {cp, mkdtemp, mkdir, rm, writeFile, readdir, readFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {test, expect} from "playwright/test";
import {dmCodes} from "../src/core/dm-layer-names.js";
import {INSPECT_LEVELS, isInspectCodeLevel, inspectCasesForLevel, inspectSourceKind} from "../src/core/inspect-catalog.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const {readInspectCatalogCases}=await import("../src/node/inspect-catalog.js");
const plannedCatalog=await readInspectCatalogCases();
const sampleCount=(code,level,kind)=>inspectCasesForLevel(plannedCatalog,level).filter(s=>s.code===code&&inspectSourceKind(s.kind)===kind).length;
const {symbols: missingSymbols} = JSON.parse(await readFile(new URL("../static/maplibre/symbol-spec.json", import.meta.url), "utf8"));
let child;
let root;
let url;

test.beforeAll(async () => {
  test.setTimeout(1200000);
  root = await mkdtemp(path.join(os.tmpdir(), "dm-catalog-e2e-"));
  const converter = process.env.DM_CONVERTER ?? path.resolve(packageRoot, "../dm-converter/target/release/dm-converter");
  if (process.env.DM_INSPECT_CATALOG_FIXTURE) {
    const id = "00000000-0000-4000-8000-000000000001";
    await mkdir(path.join(root, "runs"), {recursive: true});
    await cp(process.env.DM_INSPECT_CATALOG_FIXTURE, path.join(root, "runs", id), {recursive: true});
    await writeFile(path.join(root, "session.json"), JSON.stringify({version: 1, catalog: 1,
      converter, input: path.join(root, "catalog-input"), inputDatum: "jgd2024", lastRun: id}));
  }
  child = spawn(process.execPath, [path.join(packageRoot, "bin/dm-preview.js"), "inspect",
    "--work-dir", root, "--converter", converter, "--no-open"], {stdio: ["ignore", "pipe", "pipe"]});
  url = await new Promise((resolve, reject) => {
    let errors = "";
    child.stderr.on("data", data => { errors += data; });
    child.once("error", reject);
    child.once("exit", code => reject(new Error(`inspect exited ${code}: ${errors}`)));
    child.stdout.on("data", data => {
      const match = data.toString().match(/http:\/\/127\.0\.0\.1:\d+\/preview\//);
      if (match) resolve(match[0]);
    });
  });
});

test.afterAll(async () => {
  if (child?.exitCode === null) { const ended = once(child, "exit"); child.kill("SIGTERM"); await ended; }
  if (root) await rm(root, {recursive: true, force: true});
});

test("catalog displays every code and level from a GeoPackage GeoJSON API without reconverting selections", async ({page}) => {
  test.setTimeout(1200000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  const requests = []; page.on("request", request => requests.push({url: request.url(), method: request.method()}));
  await page.goto(url);
  await expect(page.locator("#data-generation-status")).toHaveText(/変換完了|変換済み/, {timeout: 1200000});
  await expect(page.locator("header #reference-scale")).toBeEnabled({timeout: 60000});
  await expect(page.locator("header #zoom-scale")).toBeEnabled();
  await expect(page.locator("#inspect-panel")).toHaveCount(0);
  await page.locator("#feature-code").selectOption("1101");
  await expect(page.locator("#feature-navigation-status")).toContainText("DMコード1101・レベル500", {timeout: 60000});
  await expect(page.locator("#inspect-convert, #inspect-cancel, [name=inspect-level]")).toHaveCount(0);
  const stateUrl = new URL("api/inspect/state", url).href;
  const state = (await (await page.request.get(stateUrl)).json());
  const manifest = await (await page.request.get(new URL("pmtiles-manifest.json", url).href)).json();
  expect(manifest.pmtiles).toBeUndefined(); expect(manifest.geojson).toBe("api/inspect/geojson");
  expect(manifest.levels).toEqual(INSPECT_LEVELS);
  const geojson = await (await page.request.get(new URL(manifest.geojson, url).href)).json();
  expect(geojson.type).toBe("FeatureCollection");
  const labels = geojson.features.filter(feature => feature.properties.DM_SOURCE_LAYER === "inspect_labels");
  for (const level of INSPECT_LEVELS) {
    const shapes = geojson.features.filter(feature => feature.properties.LEVEL === level && feature.properties.DM_SOURCE_LAYER !== "inspect_labels" && !feature.properties.DECORATION);
    const codes = new Set(shapes.map(feature => feature.properties.DMCODE));
    const expectedCodes=new Set(inspectCasesForLevel(plannedCatalog,level).map(s=>s.code));
    for (const code of dmCodes()) expect(codes.has(code), `code ${code} level ${level}`).toBe(expectedCodes.has(code));
    const column = labels.filter(feature => feature.properties.LEVEL === level && /^\d{4}  1:/.test(feature.properties.TEXT)).sort((a, b) => a.properties.DMCODE - b.properties.DMCODE);
    expect(column.length).toBe(expectedCodes.size);
    if (!isInspectCodeLevel(2204, level)) expect(column.some(feature => feature.properties.DMCODE === 2204)).toBe(false);
    for (let index = 1; index < column.length; index++) expect(column[index].geometry.coordinates[1]).toBeLessThan(column[index - 1].geometry.coordinates[1]);
  }
  const output = path.join(root, "runs", state.lastRun);
  expect(await readdir(output)).toContain("inspect.gpkg");
  expect((await readdir(output)).some(file => file.endsWith(".pmtiles"))).toBe(false);
  await page.evaluate(async () => {
    const {Map} = await import("./vendor/maplibre-gl.mjs"); const jump = Map.prototype.jumpTo;
    Map.prototype.jumpTo = function (...args) { window.inspectTestMap = this; return jump.apply(this, args); };
  });
  for (const level of INSPECT_LEVELS) {
    await page.locator("#reference-scale").selectOption(String(level));
    await page.locator("#feature-code").selectOption("1102");
    await expect(page.locator("#feature-navigation-status")).toContainText(`DMコード1102・レベル${level}`);
    await page.locator("#feature-code").selectOption("1101");
    await expect(page.locator("#feature-navigation-status")).toContainText(`DMコード1101・レベル${level}`);
    for (const decoration of ["major_dash", "minor_dash", "major_dash_end"]) {
      await expect.poll(async () => page.evaluate(({level, decoration}) => window.inspectTestMap.queryRenderedFeatures()
        .filter(feature => feature.source === "dm" && feature.properties.DMCODE === 1101 && feature.properties.LEVEL === level && feature.properties.DECORATION === decoration).length,
      {level, decoration}), {timeout: 30000}).toBeGreaterThan(0);
    }
  }
  for (const level of [250, 500, 1000]) {
    await page.locator("#reference-scale").selectOption(String(level));
    await page.locator("#feature-code").selectOption("2204");
    await expect(page.locator("#feature-navigation-status")).toContainText(`DMコード2204・レベル${level}`);
    for (const [sourceLayer, count] of [["dm_2204_line", 2], ["dm_2204_line_deco_line", 4]]) {
      await expect.poll(async () => page.evaluate(({sourceLayer, level}) => new Set(window.inspectTestMap.queryRenderedFeatures()
        .filter(feature => feature.source === "dm" && feature.properties.LEVEL === level && feature.properties.DM_SOURCE_LAYER === sourceLayer)
        .map(feature => `${feature.properties.DM_TABLE}:${feature.properties.fid}`)).size, {sourceLayer, level}), {timeout: 30000}).toBe(count);
    }
    expect(await page.evaluate(level => window.inspectTestMap.getStyle().layers.find(layer =>
      layer.metadata?.["dm:source-layer"] === "dm_2204_line" && layer.metadata?.["dm:pen-level"] === level).metadata["dm:pen-number"], level)).toBe(3);
  }
  for (const level of INSPECT_LEVELS) {
    await page.locator("#reference-scale").selectOption(String(level));
    await page.locator("#feature-code").selectOption("2205");
    await expect(page.locator("#feature-navigation-status")).toContainText(`DMコード2205・レベル${level}`);
    await expect.poll(async () => page.evaluate(level => new Set(window.inspectTestMap.queryRenderedFeatures()
      .filter(feature => feature.source === "dm" && feature.properties.LEVEL === level && feature.properties.DM_SOURCE_LAYER === "dm_2205_line_deco_line")
      .map(feature => `${feature.properties.DM_TABLE}:${feature.properties.fid}`)).size, level), {timeout: 30000}).toBe(4);
  }
  for (const level of [250, 500, 1000]) {
    await page.locator("#reference-scale").selectOption(String(level));
    await page.locator("#feature-code").selectOption("2213");
    await expect(page.locator("#feature-navigation-status")).toContainText(`DMコード2213・レベル${level}`);
    const shape = geojson.features.find(feature => feature.properties.LEVEL === level && feature.properties.DM_SOURCE_LAYER === "dm_2213_line");
    expect(shape.geometry.coordinates).toHaveLength(2);
    await expect.poll(async () => page.evaluate(level => window.inspectTestMap.queryRenderedFeatures().filter(feature =>
      feature.source === "dm" && feature.properties.LEVEL === level && feature.properties.DM_SOURCE_LAYER === "dm_2213_line").length, level), {timeout: 30000}).toBeGreaterThan(0);
    expect(await page.evaluate(level => window.inspectTestMap.getStyle().layers.find(layer =>
      layer.metadata?.["dm:source-layer"] === "dm_2213_line" && layer.metadata?.["dm:pen-level"] === level).paint["line-dasharray"], level)).toBeUndefined();
  }
  for (const level of [250, 500, 1000]) for (const code of [2235, 2236]) {
    const sourceLayer = `dm_${code}_polygon`;
    const polygons = geojson.features.filter(feature => feature.properties.LEVEL === level && feature.properties.DM_SOURCE_LAYER === sourceLayer);
    expect(polygons).toHaveLength(sampleCount(code,level,"polygon"));
    expect(polygons.every(feature => feature.geometry.type === "Polygon")).toBe(true);
    await page.locator("#reference-scale").selectOption(String(level));
    await page.locator("#feature-code").selectOption(String(code));
    await expect(page.locator("#feature-navigation-status")).toContainText(`DMコード${code}・レベル${level}`);
    await expect.poll(async () => page.evaluate(({level, sourceLayer}) => window.inspectTestMap.queryRenderedFeatures().filter(feature =>
      feature.source === "dm" && feature.properties.LEVEL === level && feature.properties.DM_SOURCE_LAYER === sourceLayer && feature.layer.type === "line").length,
    {level, sourceLayer}), {timeout: 30000}).toBeGreaterThan(0);
  }
  for (const level of [250, 500, 1000]) {
    await page.locator("#reference-scale").selectOption(String(level));
    await page.locator("#feature-code").selectOption("2221");
    await expect(page.locator("#feature-navigation-status")).toContainText(`DMコード2221・レベル${level}`);
    await expect.poll(async () => page.evaluate(level => window.inspectTestMap.queryRenderedFeatures().filter(feature =>
      feature.source === "dm" && feature.properties.LEVEL === level && feature.properties.DM_SOURCE_LAYER === "dm_2221_point" && feature.layer.type === "symbol").length, level), {timeout: 30000}).toBeGreaterThan(0);
    const icon = await page.evaluate(level => window.inspectTestMap.getStyle().layers.find(layer =>
      layer.metadata?.["dm:source-layer"] === "dm_2221_point" && layer.id.includes(`-${level}-`)).layout["icon-image"], level);
    expect(icon).toMatch(new RegExp(`^dm-2221-pen-${level}-`));
  }
  for (const level of [250, 500, 1000]) {
    await page.locator("#reference-scale").selectOption(String(level));
    for (const symbol of missingSymbols.filter(symbol => symbol.levels.includes(level === 250 ? 500 : level))) {
      await page.locator("#feature-code").selectOption(String(symbol.code));
      await expect(page.locator("#feature-navigation-status")).toContainText(`DMコード${symbol.code}・レベル${level}`);
      await expect.poll(async () => page.evaluate(({level, code}) => window.inspectTestMap.queryRenderedFeatures().filter(feature =>
        feature.source === "dm" && feature.properties.LEVEL === level && feature.properties.DM_SOURCE_LAYER === `dm_${code}_point` && feature.layer.type === "symbol").length,
      {level, code: symbol.code}), {timeout: 30000}).toBeGreaterThan(0);
      expect(await page.evaluate(({level, code}) => {
        const layer = window.inspectTestMap.getStyle().layers.find(item => item.metadata?.["dm:source-layer"] === `dm_${code}_point` && item.id.includes(`-${level}-`) && item.type === "symbol");
        return window.inspectTestMap.hasImage(layer.layout["icon-image"]);
      }, {level, code: symbol.code})).toBe(true);
      if (inspectCasesForLevel(plannedCatalog,level).some(s=>s.code===symbol.code&&s.kind==="direction")) {
        await expect.poll(async () => page.evaluate(({level, code}) => [...new Set(window.inspectTestMap.queryRenderedFeatures().filter(feature =>
          feature.source === "dm" && feature.properties.LEVEL === level && feature.properties.DM_SOURCE_LAYER === `dm_${code}_point`)
          .map(feature => feature.properties.ROTATION))].sort((a, b) => a - b), {level, code: symbol.code}), {timeout: 30000}).toEqual([0, 90]);
      }
    }
  }
  await page.locator("#reference-scale").selectOption("500");
  await page.locator("#feature-code").selectOption("2106");
  await expect(page.locator("#feature-navigation-status")).toContainText("DMコード2106・レベル500", {timeout: 60000});
  await expect(page.locator("#properties")).toContainText("2106");
  await expect.poll(async () => page.evaluate(() => window.inspectTestMap.queryRenderedFeatures().filter(feature => feature.source === "dm" && feature.properties.DMCODE === 2106 && feature.properties.DM_SOURCE_LAYER !== "inspect_labels").length), {timeout: 60000}).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.inspectTestMap.getSource("dm").type)).toBe("geojson");
  const line = geojson.features.find(feature => feature.properties.DMCODE === 2106 && feature.properties.LEVEL === 500 && feature.properties.DM_SOURCE_LAYER === "dm_2106_line");
  const coordinate = line.geometry.coordinates[0].map((value, axis) => (value + line.geometry.coordinates[1][axis]) / 2);
  const position = await page.evaluate(coordinate => {
    const point = window.inspectTestMap.project(coordinate); return {x: point.x, y: point.y};
  }, coordinate);
  await page.locator(".maplibregl-canvas").click({position});
  await expect(page.locator("#hit-list button").first()).toBeVisible();
  await expect(page.locator("#properties")).toContainText("dm_2106_line");
  await page.locator("#feature-relations").click();
  await expect(page.locator("#feature-relations-list button").first()).toContainText("元地物");
  const label = labels.find(feature => feature.properties.DMCODE === 2106 && feature.properties.LEVEL === 500);
  await page.evaluate(center => window.inspectTestMap.jumpTo({center}), label.geometry.coordinates);
  await expect.poll(async () => page.evaluate(() => window.inspectTestMap.queryRenderedFeatures({layers: ["inspect-code-labels"]}).filter(feature => feature.properties.DMCODE === 2106).length), {timeout: 30000}).toBeGreaterThan(0);
  for (const level of INSPECT_LEVELS) {
    await page.locator("#reference-scale").selectOption(String(level));
    await page.locator("#zoom-scale").click();
    await expect.poll(async () => page.evaluate(async () => {
      const {getScaleByZoom} = await import("./assets/core/map-scale.js");
      const map = window.inspectTestMap; return getScaleByZoom(map.getZoom(), map.getCenter().lat);
    })).toBe(level);
  }
  await page.locator("#tab-style-editor").click();
  await page.locator("#style-kind-line").fill("#123456");
  await page.locator("#style-kind-line").dispatchEvent("input");
  await page.locator("#style-save").click();
  await expect(page.locator("#style-editor-status")).toHaveText("保存しました");
  await page.locator("#style-reload").click();
  await page.locator("#feature-code").selectOption("2106");
  await expect(page.locator("#feature-navigation-status")).toContainText("DMコード2106");
  await expect.poll(async () => page.evaluate(() => window.inspectTestMap.getStyle().layers.find(layer =>
    layer.metadata?.["dm:source-layer"] === "dm_2106_line").paint["line-color"])).toBe("#123456");
  expect((await (await page.request.get(stateUrl)).json()).lastRun).toBe(state.lastRun);
  expect(requests.some(request => request.method === "POST" && request.url.endsWith("api/inspect/convert"))).toBe(false);
  expect(requests.some(request => request.url.includes(".pmtiles"))).toBe(false);
  expect(requests.some(request => request.url.endsWith("api/inspect/geojson"))).toBe(true);
  expect(errors).toEqual([]);
});

test("catalog renders 2252 and 2253 as centered circled S/C at every supported level", async ({page}, testInfo) => {
  test.setTimeout(300000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(url);
  await expect(page.locator("header #reference-scale")).toBeEnabled({timeout: 180000});
  await page.addStyleTag({content: ".maplibregl-marker { display: none !important; }"});
  await page.evaluate(async () => {
    const {Map} = await import("./vendor/maplibre-gl.mjs"); const jump = Map.prototype.jumpTo;
    Map.prototype.jumpTo = function (...args) { window.circledRoadTestMap = this; return jump.apply(this, args); };
  });
  const data = await (await page.request.get(new URL("api/inspect/geojson", url).href)).json();
  for (const level of [250, 500, 1000]) for (const [code, letter] of [[2252, "S"], [2253, "C"]]) {
    await page.locator("#reference-scale").selectOption(String(level));
    await page.locator("#feature-code").selectOption(String(code));
    await expect(page.locator("#feature-navigation-status")).toContainText(`DMコード${code}・レベル${level}`);
    const point = data.features.find(feature => feature.properties.LEVEL === level && feature.properties.DM_SOURCE_LAYER === `dm_${code}_point`);
    expect(point).toBeTruthy();
    const {getZoomByScale} = await import("../src/core/map-scale.js");
    await page.evaluate(({code, level, center, zoom}) => {
      const map = window.circledRoadTestMap;
      for (const layer of map.getStyle().layers) {
        if (layer.type === "background") continue;
        const visible = layer.source === "dm" && layer.metadata?.["dm:source-layer"] === `dm_${code}_point` && layer.id.includes(`-${level}-`);
        map.setLayoutProperty(layer.id, "visibility", visible ? "visible" : "none");
      }
      map.jumpTo({center, zoom});
    }, {code, level, center: point.geometry.coordinates, zoom: getZoomByScale(level, point.geometry.coordinates[1]) + 3});
    for (const type of ["circle", "symbol"]) await expect.poll(async () => page.evaluate(({code, level, type}) => window.circledRoadTestMap.queryRenderedFeatures().filter(feature =>
      feature.source === "dm" && feature.properties.DMCODE === code && feature.properties.LEVEL === level && feature.layer.type === type).length,
    {code, level, type}), {timeout: 30000}).toBeGreaterThan(0);
    expect(await page.evaluate(({code, level}) => window.circledRoadTestMap.getStyle().layers.find(layer =>
      layer.metadata?.["dm:source-layer"] === `dm_${code}_point` && layer.id.includes(`-${level}-`) && layer.type === "symbol").layout["text-field"], {code, level})).toBe(letter);
    await page.evaluate(() => new Promise(resolve => {
      const map = window.circledRoadTestMap;
      map.once("idle", resolve);
      for (const layer of map.getStyle().layers) if (layer.source === "dm-highlight") map.setLayoutProperty(layer.id, "visibility", "none");
      map.getSource("dm-highlight")?.setData({type: "FeatureCollection", features: []});
      map.triggerRepaint();
    }));
    const box = await page.locator("#map").boundingBox();
    const png = await page.screenshot({path: testInfo.outputPath(`${code}-${level}.png`), clip: {x: box.x + box.width/2 - 64, y: box.y + box.height/2 - 64, width: 128, height: 128}});
    const {Resvg} = await import("@resvg/resvg-js");
    const image = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><image width="128" height="128" href="data:image/png;base64,${png.toString("base64")}"/></svg>`).render();
    const {blackComponents} = await import("./helpers/raster-components.js");
    const components = blackComponents(image.pixels, 128, 128).filter(component => component.width > 10 && component.height > 10).sort((a, b) => b.width - a.width);
    expect(components, `${code}/${level} outer ring and letter`).toHaveLength(2);
    const [ring, glyph] = components;
    expect(Math.abs(glyph.centerX - ring.centerX)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(glyph.centerY - ring.centerY)).toBeLessThanOrEqual(1.5);
    const pixelsPerMm = 96 / 25.4 * 8;
    expect(Math.abs(ring.width / pixelsPerMm - 2)).toBeLessThan(0.08);
    expect(Math.abs(glyph.height / pixelsPerMm - 1.35)).toBeLessThan(0.08);
  }
  expect(errors).toEqual([]);
});

test("catalog renders large-scale rail crossbars and retains the coarse 2305 pattern", async ({page}, testInfo) => {
  test.setTimeout(600000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(url);
  await expect(page.locator("header #reference-scale")).toBeEnabled({timeout: 180000});
  await page.evaluate(async () => {
    const {Map} = await import("./vendor/maplibre-gl.mjs"); const jump = Map.prototype.jumpTo;
    Map.prototype.jumpTo = function (...args) { window.railTestMap = this; return jump.apply(this, args); };
  });
  const geojson = await (await page.request.get(new URL("api/inspect/geojson", url).href)).json();
  for (const level of [250, 500, 1000]) for (const code of [2304, 2305]) {
    const sourceLayer = `dm_${code}_line_deco_line`;
    const ticks = geojson.features.filter(feature => feature.properties.LEVEL === level && feature.properties.DM_SOURCE_LAYER === sourceLayer);
    expect(ticks).toHaveLength(5);
    expect(ticks.every(feature => feature.geometry.type === "LineString" && feature.geometry.coordinates.length === 2 && feature.properties.DECORATION === "perpendicular_tick")).toBe(true);
    await page.locator("#reference-scale").selectOption(String(level));
    await page.locator("#feature-code").selectOption(String(code));
    await expect(page.locator("#feature-navigation-status")).toContainText(`DMコード${code}・レベル${level}`);
    await expect.poll(async () => page.evaluate(({sourceLayer, level}) => new Set(window.railTestMap.queryRenderedFeatures()
      .filter(feature => feature.source === "dm" && feature.properties.LEVEL === level && feature.properties.DM_SOURCE_LAYER === sourceLayer)
      .map(feature => `${feature.properties.DM_TABLE}:${feature.properties.fid}`)).size, {sourceLayer, level}), {timeout: 30000}).toBe(5);
    expect(await page.evaluate(({sourceLayer, level}) => window.railTestMap.getStyle().layers.find(layer =>
      layer.metadata?.["dm:source-layer"] === sourceLayer && layer.id.includes(`-${level}-`)).metadata["dm:pen-number"], {sourceLayer, level})).toBe(code === 2304 ? 8 : 6);
    await page.evaluate(() => {
      const map = window.railTestMap;
      for (const layer of map.getStyle().layers) if (layer.source === "dm-highlight") map.setLayoutProperty(layer.id, "visibility", "none");
      map.setZoom(map.getZoom() + 1);
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.locator("#map").screenshot({path: testInfo.outputPath(`${code}-${level}.png`)});
  }
  for (const level of [2500, 5000]) {
    expect(geojson.features.filter(feature => feature.properties.LEVEL === level && feature.properties.DM_SOURCE_LAYER === "dm_2305_line_deco_line")).toHaveLength(9);
    expect(geojson.features.filter(feature => feature.properties.LEVEL === level && feature.properties.DM_SOURCE_LAYER === "dm_2304_line_deco_line")).toHaveLength(0);
  }
  expect(errors).toEqual([]);
});

test("catalog renders 2306 attached triangles at every map level", async ({page}, testInfo) => {
  test.setTimeout(600000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(url);
  await expect(page.locator("header #reference-scale")).toBeEnabled({timeout: 180000});
  await page.evaluate(async () => {
    const {Map} = await import("./vendor/maplibre-gl.mjs"); const jump = Map.prototype.jumpTo;
    Map.prototype.jumpTo = function (...args) { window.ropewayTestMap = this; return jump.apply(this, args); };
  });
  const data = await (await page.request.get(new URL("api/inspect/geojson", url).href)).json();
  for (const level of INSPECT_LEVELS) {
    const shapes = data.features.filter(feature => feature.properties.LEVEL === level && feature.properties.DM_SOURCE_LAYER === "dm_2306_line_deco_line");
    expect(shapes).toHaveLength(4);
    expect(shapes.every(feature => feature.properties.DECORATION === "attached_triangles" && feature.geometry.type === "LineString" && feature.geometry.coordinates.length === 5)).toBe(true);
    await page.locator("#reference-scale").selectOption(String(level));
    await page.locator("#feature-code").selectOption("2306");
    await expect(page.locator("#feature-navigation-status")).toContainText(`DMコード2306・レベル${level}`);
    await expect.poll(async () => page.evaluate(level => new Set(window.ropewayTestMap.queryRenderedFeatures()
      .filter(feature => feature.source === "dm" && feature.properties.LEVEL === level && feature.properties.DM_SOURCE_LAYER === "dm_2306_line_deco_line")
      .map(feature => `${feature.properties.DM_TABLE}:${feature.properties.fid}`)).size, level), {timeout: 30000}).toBe(4);
    expect(await page.evaluate(level => window.ropewayTestMap.getStyle().layers.find(layer =>
      layer.metadata?.["dm:source-layer"] === "dm_2306_line_deco_line" && layer.id.includes(`-${level}-`)).metadata["dm:pen-number"], level)).toBe(level <= 1000 ? 3 : 2);
    await page.evaluate(() => {
      const map = window.ropewayTestMap;
      for (const layer of map.getStyle().layers) if (layer.source === "dm-highlight") map.setLayoutProperty(layer.id, "visibility", "none");
      map.setZoom(map.getZoom() + 1);
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.locator("#map").screenshot({path: testInfo.outputPath(`2306-${level}.png`)});
  }
  expect(errors).toEqual([]);
});

test("catalog navigation keeps 2419 direction icons visible at every map level", async ({page}, testInfo) => {
  test.setTimeout(180000);
  await page.goto(url);
  await expect(page.locator("header #reference-scale")).toBeEnabled({timeout: 180000});
  await page.evaluate(async () => {
    const {Map} = await import("./vendor/maplibre-gl.mjs"); const jump = Map.prototype.jumpTo;
    Map.prototype.jumpTo = function (...args) { window.tunnelTestMap = this; return jump.apply(this, args); };
  });
  for (const level of INSPECT_LEVELS) {
    await page.locator("#reference-scale").selectOption(String(level));
    await page.locator("#feature-code").selectOption("2306");
    await page.locator("#feature-code").selectOption("2419");
    await expect(page.locator("#feature-navigation-status")).toContainText(`DMコード2419・レベル${level}`);
    await expect.poll(async () => page.evaluate(level => [...new Set(window.tunnelTestMap.queryRenderedFeatures()
      .filter(feature => feature.source === "dm" && feature.properties.LEVEL === level && feature.properties.DM_SOURCE_LAYER === "dm_2419_point")
      .map(feature => feature.properties.ROTATION))].sort((a,b) => a-b), level), {timeout: 30000}).toEqual([0, 90]);
    await page.locator("#map").screenshot({path: testInfo.outputPath(`2419-${level}.png`)});
  }
});

test("catalog renders 2421 plain circles at large map levels", async ({page}, testInfo) => {
  test.setTimeout(180000);
  await page.goto(url);
  await expect(page.locator("header #reference-scale")).toBeEnabled({timeout: 180000});
  await page.evaluate(async () => {
    const {Map} = await import("./vendor/maplibre-gl.mjs"); const jump = Map.prototype.jumpTo;
    Map.prototype.jumpTo = function (...args) { window.tunnelTestMap = this; return jump.apply(this, args); };
  });
  for (const level of [250, 500, 1000]) {
    await page.locator("#reference-scale").selectOption(String(level));
    await page.locator("#feature-code").selectOption("2306");
    await page.locator("#feature-code").selectOption("2421");
    await expect(page.locator("#feature-navigation-status")).toContainText(`DMコード2421・レベル${level}`);
    await expect.poll(async () => page.evaluate(level => [...new Set(window.tunnelTestMap.queryRenderedFeatures()
      .filter(feature => feature.source === "dm" && feature.properties.LEVEL === level && feature.properties.DM_SOURCE_LAYER === "dm_2421_point")
      .map(feature => feature.layer.type))], level), {timeout: 30000}).toEqual(["circle"]);
    await page.locator("#map").screenshot({path: testInfo.outputPath(`2421-${level}.png`)});
  }
});

for (const code of [2425, 2428]) test(`catalog renders ${code} dashed lines at large map levels`, async ({page}, testInfo) => {
  test.setTimeout(180000);
  await page.goto(url);
  await expect(page.locator("header #reference-scale")).toBeEnabled({timeout: 180000});
  await page.evaluate(async () => {
    const {Map} = await import("./vendor/maplibre-gl.mjs"); const jump = Map.prototype.jumpTo;
    Map.prototype.jumpTo = function (...args) { window.tunnelTestMap = this; return jump.apply(this, args); };
  });
  for (const level of [250, 500, 1000]) {
    await page.locator("#reference-scale").selectOption(String(level));
    await page.locator("#feature-code").selectOption("2306");
    await expect(page.locator("#feature-navigation-status")).toContainText(`DMコード2306・レベル${level}`, {timeout: 30000});
    await page.locator("#feature-code").selectOption(String(code));
    await expect(page.locator("#feature-navigation-status")).toContainText(`DMコード${code}・レベル${level}`, {timeout: 30000});
    await expect.poll(async () => page.evaluate(({level, code}) => [...new Set(window.tunnelTestMap.queryRenderedFeatures()
      .filter(feature => feature.source === "dm" && feature.properties.LEVEL === level && feature.properties.DM_SOURCE_LAYER === `dm_${code}_line`)
      .map(feature => feature.layer.type))], {level, code}), {timeout: 30000}).toEqual(["line"]);
    expect(await page.evaluate(({level, code}) => window.tunnelTestMap.getStyle().layers.find(layer => layer.id === `dm-${code}-line-${level}-line-level-${level}`).paint["line-dasharray"], {level, code})).toEqual([6.666667, 3.333333]);
    await page.locator("#map").screenshot({path: testInfo.outputPath(`${code}-${level}.png`)});
  }
});

test("catalog renders 2401 rotating square points at large map levels", async ({page}, testInfo) => {
  test.setTimeout(180000);
  await page.goto(url);
  await expect(page.locator("header #reference-scale")).toBeEnabled({timeout: 180000});
  await page.evaluate(async () => {
    const {Map} = await import("./vendor/maplibre-gl.mjs"); const jump = Map.prototype.jumpTo;
    Map.prototype.jumpTo = function (...args) { window.bridgeTestMap = this; return jump.apply(this, args); };
  });
  for (const level of [250, 500, 1000]) {
    await page.locator("#reference-scale").selectOption(String(level));
    await page.locator("#feature-code").selectOption("2306");
    await expect(page.locator("#feature-navigation-status")).toContainText(`DMコード2306・レベル${level}`, {timeout: 30000});
    await page.locator("#feature-code").selectOption("2401");
    await expect(page.locator("#feature-navigation-status")).toContainText(`DMコード2401・レベル${level}`, {timeout: 30000});
    await expect.poll(async () => page.evaluate(level => [...new Set(window.bridgeTestMap.queryRenderedFeatures()
      .filter(feature => feature.source === "dm" && feature.properties.LEVEL === level && feature.properties.DM_SOURCE_LAYER === "dm_2401_point")
      .map(feature => feature.properties.ROTATION))].sort((a,b) => a-b), level), {timeout: 30000}).toEqual([0, 90]);
    expect(await page.evaluate(level => window.bridgeTestMap.getStyle().layers.find(layer =>
      layer.id === `dm-2401-point-${level}-symbol-point-level-${level}`).metadata["dm:icon-dimensions-mm"].side, level)).toBe(1);
    await page.locator("#map").screenshot({path: testInfo.outputPath(`2401-${level}.png`)});
  }
});

test("catalog renders 3403 staggered circles within paved polygons at large map levels", async ({page}, testInfo) => {
  test.setTimeout(180000);
  await page.goto(url);
  await expect(page.locator("header #reference-scale")).toBeEnabled({timeout: 180000});
  await page.evaluate(async () => {
    const {Map} = await import("./vendor/maplibre-gl.mjs"); const jump = Map.prototype.jumpTo;
    Map.prototype.jumpTo = function (...args) { window.pavedTestMap = this; return jump.apply(this, args); };
  });
  const data = await (await page.request.get(new URL("api/inspect/geojson", url).href)).json();
  for (const level of [250, 500, 1000]) {
    const circles = data.features.filter(f => f.properties.LEVEL === level && f.properties.DM_SOURCE_LAYER === "dm_3403_polygon_deco_point");
    expect(circles.length).toBeGreaterThan(100);
    expect(circles.every(f => f.geometry.type === "Point" && f.properties.DECORATION === "staggered_circles")).toBe(true);
    await page.locator("#reference-scale").selectOption(String(level));
    await page.locator("#feature-code").selectOption("2306");
    await expect(page.locator("#feature-navigation-status")).toContainText(`DMコード2306・レベル${level}`, {timeout: 30000});
    await page.locator("#feature-code").selectOption("3403");
    await expect(page.locator("#feature-navigation-status")).toContainText(`DMコード3403・レベル${level}`, {timeout: 30000});
    await expect.poll(async () => page.evaluate(level => new Set(window.pavedTestMap.queryRenderedFeatures()
      .filter(f => f.source === "dm" && f.properties.LEVEL === level && f.properties.DM_SOURCE_LAYER === "dm_3403_polygon_deco_point")
      .map(f => `${f.properties.DM_TABLE}:${f.properties.fid}`)).size, level), {timeout: 30000}).toBe(circles.length);
    await page.locator("#map").screenshot({path: testInfo.outputPath(`3403-${level}.png`)});
  }
  expect(data.features.filter(f => [2500,5000].includes(f.properties.LEVEL) && f.properties.DM_SOURCE_LAYER === "dm_3403_polygon_deco_point")).toEqual([]);
});

test("catalog renders corrected office museum and church symbols at their native levels", async ({page}, testInfo) => {
  test.setTimeout(300000);
  await page.goto(url);
  await expect(page.locator("header #reference-scale")).toBeEnabled({timeout: 180000});
  await page.evaluate(async () => {
    const {Map} = await import("./vendor/maplibre-gl.mjs"); const jump = Map.prototype.jumpTo;
    Map.prototype.jumpTo = function (...args) { window.buildingTestMap = this; return jump.apply(this, args); };
  });
  for (const code of [3512,3513,3518,3527,3523]) for (const level of code === 3523 ? INSPECT_LEVELS : [250,500,1000]) {
    await page.locator("#reference-scale").selectOption(String(level));
    await page.locator("#feature-code").selectOption("2306");
    await expect(page.locator("#feature-navigation-status")).toContainText(`DMコード2306・レベル${level}`, {timeout: 30000});
    await page.locator("#feature-code").selectOption(String(code));
    await expect(page.locator("#feature-navigation-status")).toContainText(`DMコード${code}・レベル${level}`, {timeout: 30000});
    await expect.poll(async () => page.evaluate(({code,level}) => new Set(window.buildingTestMap.queryRenderedFeatures()
      .filter(f => f.source === "dm" && f.properties.LEVEL === level && f.properties.DM_SOURCE_LAYER === `dm_${code}_point`)
      .map(f => `${f.properties.DM_TABLE}:${f.properties.fid}`)).size, {code,level}), {timeout: 30000}).toBe(sampleCount(code,level,"point"));
    expect(await page.evaluate(({code,level}) => {
      const map = window.buildingTestMap;
      const layer = map.getStyle().layers.find(l => l.id === `dm-${code}-point-${level}-symbol-point-level-${level}`);
      return map.hasImage(layer.layout["icon-image"]);
    }, {code,level})).toBe(true);
    await page.locator("#map").screenshot({path: testInfo.outputPath(`${code}-${level}.png`)});
  }
});

for (const code of [3528,3529,3552,3559,4101,4111,4119,4121,4131,4132,4141,4142,4151,4161,4208,4215,4224,4226,4238,4245,4231,4227,3556,4228]) {
  test(`public facility ${code} icon at native levels`, async ({page}, testInfo) => {
    test.setTimeout(180000);
    await page.goto(url);
    await expect(page.locator("header #reference-scale")).toBeEnabled({timeout: 180000});
    await page.evaluate(async () => {
      const {Map} = await import("./vendor/maplibre-gl.mjs"); const jump = Map.prototype.jumpTo;
      Map.prototype.jumpTo = function (...args) { window.publicIconMap = this; return jump.apply(this, args); };
    });
    for (const level of code === 4227 ? [250,500] : [250,500,1000]) {
      await page.locator("#reference-scale").selectOption(String(level));
      await page.locator("#feature-code").selectOption("2306");
      await expect(page.locator("#feature-navigation-status")).toContainText(`DMコード2306・レベル${level}`, {timeout: 30000});
      await page.locator("#feature-code").selectOption(String(code));
      await expect(page.locator("#feature-navigation-status")).toContainText(`DMコード${code}・レベル${level}`, {timeout: 30000});
      await expect.poll(async () => page.evaluate(({code,level}) => new Set(window.publicIconMap.queryRenderedFeatures()
        .filter(f => f.source === "dm" && f.properties.LEVEL === level && f.properties.DM_SOURCE_LAYER === `dm_${code}_point`)
        .map(f => `${f.properties.DM_TABLE}:${f.properties.fid}`)).size, {code,level}), {timeout: 30000}).toBe(sampleCount(code,level,"point"));
      expect(await page.evaluate(({code,level}) => {
        const map=window.publicIconMap;const layer=map.getStyle().layers.find(l=>l.id===`dm-${code}-point-${level}-symbol-point-level-${level}`);
        return map.hasImage(layer.layout["icon-image"]);
      }, {code,level})).toBe(true);
      await page.locator("#map").screenshot({path:testInfo.outputPath(`${code}-${level}.png`)});
    }
  });
}

let waterTerrainData;
test.describe('water terrain patterns',()=>{
  test.describe.configure({mode:'parallel'});
  const codes=[4262,4265,5105,5106,5202,5204,5211,5212,5213,5214,5219,5226,5227,5231,5232,5235,5237,6101,6102,6110,6111,6112,6113,6121,6122,6123,6130,6131,6132];
  const allLevels=new Set([4262,4265,5105,5202,5211]);
  const icons=new Set([5105,5106,5204,5219]);
  const dashed=new Set([5213,5214,5227,5235,5237]);
  for(const code of codes)test(`code ${code} displays the specified geometry and figure classes`,async({page},testInfo)=>{
    test.setTimeout(240000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);await expect(page.locator('header #reference-scale')).toBeEnabled({timeout:180000});
    await page.evaluate(async()=>{const{Map}=await import('./vendor/maplibre-gl.mjs');const jump=Map.prototype.jumpTo;Map.prototype.jumpTo=function(...args){window.waterTerrainMap=this;return jump.apply(this,args);};});
    const data=await(waterTerrainData??=page.request.get(new URL('api/inspect/geojson',url).href).then(r=>r.json()));
    for(const level of allLevels.has(code)?INSPECT_LEVELS:[250,500,1000]){
      await page.locator('#reference-scale').selectOption(String(level));await page.locator('#feature-code').selectOption('2306');
      await expect(page.locator('#feature-navigation-status')).toContainText(`DMコード2306・レベル${level}`,{timeout:30000});
      await page.locator('#feature-code').selectOption(String(code));await expect(page.locator('#feature-navigation-status')).toContainText(`DMコード${code}・レベル${level}`,{timeout:30000});
      const selected=data.features.filter(f=>f.properties.DMCODE===code&&f.properties.LEVEL===level);
      const auxiliary=selected.filter(f=>f.properties.DM_SOURCE_LAYER.includes('_deco_'));
      if(!icons.has(code)&&!dashed.has(code)){
        expect(auxiliary.length).toBeGreaterThan(0);
        await expect.poll(async()=>page.evaluate(({code,level})=>new Set(window.waterTerrainMap.queryRenderedFeatures().filter(f=>f.source==='dm'&&f.properties.DMCODE===code&&f.properties.LEVEL===level&&f.properties.DM_SOURCE_LAYER?.includes('_deco_')).map(f=>`${f.properties.DM_TABLE}:${f.properties.fid}`)).size,{code,level}),{timeout:45000}).toBe(auxiliary.length);
      }else{
        const layer=`dm_${code}_${icons.has(code)?'point':'line'}`;
        const expected=selected.filter(f=>f.properties.DM_SOURCE_LAYER===layer).length;expect(expected).toBeGreaterThan(0);
        await expect.poll(async()=>page.evaluate(({layer,level})=>new Set(window.waterTerrainMap.queryRenderedFeatures().filter(f=>f.source==='dm'&&f.properties.LEVEL===level&&f.properties.DM_SOURCE_LAYER===layer).map(f=>`${f.properties.DM_TABLE}:${f.properties.fid}`)).size,{layer,level}),{timeout:45000}).toBe(expected);
      }
      if([5211,5212,5226,5231,6101,6102,6110,6111,6112,6113].includes(code)){
        const originals=new Map(selected.filter(f=>f.properties.DM_SOURCE_LAYER===`dm_${code}_line`).map(f=>[`${f.properties.DM_TABLE}:${f.properties.USER_ID}`,f]));
        expect(auxiliary.every(f=>originals.get(`${f.properties.SRC_LAYER}:${f.properties.SRC_USER_ID}`)?.properties.DMFIGTYPE===11)).toBe(true);
      }
      if(code===6132){expect(auxiliary.some(f=>f.geometry.type==='Polygon'&&f.properties.DECORATION==='guardrail_semicircle')).toBe(true);expect(auxiliary.some(f=>f.geometry.type==='Point'&&f.properties.DECORATION==='guardpipe_circle')).toBe(true);}
      await page.locator('#map').screenshot({path:testInfo.outputPath(`${code}-${level}.png`)});
    }
    expect(errors).toEqual([]);
  });
});

test.describe('enclosure landuse patterns',()=>{
  const codes=[6133,6134,6136,6137,6140,6141,6142,6211,6212,6213,6217,6231,6232,6233,6322,6340,6341,6342,7105,7106,7108,7199];
  const points=new Set([6211,6212,6213,6217,6231,6232,6233,6322,6340,6341,6342]);
  for(const level of INSPECT_LEVELS)test(`level ${level} displays all applicable enclosure and land-use symbols`,async({page},testInfo)=>{
    test.setTimeout(300000);
    const errors=[],glyphRequests=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>{if(r.url().includes('/glyphs/'))glyphRequests.push(r.url());});
    await page.goto(url);
    const stateUrl=new URL('api/inspect/state',url).href;
    await expect.poll(async()=>(await(await page.request.get(stateUrl)).json()).status,{timeout:30000}).toBe('idle');
    const before=await(await page.request.get(stateUrl)).json();
    await expect(page.locator('header #reference-scale')).toBeEnabled();
    await page.evaluate(async()=>{const{Map}=await import('./vendor/maplibre-gl.mjs');const jump=Map.prototype.jumpTo;Map.prototype.jumpTo=function(...args){window.enclosureMap=this;return jump.apply(this,args);};});
    const data=await(await page.request.get(new URL('api/inspect/geojson',url).href)).json();
    await page.locator('#reference-scale').selectOption(String(level));
    for(const code of level<=1000?codes:[6217]){
      await page.locator('#feature-code').selectOption(String(code));
      await expect(page.locator('#feature-navigation-status')).toContainText(`DMコード${code}・レベル${level}`,{timeout:30000});
      const selected=data.features.filter(f=>f.properties.DMCODE===code&&f.properties.LEVEL===level);
      const auxiliary=selected.filter(f=>f.properties.DM_SOURCE_LAYER.includes('_deco_'));
      const original=`dm_${code}_point`;
      const expected=points.has(code)?selected.filter(f=>f.properties.DM_SOURCE_LAYER===original).length:auxiliary.length;
      expect(expected,`${code}/${level} input`).toBeGreaterThan(0);
      await expect.poll(async()=>page.evaluate(({code,level,point})=>new Set(window.enclosureMap.queryRenderedFeatures().filter(f=>f.source==='dm'&&f.properties.DMCODE===code&&f.properties.LEVEL===level&&(point?f.properties.DM_SOURCE_LAYER===`dm_${code}_point`:f.properties.DM_SOURCE_LAYER?.includes('_deco_'))).map(f=>`${f.properties.DM_TABLE}:${f.properties.fid}`)).size,{code,level,point:points.has(code)}),{timeout:45000}).toBe(expected);
      if([6141,6142].includes(code)){
        const both=selected.find(f=>f.properties.DM_SOURCE_LAYER===`dm_${code}_line`&&f.properties.DMFIGTYPE===46);
        expect(both).toBeDefined();expect(auxiliary.filter(f=>f.properties.SRC_USER_ID===both.properties.USER_ID).length).toBeGreaterThan(1);
      }
      if(code===6211)expect(glyphRequests.some(url=>url.includes('/31232-31487.pbf'))).toBe(true);
      await page.locator('#map').screenshot({path:testInfo.outputPath(`${code}-${level}.png`)});
    }
    expect((await(await page.request.get(stateUrl)).json()).lastRun).toBe(before.lastRun);
    expect(errors).toEqual([]);
  });
});

test.describe('catalog geometry layout',()=>{
  for(const level of INSPECT_LEVELS)test(`level ${level} orders supported geometries and names drawing classes`,async({page},testInfo)=>{
    test.setTimeout(240000);await page.goto(url);
    await expect(page.locator('header #reference-scale')).toBeEnabled({timeout:180000});
    await page.evaluate(async()=>{const{Map}=await import('./vendor/maplibre-gl.mjs');const jump=Map.prototype.jumpTo;Map.prototype.jumpTo=function(...args){window.layoutMap=this;return jump.apply(this,args);};});
    const data=await(await page.request.get(new URL('api/inspect/geojson',url).href)).json();
    await page.locator('#reference-scale').selectOption(String(level));
    for(const code of level<=1000?[2419,3553,2235,6132,6141,7213,4262,6101,2203]:[2419,7213,4262,2203]){
      await page.locator('#feature-code').selectOption(String(code));
      await expect(page.locator('#feature-navigation-status')).toContainText(`DMコード${code}・レベル${level}`,{timeout:30000});
      const originals=data.features.filter(f=>f.properties.DMCODE===code&&f.properties.LEVEL===level&&/^dm_\d+_(point|line|polygon)$/.test(f.properties.DM_SOURCE_LAYER));
      expect(originals.length).toBeGreaterThan(0);
      await expect.poll(async()=>page.evaluate(({code,level})=>new Set(window.layoutMap.queryRenderedFeatures().filter(f=>f.source==='dm'&&f.properties.DMCODE===code&&f.properties.LEVEL===level&&/^dm_\d+_(point|line|polygon)$/.test(f.properties.DM_SOURCE_LAYER)).map(f=>`${f.properties.DM_TABLE}:${f.properties.fid}`)).size,{code,level}),{timeout:45000}).toBe(originals.length);
      const labels=data.features.filter(f=>f.properties.DMCODE===code&&f.properties.LEVEL===level&&f.properties.DM_SOURCE_LAYER==='inspect_labels').map(f=>f.properties.TEXT);
      if(code===2419)expect(labels).toEqual(expect.arrayContaining(['方向点 0°','方向点 90°','線','ポリゴン']));
      if(code===6132)expect(labels).toEqual(expect.arrayContaining(['線 区分26','線 区分27']));
      if(code===6141)expect(labels).toEqual(expect.arrayContaining(['線','線 区分46']));
      if(code===2235)expect(originals.every(f=>f.geometry.type==='Polygon')).toBe(true);
      if(code===3553)expect(originals.filter(f=>f.geometry.type==='Point').map(f=>f.properties.ROTATION??0)).toEqual([0]);
      await page.locator('#map').screenshot({path:testInfo.outputPath(`layout-${code}-${level}.png`)});
    }
  });
});

const floatingTextInkBounds = async (page, screenshot) => page.evaluate(async base64 => {
  const img=new Image();img.src=`data:image/png;base64,${base64}`;await img.decode();
  const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
  const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);const pixels=ctx.getImageData(0,0,img.width,img.height).data;
  const em=2*96/25.4*8*24/23,cx=img.width/2,cy=img.height/2;
  return [[-24,-12],[-11.5,11.5],[12,24]].map(([from,to])=>{
    let top=Infinity,bottom=-Infinity,count=0;
    for(let y=Math.floor(cy-em);y<=cy+em;y++)for(let x=Math.floor(cx+from/24*em);x<=cx+to/24*em;x++){
      const i=(y*img.width+x)*4;
      if(pixels[i]<100&&pixels[i+1]<100&&pixels[i+2]<100&&pixels[i+3]>200){top=Math.min(top,y);bottom=Math.max(bottom,y);count++;}
    }
    return {top,bottom,count,center:(top+bottom)/2};
  });
},screenshot.toString('base64'));

test.describe('corrected water and slope symbols',()=>{
  for(const level of INSPECT_LEVELS)test(`level ${level} renders circle rows, enclosed fills and aligned text`,async({page},testInfo)=>{
    test.setTimeout(300000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);await expect(page.locator('header #reference-scale')).toBeEnabled({timeout:180000});
    await page.evaluate(async()=>{const{Map}=await import('./vendor/maplibre-gl.mjs');const jump=Map.prototype.jumpTo;Map.prototype.jumpTo=function(...a){window.correctionMap=this;return jump.apply(this,a);};});
    const data=await(await page.request.get(new URL('api/inspect/geojson',url).href)).json();
    await page.locator('#basemap').uncheck();
    await page.locator('#reference-scale').selectOption(String(level));
    for(const code of level<=1000?[4262,4265,5106,5204,5226,5227,5232,6101,6110,6111,6112,6113,6123,6132]:[4265,5226,5227,5232]){
      await page.locator('#feature-code').selectOption(String(code));
      await expect(page.locator('#feature-navigation-status')).toContainText(`DMコード${code}・レベル${level}`,{timeout:30000});
      const selected=data.features.filter(f=>f.properties.DMCODE===code&&f.properties.LEVEL===level);
      const aux=selected.filter(f=>f.properties.DM_SOURCE_LAYER.includes('_deco_'));
      if(aux.length)await expect.poll(()=>page.evaluate(({code,level})=>new Set(window.correctionMap.queryRenderedFeatures().filter(f=>f.source==='dm'&&f.properties.DMCODE===code&&f.properties.LEVEL===level&&f.properties.DM_SOURCE_LAYER?.includes('_deco_')).map(f=>`${f.properties.DM_TABLE}:${f.properties.fid}`)).size,{code,level}),{timeout:45000}).toBe(aux.length);
      if(code===5232){
        expect(aux.length).toBeGreaterThan(0);
        expect(await page.evaluate(()=>window.correctionMap.getStyle().layers.filter(l=>l['source-layer']==='dm_5232_polygon'||l.metadata?.['dm:source-layer']==='dm_5232_polygon').filter(l=>l.type==='line').every(l=>l.paint['line-opacity']===0))).toBe(true);
      }
      if(code===6101){
        const lower=selected.filter(f=>f.properties.DM_SOURCE_LAYER==='dm_6101_line'&&f.properties.DMFIGTYPE===12);
        expect(lower.length).toBe(2);expect(lower.some(f=>f.geometry.coordinates.length===4)).toBe(true);
        await expect.poll(()=>page.evaluate(level=>new Set(window.correctionMap.queryRenderedFeatures().filter(f=>f.source==='dm'&&f.properties.LEVEL===level&&f.properties.DM_SOURCE_LAYER==='dm_6101_line'&&f.properties.DMFIGTYPE===12).map(f=>`${f.properties.DM_TABLE}:${f.properties.fid}`)).size,level)).toBe(2);
      }
      if(code===5226){
        const originals=new Map(selected.filter(f=>f.properties.DM_SOURCE_LAYER==='dm_5226_line').map(f=>[`${f.properties.DM_TABLE}:${f.properties.USER_ID}`,f]));
        expect(aux.length).toBeGreaterThan(0);expect(aux.every(f=>originals.get(`${f.properties.SRC_LAYER}:${f.properties.SRC_USER_ID}`)?.properties.DMFIGTYPE===(level<=1000?11:12))).toBe(true);
      }
      await page.locator('#map').screenshot({path:testInfo.outputPath(`${code}-${level}.png`)});
      if([5106,5204,6123,6132].includes(code)){
        const detail=selected.find(f=>f.properties.DM_SOURCE_LAYER===`dm_${code}_point`)??aux[0];
        const coordinates=detail.geometry.type==='Point'?[detail.geometry.coordinates]:detail.geometry.type==='Polygon'?detail.geometry.coordinates[0]:detail.geometry.coordinates;
        const center=[0,1].map(i=>coordinates.reduce((sum,p)=>sum+p[i],0)/coordinates.length);
        await page.evaluate(center=>window.correctionMap.jumpTo({center,zoom:window.correctionMap.getZoom()+3}),center);
        await expect.poll(()=>page.evaluate(()=>window.correctionMap.isStyleLoaded())).toBe(true);
        await expect.poll(()=>page.evaluate(()=>window.correctionMap.areTilesLoaded())).toBe(true);
        if(code===5204)await expect.poll(()=>page.evaluate(level=>new Set(window.correctionMap.queryRenderedFeatures().filter(f=>f.source==='dm'&&f.properties.LEVEL===level&&f.properties.DM_SOURCE_LAYER==='dm_5204_point').map(f=>f.layer.id)).size,level)).toBe(3);
        const screenshot=await page.locator('#map').screenshot({path:testInfo.outputPath(`${code}-${level}-detail.png`)});
        if(code===5204){
          const bounds=await floatingTextInkBounds(page,screenshot);expect(bounds.every(b=>b.count>20),JSON.stringify(bounds)).toBe(true);
          expect(Math.abs(bounds[0].center-bounds[1].center),JSON.stringify(bounds)).toBeLessThanOrEqual(1.5);
          expect(Math.abs(bounds[2].center-bounds[1].center),JSON.stringify(bounds)).toBeLessThanOrEqual(1.5);
        }
      }
    }
    expect(errors).toEqual([]);
  });
});

let nativeIconData;
test.describe('native icon paper sizes',()=>{
 for(const level of [500,1000])test(`level ${level} keeps the PDF dimensions at the reference scale`,async({page},testInfo)=>{
  test.setTimeout(300000);await page.goto(url);await expect(page.locator('#reference-scale')).toBeEnabled({timeout:180000});
  await page.evaluate(async()=>{const{Map}=await import('./vendor/maplibre-gl.mjs');const jump=Map.prototype.jumpTo;Map.prototype.jumpTo=function(...args){window.nativeIconMap=this;return jump.apply(this,args);};});
  await page.locator('#basemap').uncheck();await page.locator('#reference-scale').selectOption(String(level));
  for(const code of [3560,6318]){
   await page.locator('#feature-code').selectOption(String(code));await expect(page.locator('#feature-navigation-status')).toContainText(`DMコード${code}・レベル${level}`,{timeout:30000});
   await page.locator('#zoom-scale').click();
   const scale=await page.evaluate(async level=>{const{getZoomByScale}=await import('./assets/core/map-scale.js');const m=window.nativeIconMap;return [m.getZoom(),getZoomByScale(level,m.getCenter().lat)];},level);expect(Math.abs(scale[0]-scale[1])).toBeLessThan(1e-7);
   await expect.poll(()=>page.evaluate(({code,level})=>window.nativeIconMap.queryRenderedFeatures().some(f=>f.source==='dm'&&f.properties.LEVEL===level&&f.properties.DM_SOURCE_LAYER===`dm_${code}_point`),{code,level}),{timeout:30000}).toBe(true);
   await page.locator('#map').screenshot({path:testInfo.outputPath(`${code}-${level}-reference.png`)});
  }
  const data=await(nativeIconData??=page.request.get(new URL('api/inspect/geojson',url).href).then(r=>r.json()));
  const setup=await page.evaluate(async({level,features})=>{
   const{Map}=await import('./vendor/maplibre-gl.mjs');const{getZoomByScale}=await import('./assets/core/map-scale.js');
   const original=window.nativeIconMap.getStyle();const layers=original.layers.filter(l=>l.source==='dm'&&l.metadata?.['dm:style-origin']==='individual'&&l.id.includes(`-point-${level}-`)).map(l=>l.layout?.['icon-image']?{...l,layout:{...l.layout,'icon-rotate':0}}:l);
   const codes=[...new Set(layers.map(l=>Number(l.id.match(/^dm-(\d+)/)?.[1])).filter(Number.isFinite))].sort((a,b)=>a-b);
   const chosen=codes.map(code=>features.find(f=>f.properties.LEVEL===level&&f.properties.DM_SOURCE_LAYER===`dm_${code}_point`)).filter(Boolean);
   const container=document.createElement('div');container.id='native-size-chart';Object.assign(container.style,{position:'fixed',left:'0',top:'0',width:'1000px',height:'1000px',zIndex:'9999',background:'white'});document.body.append(container);
   const lat=layers[0].metadata['dm:size-reference-latitude'];const zoom=getZoomByScale(level,lat)+2;
   const map=new Map({container,style:{version:8,sprite:original.sprite,glyphs:original.glyphs,sources:{dm:{type:'geojson',data:{type:'FeatureCollection',features:[]}}},layers:[{id:'background',type:'background',paint:{'background-color':'white'}},...layers]},center:[139,lat],zoom,maxZoom:24,localIdeographFontFamily:false,attributionControl:false,maplibreLogo:false});window.nativeChartMap=map;
   await new Promise(resolve=>map.once('load',resolve));
   const expected=Object.fromEntries(layers.filter(l=>l.metadata['dm:icon-native-size']).map(l=>[Number(l.id.match(/^dm-(\d+)/)[1]),{...l.metadata['dm:icon-native-size'],canvas:l.metadata['dm:icon-canvas-mm'],pen:l.metadata['dm:icon-pen']} ]));
   return{features:chosen,codes:chosen.map(f=>f.properties.DMCODE),expected};
  },{level,features:data.features.filter(f=>f.geometry.type==='Point')});
  console.log('native point icon count',level,setup.codes.length);
  expect(setup.codes).toContain(3560);expect(setup.codes).toContain(6318);
  for(let start=0;start<setup.features.length;start+=25){
   const batch=setup.features.slice(start,start+25);
   await page.evaluate(features=>{
    const map=window.nativeChartMap;const all=map.getStyle().layers;
    const number=e=>{if(typeof e==='number')return e;if(e?.[0]==='*')return e.slice(1).reduce((p,x)=>p*number(x),1);const stops=e.slice(3),z=map.getZoom();for(let i=2;i<stops.length;i+=2)if(z<=stops[i]){const ratio=(2**(z-stops[i-2])-1)/(2**(stops[i]-stops[i-2])-1);return stops[i-1]*(1-ratio)+stops[i+1]*ratio;}return stops.at(-1);};
    const rows=features.map((f,i)=>{const center=[100+i%5*200,100+Math.floor(i/5)*200],layer=all.find(l=>l.id.startsWith(`dm-${f.properties.DMCODE}-point-`)&&l.layout?.['icon-image']);const offset=layer?.layout['icon-offset']??[0,0],size=layer?number(layer.layout['icon-size']):0;return{...f,properties:{...f.properties,ROTATION:0},geometry:{type:'Point',coordinates:map.unproject([center[0]-offset[0]*size,center[1]-offset[1]*size]).toArray()}};});
    map.getSource('dm').setData({type:'FeatureCollection',features:rows});
    document.querySelectorAll('.native-code-label').forEach(e=>e.remove());features.forEach((f,i)=>{const label=document.createElement('span');label.className='native-code-label';label.textContent=String(f.properties.DMCODE);Object.assign(label.style,{position:'absolute',left:`${10+i%5*200}px`,top:`${180+Math.floor(i/5)*200}px`,font:'12px sans-serif',background:'white'});document.querySelector('#native-size-chart').append(label);});
   },batch);
   await expect.poll(()=>page.evaluate(()=>new Set(window.nativeChartMap.queryRenderedFeatures().filter(f=>f.source==='dm').map(f=>f.properties.DMCODE)).size),{timeout:30000}).toBe(batch.length);
   await page.locator('.native-code-label').evaluateAll(labels=>labels.forEach(l=>l.style.visibility='hidden'));
   const buffer=await page.locator('#native-size-chart').screenshot();
   const ink=await page.evaluate(async({base64,count})=>{
    const image=new Image();image.src=`data:image/png;base64,${base64}`;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,image.width,image.height).data;
    return Array.from({length:count},(_,i)=>{const cx=100+i%5*200,cy=100+Math.floor(i/5)*200;let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;for(let y=cy-96;y<=cy+96;y++)for(let x=cx-96;x<=cx+96;x++){const at=(y*image.width+x)*4;if(pixels[at]<245&&pixels[at+1]<245&&pixels[at+2]<245){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}}return{width:(right-left+1)/(96/25.4*4),height:(bottom-top+1)/(96/25.4*4)};});
   },{base64:buffer.toString('base64'),count:batch.length});
   for(const [i,f]of batch.entries()){
    const code=f.properties.DMCODE,expected=setup.expected[code];if(!expected)continue;const tolerance=2*expected.canvas/32+.04;
    for(const axis of ['width','height']){expect(ink[i][axis],`${code}/${level} ${axis}`).toBeGreaterThan(expected[axis]-tolerance);expect(ink[i][axis],`${code}/${level} ${axis}`).toBeLessThan(expected[axis]+expected.pen*.1+tolerance);}
   }
   await page.locator('.native-code-label').evaluateAll(labels=>labels.forEach(l=>l.style.visibility='visible'));
   await page.locator('#native-size-chart').screenshot({path:testInfo.outputPath(`native-icons-${level}-${start/25+1}.png`)});
  }
  await page.evaluate(()=>window.nativeChartMap.remove());
 });
});
