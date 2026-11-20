import assert from "node:assert/strict";
import {test} from "node:test";
import {blackComponents} from "../e2e/helpers/raster-components.js";

const whiteImage = (width, height) => new Uint8Array(width * height * 4).fill(255);
const setPixel = (pixels, width, x, y, color = [0, 0, 0, 255]) => pixels.set(color, (y * width + x) * 4);

test("ink components include diagonal strokes and ignore transparent or light pixels", () => {
  const pixels = whiteImage(6, 5);
  for (const [x, y] of [[0,0],[1,1],[4,1],[4,2]]) setPixel(pixels, 6, x, y);
  setPixel(pixels, 6, 5, 4, [0,0,0,0]);
  setPixel(pixels, 6, 0, 4, [200,200,200,255]);
  assert.deepEqual(blackComponents(pixels, 6, 5), [
    {width: 2, height: 2, centerX: .5, centerY: .5},
    {width: 1, height: 2, centerX: 4, centerY: 1.5},
  ]);
});

test("pixels on opposite row edges are not joined through a wrapped array index", () => {
  const pixels = whiteImage(4, 2);
  setPixel(pixels, 4, 3, 0); setPixel(pixels, 4, 0, 1);
  assert.deepEqual(blackComponents(pixels, 4, 2), [
    {width: 1, height: 1, centerX: 3, centerY: 0},
    {width: 1, height: 1, centerX: 0, centerY: 1},
  ]);
  assert.deepEqual(blackComponents(new Uint8Array(), 0, 0), []);
});
