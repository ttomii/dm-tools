import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdir, mkdtemp, readFile, rm, writeFile, readdir} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createInspectSession} from "../src/node/inspect-session.js";
import {dmCodes} from "../src/core/dm-layer-names.js";
import {createInspectCatalogDm, inspectCatalogCases, inspectCatalogOrigin, inspectSourceKind, INSPECT_LEVELS} from "../src/core/inspect-catalog.js";
import {prepareInspectCatalogRoot, writeInspectCatalog} from "../src/node/inspect-catalog.js";

const temporaryRoot = async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-catalog-test-"));
  context.after(() => rm(root, {recursive: true, force: true}));
  return root;
};

test("catalog covers every registered code and style-only code with geometry and attribute variants", () => {
  const cases = inspectCatalogCases([{layers: [{"source-layer": "dm_7777_polygon"}]}]);
  assert.deepEqual(new Set(cases.map(sample => sample.code)), new Set([...dmCodes(), 7777]));
  assert.deepEqual(cases.filter(sample => sample.code === 1102).map(sample => [sample.kind, sample.figtype]), [["line", 0]]);
  assert.deepEqual(cases.filter(sample => sample.code === 3553).map(sample => sample.kind), ["point"]);
  assert.deepEqual(cases.filter(sample => sample.code === 8100).map(sample => sample.kind), ["text", "text"]);
  assert.deepEqual(cases.filter(sample => sample.code === 7777).map(sample => sample.kind), ["polygon"]);
  assert.equal(new Set(cases.map(sample => sample.elementId)).size, cases.length);
  assert.ok(cases.every(sample => sample.elementId <= 9999));
});

test("DM serialization uses fixed-width coordinates, level, stable element IDs and text records", () => {
  const sample = {code: 1102, kind: "line", figtype: 11, elementId: 49, column: 0, row: 0, slot: 0};
  const rows = createInspectCatalogDm([sample], 500).split("\r\n");
  assert.equal(rows[0].slice(30, 35).trim(), "500");
  assert.equal(rows[1].slice(44, 47).trim(), "10");
  assert.equal(rows[5].slice(0, 6), "E21102");
  assert.equal(rows[5].slice(12, 16).trim(), "49");
  assert.equal(rows[5].slice(18, 21), "112");
  assert.equal(rows[5].slice(27, 35), "   3   1");
  const [originX] = inspectCatalogOrigin(sample, 500);
  assert.equal(Number(rows[6].slice(21, 28)), originX + 2500);
  assert.equal(Number(rows[6].slice(28, 35)), 400);
  assert.equal(Number(rows[6].slice(35, 42)), originX + 3500);
  const annotation = createInspectCatalogDm([{...sample, code: 8100, kind: "text"}], 5000).split("\r\n");
  assert.equal(annotation[5].slice(0, 6), "E78100");
  assert.equal(annotation[6].slice(20, 27), "DM 8100");
  assert.throws(() => createInspectCatalogDm([{...sample, elementId: 10000}], 500));
});

test("catalog materializes DM input at every requested level and can resume its own directory", async (context) => {
  const root = await temporaryRoot(context);
  const prepared = await prepareInspectCatalogRoot(root);
  const result = await writeInspectCatalog(prepared.input, [250, 500, 2500, 5000]);
  assert.ok(result.codes.length >= dmCodes().length);
  assert.deepEqual((await readdir(prepared.input)).sort(), ["level-250.dm", "level-2500.dm", "level-500.dm", "level-5000.dm"]);
  for (const level of [250, 500, 2500, 5000]) {
    const dm = await readFile(path.join(prepared.input, `level-${level}.dm`), "utf8");
    assert.match(dm, /E21102/);
    assert.match(dm, /E56340/);
    assert.match(dm, /E78100/);
    assert.equal(dm.split("\r\n")[0].slice(30, 35).trim(), String(level));
  }
  await writeFile(path.join(root, "session.json"), JSON.stringify({catalog: 1}));
  assert.equal((await prepareInspectCatalogRoot(root)).catalog, 1);
});

test("catalog rejects unrelated output directories", async (context) => {
  const root = await temporaryRoot(context);
  await writeFile(path.join(root, "keep.txt"), "keep");
  await assert.rejects(prepareInspectCatalogRoot(root), {name: "InputError"});
  await writeFile(path.join(root, "session.json"), JSON.stringify({input: "original.dm"}));
  await assert.rejects(prepareInspectCatalogRoot(root), {name: "InputError"});
});


test("catalog always requests all codes and all levels in GeoPackage format", async (context) => {
  const root = await temporaryRoot(context);
  let args;
  const session = await createInspectSession({workDir: root, converter: "/bin/true"}, {
    runConverter: (options) => {
      args = options.args;
      return {completed: Promise.resolve({code: 1}), cancel: () => {}, kill: () => {}};
    },
  });
  context.after(() => session.close());
  session.start([250], 1102);
  for (let attempt = 0; attempt < 200 && session.state().status === "running"; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(session.state().status, "failed");
  assert.equal(args[2].endsWith("inspect.gpkg"), true);
  assert.deepEqual(args.slice(3), ["--format", "gpkg", "--input-datum", "jgd2024", "--decorations", "true", "--include-levels", INSPECT_LEVELS.join(",")]);
  for (const level of INSPECT_LEVELS) {
    const input = await readFile(path.join(root, "catalog-input", `level-${level}.dm`), "utf8");
    assert.match(input, /E21102/); assert.match(input, /E56340/);
  }
});

test("codes run north to south in aligned rows with increasing level columns", () => {
  const cases = inspectCatalogCases([]);
  const first = cases.find(sample => sample.code === 1101);
  const next = cases.find(sample => sample.code === 1102);
  const origins = INSPECT_LEVELS.map(level => inspectCatalogOrigin(first, level));
  assert.ok(origins.every((origin, index) => !index || origin[0] > origins[index - 1][0]));
  assert.ok(origins.every(origin => origin[1] === origins[0][1]));
  assert.equal(origins[0][1] - inspectCatalogOrigin(next, 250)[1], 16000);
  for (const level of INSPECT_LEVELS) assert.ok(createInspectCatalogDm(cases, level).split("\r\n").every(line => !line || line.length === 84));
});

test("catalog cache is reused only for the same converter and a complete source set", async context => {
  const {canReuseInspectCatalog, readInspectCatalogCases} = await import("../src/node/inspect-catalog.js");
  const {hashFile} = await import("../src/node/inspect-files.js");
  const root = await temporaryRoot(context);
  const converter = path.join(root, "converter");
  await writeFile(converter, "original binary");
  const {createHash} = await import("node:crypto");
  const cases = await readInspectCatalogCases();
  const inputs = INSPECT_LEVELS.map(level => ({path: `level-${level}.dm`, sha256: createHash("sha256").update(createInspectCatalogDm(cases, level)).digest("hex")}));
  const record = {converterHash: await hashFile(converter), inputs};
  await writeFile(path.join(root, "execution.json"), JSON.stringify(record));
  const sourceLayers = [...new Set((await readInspectCatalogCases()).map(sample => `dm_${sample.code}_${inspectSourceKind(sample.kind)}`))];
  const output = {root, manifest: {catalogLayout: 3, sourceLayers}};
  assert.equal(await canReuseInspectCatalog(output, converter), true);
  assert.equal(await canReuseInspectCatalog({...output, manifest: {...output.manifest, catalogLayout: 1}}, converter), false);
  assert.equal(await canReuseInspectCatalog({...output, manifest: {...output.manifest, sourceLayers: sourceLayers.slice(1)}}, converter), false);
  await writeFile(path.join(root, "execution.json"), JSON.stringify({...record, inputs: inputs.map(input => ({...input, sha256: "old geometry"}))}));
  assert.equal(await canReuseInspectCatalog(output, converter), false);
  await writeFile(path.join(root, "execution.json"), JSON.stringify(record));
  await writeFile(converter, "new binary");
  assert.equal(await canReuseInspectCatalog(output, converter), false);
});

test("bridge catalog uses parallel opposite edges at each code's valid levels", () => {
  const cases = inspectCatalogCases([]);
  for (const [code, level] of [[2203, 2500], [2203, 5000], [2204, 250], [2204, 500], [2204, 1000]]) {
    const rows = createInspectCatalogDm(cases.filter(sample => sample.code === code && sample.kind === "line"), level).split("\r\n");
    const geometries = rows.flatMap((row, index) => row.startsWith(`E2${code}`) ? [{
      count: Number(row.slice(27, 31)),
      points: [0, 14].map(offset => [Number(rows[index + 1].slice(offset + 7, offset + 14)), Number(rows[index + 1].slice(offset, offset + 7))]),
    }] : []);
    assert.equal(geometries.length, 2);
    const [first, second] = geometries;
    assert.equal(first.count, 2); assert.equal(second.count, 2);
    assert.equal(first.points[0][1], first.points[1][1]);
    assert.equal(second.points[0][1], second.points[1][1]);
    assert.equal(first.points[0][0], second.points[1][0]);
    assert.equal(first.points[1][0], second.points[0][0]);
    assert.equal(second.points[0][1] - first.points[0][1], 6 * level / 10);
    assert.equal(first.points[1][0] - first.points[0][0], 40 * level / 10);
  }
});

test("2204 catalog covers 500 and 1000 plus inherited level 250", () => {
  const cases = inspectCatalogCases([]).filter(sample => sample.code === 2204);
  for (const level of [2500, 5000]) assert.doesNotMatch(createInspectCatalogDm(cases, level), /E22204/);
  for (const level of [250, 500, 1000]) assert.match(createInspectCatalogDm(cases, level), /E22204/);
});

test("footbridge catalog uses straight centerlines at every preview level", () => {
  const cases = inspectCatalogCases([]).filter(sample => sample.code === 2205 && sample.kind === "line");
  for (const level of INSPECT_LEVELS) {
    const rows = createInspectCatalogDm(cases, level).split("\r\n");
    const lines = rows.flatMap((row, index) => row.startsWith("E22205") ? [rows[index + 1]] : []);
    assert.equal(lines.length, 1);
    assert.ok(rows.filter(row => row.startsWith("E22205")).every(row => Number(row.slice(27, 31)) === 2));
    for (const row of lines) assert.equal(Number(row.slice(0, 7)), Number(row.slice(14, 21)));
  }
});

test("2213 at large scales uses a plain straight sample", () => {
  const cases = inspectCatalogCases([]).filter(sample => sample.code === 2213 && sample.kind === "line");
  for (const level of [250, 500, 1000]) {
    const rows = createInspectCatalogDm(cases, level).split("\r\n");
    const headers = rows.filter(row => row.startsWith("E22213"));
    assert.equal(headers.length, 1);
    assert.ok(headers.every(row => Number(row.slice(27, 31)) === 2));
  }
});

test("real catalog styles include E1 polygon samples for 2235 and 2236", async () => {
  const {readInspectCatalogCases} = await import("../src/node/inspect-catalog.js");
  const cases = await readInspectCatalogCases();
  for (const code of [2235, 2236]) {
    const polygons = cases.filter(sample => sample.code === code && sample.kind === "polygon");
    assert.deepEqual(polygons.map(sample => sample.figtype), [0]);
    for (const level of [250, 500, 1000]) {
      assert.match(createInspectCatalogDm(polygons, level), new RegExp(`E1${code}`));
    }
  }
});

test('native inspection samples include pipe figure 47 and guardrail figures 26/27', async()=>{
 const {readFile}=await import('node:fs/promises');const styles=await Promise.all([500,1000,2500,5000].map(async n=>JSON.parse(await readFile(new URL(`../static/maplibre/style-${n}.json`,import.meta.url)))));
 const cases=inspectCatalogCases(styles);
 assert.deepEqual(cases.filter(c=>c.code===6132&&c.kind==='line'&&c.levels.includes(500)).map(c=>c.figtype),[26,27]);
 assert.ok(cases.filter(c=>c.code===4262&&c.kind==='line').every(c=>c.figtype===47));
});

test('upper/lower inspection samples form a six mm band and pipe figure 47 is native only',()=>{
 const upper={code:6101,kind:'line',figtype:11,elementId:1,row:0,rows:1,slot:0};const lower={...upper,figtype:12,elementId:2,slot:1};
 const rows=createInspectCatalogDm([upper,lower],500).split('\r\n');
 assert.equal(Number(rows[8].slice(14,21))-Number(rows[6].slice(0,7)),-300);
 assert.equal(Number(rows[8].slice(7,14)),Number(rows[6].slice(21,28)));
 assert.equal(Number(rows[10].slice(7,14))-Number(rows[8].slice(7,14)),2500);
 const pipe={...upper,code:4262,figtype:47};assert.ok(createInspectCatalogDm([pipe],500).includes('E24262'));assert.equal(createInspectCatalogDm([pipe],2500).includes('E24262'),false);
});
