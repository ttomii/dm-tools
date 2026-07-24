import {cpSync, mkdirSync, rmSync} from "node:fs";
import path from "node:path";

const STYLE_FILES = [
  "style-500.json",
  "style-1000.json",
  "style-2500.json",
  "style-5000.json",
];

const SPRITE_FILES = [
  "sprite.json",
  "sprite.png",
  "sprite@2x.json",
  "sprite@2x.png",
];

const NOTICE_FILES = [
  ["icons/LICENSE.txt", "ICONS.txt"],
  ["glyphs/OFL.txt", "BIZ_UDPGOTHIC_OFL.txt"],
  ["glyphs/FONTNIK_LICENSE.txt", "FONTNIK.txt"],
  ["glyphs/README.md", "BIZ_UDPGOTHIC_PROVENANCE.md"],
];

const copyFiles = (source, destination, files) => {
  for (const [sourceName, destinationName = sourceName] of files) {
    cpSync(path.join(source, sourceName), path.join(destination, destinationName));
  }
};

export const copyMaplibreRuntimeAssets = (source, destination) => {
  rmSync(destination, {recursive: true, force: true});
  mkdirSync(path.join(destination, "sprite"), {recursive: true});
  mkdirSync(path.join(destination, "licenses"), {recursive: true});
  copyFiles(source, destination, STYLE_FILES.map((file) => [file]));
  copyFiles(
    path.join(source, "sprite"),
    path.join(destination, "sprite"),
    SPRITE_FILES.map((file) => [file]),
  );
  cpSync(
    path.join(source, "glyphs", "BIZ UDPGothic Regular"),
    path.join(destination, "glyphs", "BIZ UDPGothic Regular"),
    {recursive: true},
  );
  copyFiles(source, path.join(destination, "licenses"), NOTICE_FILES);
};
