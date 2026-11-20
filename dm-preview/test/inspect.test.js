import {request as httpRequest} from "node:http";
import {spawn} from "node:child_process";
import {once} from "node:events";
import assert from "node:assert/strict";
import {chmod, mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {test} from "node:test";
import {parseArguments} from "../src/main.js";
import {runConverter} from "../src/node/inspect-process.js";
import {createInspectSession} from "../src/node/inspect-session.js";
import {createInspectHandler, validLocalRequest} from "../src/node/inspect-api.js";
import {startServer} from "../src/node/server.js";
import {applyInspectMode, diagnosticStyle, relatedQuery} from "../src/core/inspect-style.js";

const fixture = async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm inspect "));
  context.after(() => rm(root, {recursive: true, force: true}));
  const input = path.join(root, "input.dm");
  const converter = path.join(root, "converter with spaces");
  await writeFile(input, "DM input");
  await writeFile(converter, `#!/usr/bin/env node
const {mkdir,writeFile,readFile}=require('node:fs/promises');
const path=require('node:path');
(async()=>{
 const input=process.argv[3], output=process.argv[4];
 const mode=await readFile(input,'utf8');
 if(mode==='fail'){console.error('conversion failed');process.exit(1);}
 if(mode==='wait'){console.error('waiting');await new Promise(r=>setTimeout(r,30000));}
 await mkdir(output,{recursive:true});
 await writeFile(path.join(output,'sample.pmtiles'),'tiles');
 await writeFile(path.join(output,'pmtiles-manifest.json'),JSON.stringify({version:1,layerName:'sample',pmtiles:'sample.pmtiles',levels:[500],bounds:[139,35,140,36],center:[139.5,35.5,16],minZoom:13,maxZoom:18,sourceLayers:['dm_2204_line']}));
})().catch(e=>{console.error(e);process.exit(1)});
`);
  await chmod(converter, 0o755);
  return {root, input, converter, workDir: path.join(root, "work")};
};

const finished = async (session) => {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (!["running", "cancelling"].includes(session.state().status)) return session.state();
    await delay(10);
  }
  assert.fail("conversion did not finish");
};

test("inspect CLI validates required values, datum and ports", () => {
  assert.equal(parseArguments(["inspect", "--work-dir", "catalog"]).input, undefined);
  assert.deepEqual(parseArguments(["inspect", "a.dm", "--work-dir", "work", "--no-open", "--port", "3001"]), {
    command: "inspect", input: "a.dm", workDir: "work", converter: "dm-converter", inputDatum: "jgd2024", noOpen: true, port: 3001,
  });
  for (const args of [["a.dm"], ["a.dm", "--work-dir"], ["a.dm", "--work-dir", "w", "--input-datum", "bad"],
    ["a.dm", "--work-dir", "w", "--port", "65536"], ["a.dm", "--work-dir", "w", "--unknown"]]) {
    assert.throws(() => parseArguments(["inspect", ...args]), {name: "InputError"});
  }
});

test("inspect converts original DM, preserves presentation and failed runs, and resumes", async (context) => {
  const options = await fixture(context);
  const session = await createInspectSession(options);
  context.after(() => session.close());
  assert.equal(session.state().ready, false);
  await writeFile(path.join(session.presentation, "style.json"), '{"version":8}');
  assert.throws(() => session.start([]), {status: 400});
  assert.throws(() => session.start([123]), {status: 400});
  session.start([500, 2500]);
  assert.throws(() => session.start(), {status: 409});
  const success = await finished(session);
  assert.equal(success.status, "succeeded");
  assert.equal(success.ready, true);
  const record = JSON.parse(await readFile(path.join(options.workDir, "runs", success.lastRun, "execution.json")));
  assert.equal(record.args[1], options.input);
  assert.deepEqual(record.args.slice(-2), ["--include-levels", "500,2500"]);
  assert.equal(record.inputs.length, 1);
  assert.match(record.converterHash, /^[a-f0-9]{64}$/);
  assert.equal(session.context().manifest.pmtiles, `inspect-data/${success.lastRun}/sample.pmtiles`);
  await writeFile(options.input, "fail");
  session.start();
  const failure = await finished(session);
  assert.equal(failure.status, "failed");
  assert.equal(failure.lastRun, success.lastRun);
  assert.match(failure.log, /conversion failed/);
  assert.equal(await readFile(path.join(session.presentation, "style.json"), "utf8"), '{"version":8}');
  await session.close();
  const resumed = await createInspectSession(options);
  context.after(() => resumed.close());
  assert.equal(resumed.state().lastRun, success.lastRun);
  assert.equal(resumed.state().ready, true);
  await assert.rejects(createInspectSession(options));
});

test("inspect cancels and closes the converter without publishing incomplete output", async (context) => {
  const options = await fixture(context);
  await writeFile(options.input, "wait");
  const session = await createInspectSession(options);
  context.after(() => session.close());
  session.start();
  for (let i = 0; i < 100 && !session.state().log.includes("waiting"); i++) await delay(10);
  session.cancel();
  const state = await finished(session);
  assert.equal(state.status, "cancelled");
  assert.equal(state.ready, false);
  await session.close();
  await session.close();
});

test("inspect rejects overlapping input/output and unrelated work directories", async (context) => {
  const options = await fixture(context);
  await assert.rejects(createInspectSession({...options, workDir: options.root}), {name: "InputError"});
  const directory = path.join(options.root, "source");
  await mkdir(directory); await writeFile(path.join(directory, "a.dm"), "input");
  await assert.rejects(createInspectSession({...options, input: directory, workDir: path.join(directory, "out")}), {name: "InputError"});
  await mkdir(options.workDir); await writeFile(path.join(options.workDir, "keep"), "existing");
  await assert.rejects(createInspectSession(options), {name: "InputError"});
});

test("inspect server keeps the existing preview UI and pins data URLs to a successful run", async (context) => {
  const options = await fixture(context);
  const session = await createInspectSession(options);
  context.after(() => session.close());
  const {server, url} = await startServer(session.presentation, {
    getContext: session.context, handleRequest: createInspectHandler(session),
  });
  context.after(() => server.close());
  assert.match(await (await fetch(url)).text(), /地物プロパティ/);
  assert.equal((await (await fetch(new URL("api/inspect/state", url))).json()).ready, false);
  const convert = new URL("api/inspect/convert", url);
  assert.equal((await fetch(convert, {method: "POST", headers: {Origin: "https://example.invalid"}})).status, 403);
  assert.equal((await fetch(convert, {method: "POST"})).status, 202);
  await finished(session);
  const manifest = await (await fetch(new URL("pmtiles-manifest.json", url))).json();
  assert.equal(await (await fetch(new URL(manifest.pmtiles, url))).text(), "tiles");
  const unavailable = await (await fetch(new URL("maplibre/style-250.json", url))).json();
  assert.equal(unavailable.name, "DM 250");
  assert.equal(unavailable.metadata["dm:figure-basis-level"], 500);
  assert.ok(unavailable.layers.some(layer => layer.source === "dm"));
  assert.equal(validLocalRequest({headers: {host: "example.invalid"}}), false);
  const responseForHost = (host, origin) => new Promise((resolve, reject) => {
    const request = httpRequest(url, {headers: {Host: host, ...origin && {Origin: origin}}}, (response) => {
      response.resume(); resolve(response.statusCode);
    });
    request.once("error", reject); request.end();
  });
  const localhost = `localhost:${new URL(url).port}`;
  assert.equal(await responseForHost(localhost, `http://${localhost}`), 200);
  assert.equal(await responseForHost(localhost, "https://example.invalid"), 403);
  assert.equal(await responseForHost("example.invalid"), 403);
});

test("diagnostic mode includes unknown codes and filters without changing the editable style", () => {
  const original = diagnosticStyle({sourceLayers: ["dm_9999_line", "dm_9999_line_deco_line", "dm_9999_point"]});
  const result = applyInspectMode(original, {mode: "original", level: "250", code: "9999"});
  assert.deepEqual(result.layers[2].filter.at(-1), ["==", 1, 0]);
  assert.equal(original.layers[2].filter, undefined);
  assert.equal(result.layers[3].type, "circle");
  const filtered = applyInspectMode(original, {levels: [500, 2500]});
  assert.deepEqual(filtered.layers[1].filter, ["all", ["in", ["get", "LEVEL"], ["literal", [500, 2500]]]]);
  const colored = applyInspectMode(original, {mode: "generated"});
  assert.equal(colored.layers[2].paint["line-color"], "#e00070");
  assert.deepEqual(relatedQuery({sourceLayer: "dm_2204_line_deco_line", properties: {
    USER_ID: 9, DMFILE: "a.dm", LEVEL: 500, SRC_LAYER: "dm_2204_line_09_500", SRC_USER_ID: 2, SRC_DMFILE: "a.dm",
  }}), {layer: "dm_2204_line", sourceTable: "dm_2204_line_09_500", userId: 2, dmfile: "a.dm", level: 500});
});

test("inspect CLI closes its server and releases the work directory on SIGTERM", {timeout: 5000}, async (context) => {
  const options = await fixture(context);
  const child = spawn(process.execPath, [path.resolve("bin/dm-preview.js"), "inspect", options.input,
    "--work-dir", options.workDir, "--converter", options.converter, "--no-open"], {stdio: ["ignore", "pipe", "pipe"]});
  context.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  const url = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`inspect exited ${code}`)));
    child.stdout.on("data", (data) => {
      const match = data.toString().match(/http:\/\/127\.0\.0\.1:\d+\/preview\//);
      if (match) resolve(match[0]);
    });
  });
  assert.equal((await fetch(url)).status, 200);
  const exited = once(child, "exit"); child.kill("SIGTERM");
  assert.equal((await exited)[0], 0);
  const resumed = await createInspectSession(options);
  await resumed.close();
});

test("converter process can be forcibly stopped when graceful cancellation is ignored", async () => {
  let ready;
  const started = new Promise((resolve) => { ready = resolve; });
  const job = runConverter({executable: process.execPath,
    args: ["-e", "process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"],
    onLog: ready});
  await started;
  job.kill();
  assert.equal((await job.completed).signal, "SIGKILL");
});
