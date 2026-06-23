import {execFileSync} from "node:child_process";
import {mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetRoot = path.join(packageRoot, "maplibre");
const iconSource = path.join(assetRoot, "icons/source");
const iconPng = path.join(assetRoot, "icons/png");
const spriteRoot = path.join(assetRoot, "sprite");
const selectedSpriteIds = process.argv.slice(2).map((value) => toSpriteId(value));
const spriteOrder = [
  "dm-3503", "dm-3504", "dm-3507", "dm-3509", "dm-3510", "dm-3511",
  "dm-3514", "dm-3515", "dm-3516", "dm-3519", "dm-3521", "dm-3522",
  "dm-3523", "dm-3524", "dm-3530", "dm-3532", "dm-3534", "dm-3548",
  "dm-3549", "dm-4201", "dm-4202", "dm-4219", "dm-4225", "dm-4231",
  "dm-4234", "dm-4235", "dm-4236", "dm-4239", "dm-4241", "dm-5221",
  "dm-6215", "dm-6221", "dm-6222", "dm-6225", "dm-6226", "dm-6311",
  "dm-6313", "dm-6317", "dm-6318", "dm-6319", "dm-6321", "dm-6331",
  "dm-6332", "dm-6333", "dm-6334", "dm-6335", "dm-6336", "dm-6337",
  "dm-7301", "dm-7302", "dm-7308", "dm-2239", "dm-3505",
  "dm-3517", "dm-3525", "dm-3526",
  "dm-3531", "dm-3536",
  "dm-3545", "dm-3546", "dm-3550", "dm-3556", "dm-3560", "dm-4203",
  "dm-4204", "dm-4205", "dm-4207", "dm-4222", "dm-4228",
  "dm-4243", "dm-4251", "dm-5226", "dm-5227", "dm-6212", "dm-6214",
  "dm-6216", "dm-6217", "dm-6314", "dm-6323", "dm-6338", "dm-6340",
  "dm-5105", "dm-7201", "dm-7206", "dm-7211", "dm-7213", "dm-7303", "dm-7305",
  "dm-5241", "dm-5228", "dm-4221", "dm-3401", "dm-4208", "dm-6315",
];
const customSizes = new Map([
  ["dm-5241", {width: 40, height: 8}],
  ["dm-5228", {width: 48, height: 16}],
  ["dm-7201", {width: 64, height: 32}],
  ["dm-7211", {width: 64, height: 32}],
]);

if (selectedSpriteIds.length === 0) {
  rmSync(iconPng, {recursive: true, force: true});
}
mkdirSync(iconSource, {recursive: true});
mkdirSync(iconPng, {recursive: true});
mkdirSync(spriteRoot, {recursive: true});

const iconFiles = walk(iconSource)
  .filter((file) => /\.(svg|bmp|png)$/i.test(file))
  .sort();
const iconEntries = iconFiles.map((relative) => {
  const base = path.basename(relative, path.extname(relative));
  const dmcode = /^\d+$/.test(base) ? base : "";
  const spriteId = dmcode ? `dm-${dmcode}` : "";
  const status = dmcode ? "supported" : "unused";
  const note = dmcode ? "" : "source filename does not identify a DMCode";
  return {relative, dmcode, spriteId, status, note};
});
const iconRows = [["SOURCE_PATH", "DMCODE", "ROLE", "SPRITE_ID", "STATUS", "NOTE"]];
for (const entry of orderIconMappingRows(iconEntries)) {
  iconRows.push([entry.relative, entry.dmcode, "symbol", entry.spriteId, entry.status, entry.note]);
}
const sourcesBySpriteId = new Map(
  iconEntries
    .filter((entry) => entry.spriteId)
    .map((entry) => [entry.spriteId, entry.relative]),
);
const images = spriteOrder.map((spriteId) => {
  const relative = sourcesBySpriteId.get(spriteId);
  if (!relative) {
    throw new Error(`missing sprite source for ${spriteId}`);
  }
  const size = customSizes.get(spriteId) ?? {width: 32, height: 32};
  const output = path.join(iconPng, `${spriteId}.png`);
  const source = path.join(iconSource, relative);
  return {id: spriteId, source, path: output, ...size};
});
writeCsv(path.join(assetRoot, "icons/icon-mapping.csv"), iconRows);

if (selectedSpriteIds.length > 0) {
  const selectedImages = selectedSpriteIds.map((spriteId) => {
    const image = images.find((entry) => entry.id === spriteId);
    if (!image) {
      throw new Error(`unknown sprite id ${spriteId}`);
    }
    return image;
  });
  updateSprite(selectedImages, 1, path.join(spriteRoot, "sprite"));
  updateSprite(selectedImages, 2, path.join(spriteRoot, "sprite@2x"));
} else {
  for (const image of images) {
    renderIcon(image.source, image.path, image.width, image.height);
  }
  generateSprite(images, 1, path.join(spriteRoot, "sprite"));
  generateSprite(images, 2, path.join(spriteRoot, "sprite@2x"));
}

function orderIconMappingRows(entries) {
  const custom = ["dm-5241", "dm-5228"];
  return [
    ...custom.map((spriteId) => entries.find((entry) => entry.spriteId === spriteId)),
    ...entries.filter((entry) => !custom.includes(entry.spriteId)),
  ];
}

function toSpriteId(value) {
  return /^\d+$/.test(value) ? `dm-${value}` : value;
}

function walk(directory, prefix = "") {
  return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
    const relative = path.join(prefix, entry.name);
    return entry.isDirectory()
      ? walk(path.join(directory, entry.name), relative)
      : [relative];
  });
}

function renderIcon(source, output, width, height) {
  const isSvg = source.toLowerCase().endsWith(".svg");
  const renderedSource = isSvg
    ? normalizeSvg(source, output)
    : source;
  const args = [
    renderedSource, "-background", "none", "-resize", `${width}x${height}>`,
    "-gravity", "center", "-extent", `${width}x${height}`,
  ];
  if (isSvg) {
    args.push("-transparent", "white");
  }
  args.push(output);
  execFileSync("convert", args);
  if (renderedSource !== source) {
    rmSync(renderedSource, {force: true});
  }
}

function normalizeSvg(source, output) {
  const normalized = `${output}.normalized.svg`;
  const content = readFileSync(source, "utf8")
    .replaceAll(/param\([^)]+\)\s+([^"'\s;]+)/g, "$1");
  writeFileSync(normalized, content);
  return normalized;
}

function generateSprite(images, ratio, output) {
  const cell = 32 * ratio;
  const width = cell * 10;
  const height = cell * Math.ceil(images.length / 10);
  const canvas = `${output}.png`;
  execFileSync("convert", ["-size", `${width}x${height}`, "xc:none", canvas]);
  const atlasIndex = {};
  let x = 0;
  let y = 0;
  for (let position = 0; position < images.length; position++) {
    const image = images[position];
    const imageWidth = image.width * ratio;
    const imageHeight = image.height * ratio;
    if (x + imageWidth > width) {
      x = 0;
      y += cell;
    }
    const rendered = ratio === 1 ? image.path : `${image.path}.2x.png`;
    if (ratio === 2) {
      renderIcon(image.source, rendered, imageWidth, imageHeight);
    }
    const centeredY = y + Math.floor((cell - imageHeight) / 2);
    execFileSync("convert", [canvas, rendered, "-geometry", `+${x}+${centeredY}`, "-composite", canvas]);
    atlasIndex[image.id] = {width: imageWidth, height: imageHeight, x, y: centeredY, pixelRatio: ratio};
    x += imageWidth;
    const next = images[position + 1];
    if (imageWidth !== cell && next && !customSizes.has(next.id)) {
      x = Math.ceil(x / cell) * cell;
    }
  }
  writeFileSync(`${output}.json`, `${JSON.stringify(atlasIndex, undefined, 2)}\n`);
}

function updateSprite(images, ratio, output) {
  const canvas = `${output}.png`;
  const atlasIndex = JSON.parse(readFileSync(`${output}.json`, "utf8"));
  for (const image of images) {
    const frame = atlasIndex[image.id];
    if (!frame) {
      throw new Error(`missing sprite frame for ${image.id}`);
    }
    const rendered = ratio === 1 ? image.path : `${image.path}.2x.png`;
    renderIcon(image.source, rendered, frame.width, frame.height);
    clearSpriteFrame(canvas, frame);
    execFileSync("convert", [canvas, rendered, "-geometry", `+${frame.x}+${frame.y}`, "-composite", canvas]);
  }
}

function clearSpriteFrame(canvas, frame) {
  const transparentFrame = `${canvas}.${frame.x}-${frame.y}-${frame.width}x${frame.height}.clear.png`;
  execFileSync("convert", ["-size", `${frame.width}x${frame.height}`, "xc:none", transparentFrame]);
  execFileSync("convert", [
    canvas, transparentFrame, "-geometry", `+${frame.x}+${frame.y}`,
    "-compose", "Copy", "-composite", canvas,
  ]);
  rmSync(transparentFrame, {force: true});
}

function writeCsv(file, rows) {
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(file, `${rows.map((row) => row.map(csv).join(",")).join("\n")}\n`);
}

function csv(value) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}
