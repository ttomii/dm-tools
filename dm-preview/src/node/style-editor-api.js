import {cp, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile} from "node:fs/promises";
import path from "node:path";
import {editableKinds, editableLayers} from "../core/style-editing.js";
import {SPRITE_FILES} from "../core/sprite-policy.js";
import {readBody, sendJson} from "./http-response.js";
import {publishStyleBundle} from "./style-bundle-publisher.js";

export const STYLE_EDITOR_PATH = "/preview/api/style-editor/state";

const STYLE_EDITOR_BODY_LIMIT = 20 * 1024 * 1024;

export const respondStyleEditor = async (request, response, root, options) => {
  if (request.method === "GET" || request.method === "HEAD") {
    await respondStyleEditorState(request, response, root);
    return;
  }
  if (request.method === "PUT") {
    await updateStyleEditorState(request, response, root, options);
    return;
  }
  response.writeHead(405, {Allow: "GET, HEAD, PUT"});
  response.end();
};

const respondStyleEditorState = async (request, response, root) => {
  const stylePath = path.join(root, "style.json");
  let style;
  try {
    style = JSON.parse(await readFile(stylePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      sendJson(request, response, 200, {writable: true, style: null, editableKinds: [], editableLayers: []});
      return;
    }
    sendJson(request, response, 500, {error: `style.json cannot be read: ${error.message}`});
    return;
  }
  sendJson(request, response, 200, {
    writable: true,
    style,
    editableKinds: editableKinds(style),
    editableLayers: editableLayers(style),
  });
};

const updateStyleEditorState = async (request, response, root, options) => {
  const stylePath = path.join(root, "style.json");
  const writable = await stylePathStatus(stylePath).catch((error) => {
    sendJson(request, response, 500, {error: `style.json cannot be checked: ${error.message}`});
    return "failed";
  });
  if (writable === "failed") return;
  if (writable === "not-file") {
    sendJson(request, response, 409, {error: "style.json is not writable"});
    return;
  }
  let body;
  try {
    body = JSON.parse(await readBody(request, STYLE_EDITOR_BODY_LIMIT));
  } catch (error) {
    sendJson(request, response, 400, {error: error.message});
    return;
  }
  if (!isStyle(body.style)) {
    sendJson(request, response, 400, {error: "style must be a MapLibre Style v8 object"});
    return;
  }
  if (body.sprites !== undefined && !isRecord(body.sprites)) {
    sendJson(request, response, 400, {error: "sprites must be an object"});
    return;
  }
  await saveStyleEditorState(request, response, root, options, body);
};

const stylePathStatus = async (stylePath) => {
  try {
    const metadata = await stat(stylePath);
    return metadata.isFile() ? "writable" : "not-file";
  } catch (error) {
    if (error.code === "ENOENT") return "writable";
    throw error;
  }
};

const saveStyleEditorState = async (request, response, root, options, body) => {
  let staging;
  try {
    staging = await mkdtemp(path.join(root, ".dm-preview-style-"));
    await stageStyleAssets(root, staging, options.maplibreAssets, body.sprites);
    await writeFile(path.join(staging, "style.json"), `${JSON.stringify(body.style, undefined, 2)}\n`);
    await publishStyleBundle(root, staging, {
      reportCleanupError: (error) => options.diagnosticLog?.({event: "style-backup-cleanup-failed", error: error.message}),
    });
  } catch (error) {
    sendJson(request, response, 500, {error: `style editor save failed: ${error.message}`});
    return;
  } finally {
    if (staging) await rm(staging, {recursive: true, force: true});
  }
  sendJson(request, response, 200, {ok: true});
};

const stageStyleAssets = async (root, staging, maplibreAssets, sprites) => {
  await copyStyleAssetDirectory(root, staging, maplibreAssets, "sprite", true);
  if (sprites) await writeSpriteFiles(staging, sprites);
  await copyStyleAssetDirectory(root, staging, maplibreAssets, "glyphs", false);
};

const copyStyleAssetDirectory = async (root, staging, maplibreAssets, name, required) => {
  const existing = path.join(root, name);
  const source = await exists(existing) ? existing : path.join(maplibreAssets ?? "", name);
  const sourceReal = await realpath(source).catch(() => undefined);
  if (!sourceReal || !(await isDirectory(sourceReal))) {
    if (required) throw new Error(`${name} assets are not available`);
    return;
  }
  await cp(sourceReal, path.join(staging, name), {recursive: true});
};

const writeSpriteFiles = async (root, sprites) => {
  const spriteRoot = path.join(root, "sprite");
  await mkdir(spriteRoot, {recursive: true});
  for (const [file, value] of Object.entries(sprites)) {
    if (!SPRITE_FILES.has(file)) throw new Error(`unsupported sprite file: ${file}`);
    const output = path.join(spriteRoot, file);
    if (file.endsWith(".json")) {
      if (!isRecord(value)) throw new Error(`${file} must be an object`);
      await writeFile(output, `${JSON.stringify(value, undefined, 2)}\n`);
    } else {
      if (typeof value !== "string") throw new Error(`${file} must be a data URL`);
      await writeFile(output, decodePngDataUrl(value));
    }
  }
};

const decodePngDataUrl = (value) => {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) throw new Error("sprite PNG must be a PNG data URL");
  return Buffer.from(match[1], "base64");
};

const exists = async (file) => stat(file).then(() => true, () => false);

const isDirectory = async (file) => (await stat(file)).isDirectory();

const isRecord = (value) => typeof value === "object" && Boolean(value) && !Array.isArray(value);

const isStyle = (value) => isRecord(value) && value.version === 8 && isRecord(value.sources);
