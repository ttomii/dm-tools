export const recolorSpriteIcon = async ({iconId, color, map, spriteState, resourceUrl}) => {
  const state = spriteState ?? await loadSpriteState(resourceUrl);
  const hex = color.replace("#", "").toLowerCase();
  const recoloredId = `${baseIconId(iconId)}__color_${hex}`;
  if (!state.sprite.json[recoloredId]) {
    addRecoloredSpriteFrame(state.sprite, iconId, recoloredId, color);
    addRecoloredSpriteFrame(state.sprite2x, iconId, recoloredId, color);
    state.dirty = true;
  }
  const runtimeFrame = state.sprite.json[recoloredId];
  const imageData = state.sprite.context.getImageData(runtimeFrame.x, runtimeFrame.y, runtimeFrame.width, runtimeFrame.height);
  if (!map.hasImage(recoloredId)) map.addImage(recoloredId, imageData);
  return {spriteState: state, iconId: recoloredId};
};

export const spritePayload = async (state) => ({
  "sprite.json": state.sprite.json,
  "sprite.png": state.sprite.canvas.toDataURL("image/png"),
  "sprite@2x.json": state.sprite2x.json,
  "sprite@2x.png": state.sprite2x.canvas.toDataURL("image/png"),
});

const loadSpriteState = async (resourceUrl) => ({
  dirty: false,
  sprite: await loadSpriteSheet(resourceUrl, "sprite"),
  sprite2x: await loadSpriteSheet(resourceUrl, "sprite@2x"),
});

const loadSpriteSheet = async (resourceUrl, name) => {
  const [json, image] = await Promise.all([
    fetch(resourceUrl(`${name}.json`)).then(checkResponse).then((response) => response.json()),
    loadImage(resourceUrl(`${name}.png`)),
  ]);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", {willReadFrequently: true});
  context.drawImage(image, 0, 0);
  return {json, canvas, context};
};

const addRecoloredSpriteFrame = (sheet, iconId, recoloredId, color) => {
  const frame = sheet.json[baseIconId(iconId)];
  if (!frame) throw new Error(`missing sprite frame ${iconId}`);
  const source = sheet.context.getImageData(frame.x, frame.y, frame.width, frame.height);
  const [red, green, blue] = hexToRgb(color);
  for (let offset = 0; offset < source.data.length; offset += 4) {
    const alpha = source.data[offset + 3];
    if (alpha === 0) continue;
    const brightness = (source.data[offset] + source.data[offset + 1] + source.data[offset + 2]) / 3;
    const coverage = Math.round(alpha * (255 - brightness) / 255);
    source.data[offset] = red;
    source.data[offset + 1] = green;
    source.data[offset + 2] = blue;
    source.data[offset + 3] = coverage;
  }
  const y = sheet.canvas.height;
  const nextCanvas = document.createElement("canvas");
  nextCanvas.width = sheet.canvas.width;
  nextCanvas.height = sheet.canvas.height + frame.height;
  const nextContext = nextCanvas.getContext("2d", {willReadFrequently: true});
  nextContext.drawImage(sheet.canvas, 0, 0);
  nextContext.putImageData(source, 0, y);
  sheet.canvas = nextCanvas;
  sheet.context = nextContext;
  sheet.json[recoloredId] = {
    width: frame.width,
    height: frame.height,
    x: 0,
    y,
    pixelRatio: frame.pixelRatio,
  };
};

const loadImage = (url) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = reject;
  image.src = url;
});

const baseIconId = (iconId) => iconId.replace(/__color_[0-9a-f]{6}$/i, "");

const hexToRgb = (color) => {
  const match = /^#?([0-9a-f]{6})$/i.exec(color);
  if (!match) throw new Error(`invalid color ${color}`);
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

const checkResponse = (response) => {
  if (!response.ok) throw new Error(`${response.status} ${response.url}`);
  return response;
};
