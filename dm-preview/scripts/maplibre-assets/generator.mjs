import {execFileSync} from "node:child_process";
import {mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import path from "node:path";
import {
  iconEntry,
  orderIconMappingRows,
  SPRITE_ORDER,
  CUSTOM_SIZES,
  spriteSize,
  toSpriteId,
} from "../../src/core/sprite-policy.js";

export const generateMaplibreAssets = ({packageRoot, selectedValues}) => {
  const assetRoot = path.join(packageRoot, "static", "maplibre");
  const iconSource = path.join(assetRoot, "icons/source");
  const iconPng = path.join(assetRoot, "icons/png");
  const spriteRoot = path.join(assetRoot, "sprite");
  const selectedSpriteIds = selectedValues.map((value) => toSpriteId(value));

  if (selectedSpriteIds.length === 0) {
    rmSync(iconPng, {recursive: true, force: true});
  }
  mkdirSync(iconSource, {recursive: true});
  mkdirSync(iconPng, {recursive: true});
  mkdirSync(spriteRoot, {recursive: true});

  const iconEntries = walk(iconSource)
    .filter((file) => /\.(svg|bmp|png)$/i.test(file))
    .sort()
    .map(iconEntry);
  const iconRows = [["SOURCE_PATH", "DMCODE", "ROLE", "SPRITE_ID", "STATUS", "NOTE"]];
  for (const entry of orderIconMappingRows(iconEntries)) {
    iconRows.push([entry.relative, entry.dmcode, "symbol", entry.spriteId, entry.status, entry.note]);
  }
  writeCsv(path.join(assetRoot, "icons/icon-mapping.csv"), iconRows);

  const images = spriteImages(iconEntries, iconSource, iconPng);
  if (selectedSpriteIds.length > 0) {
    const selectedImages = selectedSpriteIds.map((spriteId) => findImage(images, spriteId));
    updateSprite(selectedImages, 1, path.join(spriteRoot, "sprite"));
    updateSprite(selectedImages, 2, path.join(spriteRoot, "sprite@2x"));
    return;
  }
  for (const image of images) {
    renderIcon(image.source, image.path, image.width, image.height);
  }
  generateSprite(images, 1, path.join(spriteRoot, "sprite"));
  generateSprite(images, 2, path.join(spriteRoot, "sprite@2x"));
};

const spriteImages = (iconEntries, iconSource, iconPng) => {
  const sourcesBySpriteId = new Map(
    iconEntries
      .filter((entry) => entry.spriteId)
      .map((entry) => [entry.spriteId, entry.relative]),
  );
  return SPRITE_ORDER.map((spriteId) => {
    const relative = sourcesBySpriteId.get(spriteId);
    if (!relative) throw new Error(`missing sprite source for ${spriteId}`);
    const size = spriteSize(spriteId);
    return {
      id: spriteId,
      source: path.join(iconSource, relative),
      path: path.join(iconPng, `${spriteId}.png`),
      ...size,
    };
  });
};

const findImage = (images, spriteId) => {
  const image = images.find((entry) => entry.id === spriteId);
  if (!image) throw new Error(`unknown sprite id ${spriteId}`);
  return image;
};

const walk = (directory, prefix = "") => readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
  const relative = path.join(prefix, entry.name);
  return entry.isDirectory()
    ? walk(path.join(directory, entry.name), relative)
    : [relative];
});

const renderIcon = (source, output, width, height) => {
  const isSvg = source.toLowerCase().endsWith(".svg");
  const renderedSource = isSvg ? normalizeSvg(source, output) : source;
  const args = [
    renderedSource, "-background", "none", "-resize", `${width}x${height}>`,
    "-gravity", "center", "-extent", `${width}x${height}`,
  ];
  if (isSvg) args.push("-transparent", "white");
  args.push(output);
  execFileSync("convert", args);
  if (renderedSource !== source) rmSync(renderedSource, {force: true});
};

const normalizeSvg = (source, output) => {
  const normalized = `${output}.normalized.svg`;
  const content = readFileSync(source, "utf8")
    .replaceAll(/param\([^)]+\)\s+([^"'\s;]+)/g, "$1");
  writeFileSync(normalized, content);
  return normalized;
};

const generateSprite = (images, ratio, output) => {
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
    if (ratio === 2) renderIcon(image.source, rendered, imageWidth, imageHeight);
    const centeredY = y + Math.floor((cell - imageHeight) / 2);
    execFileSync("convert", [canvas, rendered, "-geometry", `+${x}+${centeredY}`, "-composite", canvas]);
    atlasIndex[image.id] = {width: imageWidth, height: imageHeight, x, y: centeredY, pixelRatio: ratio};
    x += imageWidth;
    const next = images[position + 1];
    if (imageWidth !== cell && next && !CUSTOM_SIZES.has(next.id)) {
      x = Math.ceil(x / cell) * cell;
    }
  }
  writeFileSync(`${output}.json`, `${JSON.stringify(atlasIndex, undefined, 2)}\n`);
};

const updateSprite = (images, ratio, output) => {
  const canvas = `${output}.png`;
  const atlasIndex = JSON.parse(readFileSync(`${output}.json`, "utf8"));
  for (const image of images) {
    const frame = atlasIndex[image.id];
    if (!frame) throw new Error(`missing sprite frame for ${image.id}`);
    const rendered = ratio === 1 ? image.path : `${image.path}.2x.png`;
    renderIcon(image.source, rendered, frame.width, frame.height);
    clearSpriteFrame(canvas, frame);
    execFileSync("convert", [canvas, rendered, "-geometry", `+${frame.x}+${frame.y}`, "-composite", canvas]);
  }
};

const clearSpriteFrame = (canvas, frame) => {
  const transparentFrame = `${canvas}.${frame.x}-${frame.y}-${frame.width}x${frame.height}.clear.png`;
  execFileSync("convert", ["-size", `${frame.width}x${frame.height}`, "xc:none", transparentFrame]);
  execFileSync("convert", [
    canvas, transparentFrame, "-geometry", `+${frame.x}+${frame.y}`,
    "-compose", "Copy", "-composite", canvas,
  ]);
  rmSync(transparentFrame, {force: true});
};

const writeCsv = (file, rows) => {
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(file, `${rows.map((row) => row.map(csv).join(",")).join("\n")}\n`);
};

const csv = (value) => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
};
