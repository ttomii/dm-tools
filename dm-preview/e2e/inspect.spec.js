import {spawn} from "node:child_process";
import {once} from "node:events";
import {mkdtemp, readFile, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {test, expect} from "playwright/test";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let child;
let root;
let url;

test.beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "dm-inspect-e2e-"));
  const converter = process.env.DM_CONVERTER ?? path.resolve(packageRoot, "../dm-converter/target/release/dm-converter");
  child = spawn(process.execPath, [path.join(packageRoot, "bin/dm-preview.js"), "inspect",
    path.join(packageRoot, "test/fixtures/inspect"), "--work-dir", root, "--converter", converter, "--no-open"],
  {stdio: ["ignore", "pipe", "pipe"]});
  url = await new Promise((resolve, reject) => {
    let errors = "";
    child.stderr.on("data", (data) => { errors += data; });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`inspect exited ${code}: ${errors}`)));
    child.stdout.on("data", (data) => {
      const match = data.toString().match(/http:\/\/127\.0\.0\.1:\d+\/preview\//);
      if (match) resolve(match[0]);
    });
  });
});

test.afterAll(async () => {
  if (child?.exitCode === null) { const ended = once(child, "exit"); child.kill("SIGTERM"); await ended; }
  if (root) await rm(root, {recursive: true, force: true});
});

test("all levels automatically use formal styles and retain preview selection, editing and reload controls", async ({page}) => {
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await expect(page.locator("#inspect-panel")).toHaveCount(0);
  await expect(page.locator("#inspect-pdf")).toHaveCount(0);
  await expect(page.locator("#inspect-input")).toHaveCount(0);
  await expect(page.locator("#inspect-convert, #inspect-cancel, [name=inspect-level]")).toHaveCount(0);
  await expect(page.locator("#data-generation-status")).toHaveText("変換完了", {timeout: 30000});
  await expect(page.locator("#reference-scale option")).toHaveText(["1:250", "1:500", "1:1000", "1:2500", "1:5000"]);
  await page.locator("#feature-code").selectOption("1101");
  await expect(page.locator("#feature-navigation-status")).toContainText("レベル500の地物へ移動しました");
  await page.locator("#feature-code").selectOption("2204");
  await expect(page.locator("#feature-navigation-status")).toContainText("DMコード2204・レベル500");
  await expect(page.locator("#properties")).toContainText("2204");
  await expect(page.locator("#status")).toContainText("center 139.833444,36.000203");
  await page.locator("#feature-code").selectOption("3553");
  await expect(page.locator("#feature-navigation-status")).toContainText("変換結果にありません");
  await expect(page.locator("#properties")).toBeEmpty();
  await expect(page.locator("#feature-list button")).toHaveCount(0);
  const initialManifest = await (await page.request.get(new URL("pmtiles-manifest.json", url).href)).json();
  expect(initialManifest.levels).toEqual([250, 500, 2500, 5000]);
  await expect(page.locator("#inspect-mode")).toHaveCount(0);
  await expect(page.locator("header #zoom-scale")).toBeEnabled();
  await expect(page.locator("#zoom-scale")).toBeEnabled();
  expect(await page.locator("#feature-code option").count()).toBeGreaterThan(200);
  await expect(page.locator('#feature-code option[value="3553"]')).toHaveText("3553 揚水機場");
  await page.locator("#feature-code").selectOption("1101");
  await page.evaluate(async () => {
    const {Map} = await import("./vendor/maplibre-gl.mjs"); const fit = Map.prototype.fitBounds;
    Map.prototype.fitBounds = function (...args) { window.inspectTestMap = this; return fit.apply(this, args); };
  });
  await page.locator("#feature-layer").selectOption("dm_1101_line_deco_line");
  await page.locator("#feature-list button").first().click();
  await expect(page.locator("#properties")).toContainText("SRC_LAYER");
  const canvas = page.locator(".maplibregl-canvas");
  await expect(page.locator("#status")).toContainText("z20.");
  let hit;
  await expect.poll(async () => {
    hit = await page.evaluate(() => {
      const map = window.inspectTestMap;
      const canvas = map.getCanvas();
      for (const feature of map.queryRenderedFeatures().filter(feature => feature.source === "dm")) {
        const lines = feature.geometry.type === "LineString" ? [feature.geometry.coordinates]
          : feature.geometry.type === "MultiLineString" ? feature.geometry.coordinates : [];
        for (const line of lines) for (let index = 1; index < line.length; index++) {
          const point = map.project(line[index].map((value, axis) => (value + line[index - 1][axis]) / 2));
          if (point.x > 0 && point.y > 0 && point.x < canvas.clientWidth && point.y < canvas.clientHeight
            && map.queryRenderedFeatures(point).some(item => item.source === "dm")) return {x: point.x, y: point.y};
        }
      }
    });
    return Boolean(hit);
  }).toBe(true);
  await canvas.click({position: hit});
  await expect(page.locator("#hit-list button").first()).toBeVisible();
  await page.locator("#feature-relations").click();
  await expect(page.locator("#feature-relations-list button").first()).toContainText("元地物");
  await page.locator("#feature-relations-list button").first().click();
  await expect(page.locator("#properties")).toContainText("DMELEMID");
  await page.locator("#zoom-scale").click();
  await page.locator("#tab-style-editor").click();
  await page.locator("#style-reload").click();
  const spritesLoaded = page.waitForResponse(response => /\/sprite(?:@2x)?\.json\?v=/.test(response.url()));
  await page.locator("#sprite-reload").click();
  await spritesLoaded;
  await page.locator("#tab-feature-details").click();
  await expect(page.locator("#properties")).toContainText("DMELEMID");
  await page.locator("#tab-style-editor").click();
  await page.locator("#style-kind-line").fill("#123456");
  await page.locator("#style-kind-line").dispatchEvent("input");
  await expect(page.locator("#style-save")).toBeEnabled();
  await page.locator("#style-save").click();
  await expect(page.locator("#style-editor-status")).toHaveText("保存しました");
  const saved = await readFile(path.join(root, "presentation/style.json"), "utf8");
  const previous = (await (await page.request.get(new URL("api/inspect/state", url).href)).json()).lastRun;
  const response = await page.request.post(new URL("api/inspect/convert", url).href, {data: {levels: [250, 500, 2500, 5000]}});
  expect(response.ok()).toBe(true);
  await expect.poll(async () => (await (await page.request.get(new URL("api/inspect/state", url).href)).json()).lastRun).not.toBe(previous);
  await expect(page.locator("#data-generation-status")).toHaveText("変換完了", {timeout: 30000});
  const execution = JSON.parse(await readFile(path.join(root, "session.json")));
  const record = JSON.parse(await readFile(path.join(root, "runs", execution.lastRun, "execution.json")));
  expect(record.args.slice(-2)).toEqual(["--include-levels", "250,500,2500,5000"]);
  await expect(page.locator("#feature-code")).toHaveValue("1101");
  expect(await readFile(path.join(root, "presentation/style.json"), "utf8")).toEqual(saved);
  await expect(page.locator("#properties")).toContainText("DMELEMID");
  await page.locator("#reference-scale").selectOption("250");
  await expect(page.locator("#zoom-scale")).toBeEnabled();
  await page.locator("#feature-layer").selectOption("dm_1101_line");
  await expect(page.locator("#feature-list button")).toHaveCount(4);
  expect(errors).toEqual([]);
});

test("ordinary preview shares the header scale controls and feature navigation", async ({page}) => {
  const converter = process.env.DM_CONVERTER ?? path.resolve(packageRoot, "../dm-converter/target/release/dm-converter");
  const output = path.join(root, "ordinary-preview");
  const conversion = spawn(converter, ["convert", path.join(packageRoot, "test/fixtures/inspect"), output,
    "--format", "pmtiles", "--layer-name", "preview", "--include-levels", "500", "--decorations", "true"], {stdio: ["ignore", "ignore", "pipe"]});
  let conversionErrors = ""; conversion.stderr.on("data", data => { conversionErrors += data; });
  const [exit] = await once(conversion, "exit"); expect(exit, conversionErrors).toBe(0);
  const viewer = spawn(process.execPath, [path.join(packageRoot, "bin/dm-preview.js"), "preview", output, "--no-open"], {stdio: ["ignore", "pipe", "pipe"]});
  try {
    const previewUrl = await new Promise((resolve, reject) => {
      let errors = ""; viewer.stderr.on("data", data => { errors += data; });
      viewer.once("error", reject); viewer.once("exit", code => reject(new Error(`preview exited ${code}: ${errors}`)));
      viewer.stdout.on("data", data => { const match = data.toString().match(/http:\/\/127\.0\.0\.1:\d+\/preview\//); if (match) resolve(match[0]); });
    });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(previewUrl);
    await expect(page.locator("header #zoom-scale")).toBeEnabled();
    await expect(page.locator("#inspect-panel")).toHaveCount(0);
    const codeBox = await page.locator("#feature-code").boundingBox();
    const panelBox = await page.locator("#feature-list-content").boundingBox();
    const searchBox = await page.locator("#feature-layer-filter").boundingBox();
    expect(codeBox.x + codeBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width);
    expect(codeBox.y + codeBox.height).toBeLessThanOrEqual(searchBox.y);
    await expect(page.locator("#data-generation")).toBeHidden();
    await expect(page.locator("#preparation-status")).toBeHidden();
    expect((await page.request.get(new URL("api/inspect/state", previewUrl).href)).status()).toBe(404);
    await page.evaluate(async () => {
      const {Map} = await import("./vendor/maplibre-gl.mjs"); const jump = Map.prototype.jumpTo;
      Map.prototype.jumpTo = function (...args) { window.previewTestMap = this; return jump.apply(this, args); };
    });
    await page.locator("#feature-code").selectOption("1101");
    await expect(page.locator("#feature-navigation-status")).toContainText("DMコード1101・レベル500");
    await expect(page.locator("#properties")).toContainText("1101");
    const listBox = await page.locator("#feature-list").boundingBox();
    const statusBox = await page.locator("#feature-list-status").boundingBox();
    const pagerBox = await page.locator("#feature-list-pager").boundingBox();
    expect(listBox.height).toBeGreaterThan(20);
    expect(listBox.y).toBeGreaterThanOrEqual(statusBox.y + statusBox.height);
    expect(listBox.y + listBox.height).toBeLessThanOrEqual(pagerBox.y);
    await page.locator("#reference-scale").selectOption("250");
    await page.locator("#zoom-scale").click();
    await expect.poll(async () => page.evaluate(async () => {
      const {getScaleByZoom} = await import("./assets/core/map-scale.js");
      const map = window.previewTestMap; return getScaleByZoom(map.getZoom(), map.getCenter().lat);
    })).toBe(250);
    expect(errors).toEqual([]);
  } finally {
    if (viewer.exitCode === null) { const ended = once(viewer, "exit"); viewer.kill("SIGTERM"); await ended; }
  }
});

test("generation logs remain accessible while data controls wait for preparation", async ({page}) => {
  const state = await (await page.request.get(new URL("api/inspect/state", url).href)).json();
  let ready = false;
  await page.route("**/api/inspect/state", route => ready ? route.continue() : route.fulfill({json: {...state, ready: false, status: "running", log: "preparing fixture"}}));
  await page.goto(url);
  await expect(page.locator("#preparation-status")).toHaveText("変換中");
  await expect(page.locator("#feature-code")).toBeDisabled();
  await page.locator("#tab-dmi-info").click();
  await page.locator("#data-generation summary").click();
  await expect(page.locator("#data-generation-log")).toBeVisible();
  await expect(page.locator("#data-generation-log")).toHaveText("preparing fixture");
  ready = true;
  await expect(page.locator("header #zoom-scale")).toBeEnabled();
  await expect(page.locator("#preparation-status")).toBeHidden();
  await page.locator("#tab-feature-list").click();
  await expect(page.locator("#feature-code")).toBeEnabled();
});
