import {defineConfig} from "playwright/test";

export default defineConfig({
  testDir: ".", testMatch: ["inspect.spec.js", "catalog.spec.js"], workers: 1, timeout: 60000,
  outputDir: "../test-results", reporter: "list",
  use: {headless: true, viewport: {width: 1600, height: 1000},
    launchOptions: {args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]}},
});
