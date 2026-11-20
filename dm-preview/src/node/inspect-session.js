import {INSPECT_LEVELS} from "../core/inspect-catalog.js";
import {writeInspectGpkgMetadata} from "./inspect-gpkg.js";
import {randomUUID} from "node:crypto";
import {mkdir, open, rm} from "node:fs/promises";
import path from "node:path";
import {InputError} from "../core/manifest-policy.js";
import {readManifest} from "./manifest.js";
import {prepareInspectRoot, resolveConverter, saveSession} from "./inspect-files.js";
import {prepareInspectCatalogRoot, readInspectCatalogCases, writeInspectCatalog} from "./inspect-catalog.js";
import {createInspectContext} from "./inspect-context.js";
import {convertInspectInput} from "./inspect-conversion.js";

export const createInspectSession = async (options, dependencies = {}) => {
  const prepared = options.input ? await prepareInspectRoot(options.input, options.workDir) : await prepareInspectCatalogRoot(options.workDir);
  const converter = await resolveConverter(options.converter ?? "dm-converter");
  const descriptor = {version: 1, input: prepared.input, inputDatum: options.inputDatum ?? "jgd2024", converter, ...(prepared.catalog ? {catalog: prepared.catalog} : {})};
  validateSession(prepared.session, descriptor);
  const lock = await open(path.join(prepared.root, ".inspect.lock"), "wx").catch((error) => {
    if (error.code === "EEXIST") throw new InputError("inspect work directory is already in use (.inspect.lock)");
    throw error;
  });
  try {
    return await initializeSession(prepared, descriptor, dependencies, lock);
  } catch (error) {
    await lock.close(); await rm(path.join(prepared.root, ".inspect.lock"), {force: true});
    throw error;
  }
};

const validateSession = (saved, descriptor) => {
  if (!saved) return;
  if (saved.catalog !== descriptor.catalog || saved.version !== 1 || saved.input !== descriptor.input || saved.inputDatum !== descriptor.inputDatum
    || (saved.lastRun && !/^[a-f0-9-]{36}$/.test(saved.lastRun))) {
    throw new InputError("work directory belongs to a different or invalid inspect session");
  }
};

const initializeSession = async (prepared, descriptor, dependencies, lock) => {
  const root = prepared.root;
  const presentation = path.join(root, "presentation");
  await mkdir(presentation, {recursive: true});
  await mkdir(path.join(root, "runs"), {recursive: true});
  const codes = descriptor.catalog ? [...new Set((await readInspectCatalogCases()).map((sample) => sample.code))] : undefined;
  const state = {status: "idle", log: "", lastRun: prepared.session?.lastRun, ...descriptor,
    ...(codes ? {catalogCodes: codes} : {})};
  const context = state.lastRun ? await createInspectContext(root, presentation, state.lastRun, dependencies) : undefined;
  await saveSession(root, {...descriptor, lastRun: state.lastRun});
  return new InspectSession({root, presentation, descriptor}, {state, context, lock}, dependencies);
};

class InspectSession {
  #config;
  #state;
  #context;
  #lock;
  #dependencies;
  #running;
  #job;
  #stopping = false;
  #closePromise;
  #cancelTimer;

  constructor(config, {state, context, lock}, dependencies) {
    this.#config = config;
    this.#state = state;
    this.#context = context;
    this.#lock = lock;
    this.#dependencies = dependencies;
  }

  get root() { return this.#config.root; }
  get presentation() { return this.#config.presentation; }

  state = () => ({...this.#state, ready: Boolean(this.#context)});
  context = () => this.#context;

  start = (levels = INSPECT_LEVELS) => {
    if (!Array.isArray(levels) || !levels.length || levels.some((level) => !INSPECT_LEVELS.includes(level))) {
      throw Object.assign(new Error("変換対象レベルを選択してください。"), {status: 400});
    }
    if (this.#running || this.#stopping) throw Object.assign(new Error("conversion is already running or session is closing"), {status: 409});
    this.#state.status = "running"; this.#state.log = ""; delete this.#state.error;
    this.#running = this.#convert(randomUUID(), this.#config.descriptor.catalog ? INSPECT_LEVELS : [...new Set(levels)]).catch((error) => {
      this.#state.status = "failed"; this.#state.error = error.message;
    }).finally(() => {
      clearTimeout(this.#cancelTimer); this.#cancelTimer = undefined; this.#running = undefined; this.#job = undefined;
    });
  };

  cancel = () => {
    if (!this.#running) return;
    this.#state.status = "cancelling";
    this.#job?.cancel();
    this.#cancelTimer ??= setTimeout(() => this.#job?.kill(), 1500);
  };

  close = () => this.#closePromise ??= this.#shutdown();

  #shutdown = async () => {
    this.#stopping = true; this.cancel();
    const timer = setTimeout(() => this.#job?.kill(), 1500);
    try { await this.#running; } finally {
      clearTimeout(timer); this.#context?.featureStore.close();
      await this.#lock.close(); await rm(path.join(this.root, ".inspect.lock"), {force: true});
    }
  };

  #convert = async (id, levels) => {
    if (this.#config.descriptor.catalog) {
      const catalog = await writeInspectCatalog(this.#config.descriptor.input, levels);
      this.#state.catalogCodes = catalog.codes;
      this.#state.log = `全${catalog.codes.length}コード・${catalog.cases}ケースの確認用DMを生成しました。\n`;
    }
    const succeeded = await convertInspectInput({root: this.root, descriptor: {...this.#config.descriptor, levels}, id}, {
      isCancelled: () => this.#stopping || this.#state.status === "cancelling",
      onProcess: (job) => { this.#job = job; },
      onLog: (chunk) => { this.#state.log = (this.#state.log + chunk).slice(-256 * 1024); },
      getLog: () => this.#state.log,
      execute: this.#dependencies.runConverter,
    });
    if (!succeeded) { this.#state.status = "cancelled"; return; }
    if (this.#config.descriptor.catalog) await writeInspectGpkgMetadata(path.join(this.root, "runs", id), await readInspectCatalogCases(), this.#dependencies);
    else await readManifest(path.join(this.root, "runs", id));
    await saveSession(this.root, {...this.#config.descriptor, lastRun: id});
    await this.#activate(id);
    this.#state.lastRun = id;
    this.#state.status = "succeeded";
  };

  #activate = async (id) => {
    const context = await createInspectContext(this.root, this.presentation, id, this.#dependencies);
    const previous = this.#context;
    this.#context = context;
    previous?.featureStore.close();
  };
}
