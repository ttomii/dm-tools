export const recoloredSpriteId = (iconId, color) => `${baseIconId(iconId)}__color_${color.replace("#", "").toLowerCase()}`;

export const baseIconId = (iconId) => iconId.replace(/__color_[0-9a-f]{6}$/i, "");

export const recolorSpritePixels = (imageData, color) => {
  const [red, green, blue] = hexToRgb(color);
  for (let offset = 0; offset < imageData.data.length; offset += 4) {
    const alpha = imageData.data[offset + 3];
    if (alpha === 0) continue;
    const brightness = (imageData.data[offset] + imageData.data[offset + 1] + imageData.data[offset + 2]) / 3;
    const coverage = Math.round(alpha * (255 - brightness) / 255);
    imageData.data[offset] = red;
    imageData.data[offset + 1] = green;
    imageData.data[offset + 2] = blue;
    imageData.data[offset + 3] = coverage;
  }
  return imageData;
};

const hexToRgb = (color) => {
  const match = /^#?([0-9a-f]{6})$/i.exec(color);
  if (!match) throw new Error(`invalid color ${color}`);
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};
