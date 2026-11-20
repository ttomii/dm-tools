import {Resvg} from "@resvg/resvg-js";
import {readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {MM_TO_PX, penForCode} from "../src/core/pen-width.js";
import {getZoomByScale} from "../src/core/map-scale.js";
import {spriteSize} from "../src/core/sprite-policy.js";
import {calibratedNativeSvg} from "./maplibre-assets/native-size.mjs";
import {hasSvgStrokes} from "../src/core/svg-pen.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../static/maplibre");
const spec = JSON.parse(await readFile(path.join(root, "pen-spec.json"), "utf8"));
const nativeSizes=JSON.parse(await readFile(path.join(root,"native-icon-sizes.json"),"utf8"));
const variants = new Map(); const audit = new Map();
for (const level of [250, 500, 1000, 2500, 5000]) {
  const style = JSON.parse(await readFile(path.join(root, `style-${level}.json`), "utf8"));
  for (const layer of style.layers) {
    const base = layer.metadata?.["dm:icon-base"] ?? layer.layout?.["icon-image"];
    if (typeof base !== "string" || !/^dm-\d+(?:-level-\d+)?$/.test(base)) continue;
    const code=Number(/^dm_(\d+)_/.exec(layer["source-layer"]??"")?.[1]);
    const match = /^dm_(\d+)_(point|line|polygon)/.exec(layer["source-layer"] ?? "");
    const pen = penForCode(spec, Number(match?.[1] ?? base.slice(3)), level, match?.[2] ?? "point").pen;
    if (typeof pen !== "number") throw new Error(`icon needs separate subtype sprites: ${layer.id}`);
    const basis=level===250?500:level;
    const source=level<=1000?(nativeSizes.codes[code]?.[basis]?.source??nativeSizes.codes[code]?.source):undefined;
    const svg = await readFile(path.join(root, "icons/source", source??`${base.slice(3)}.svg`), "utf8");
    const dimensions=level<=1000?nativeSizes.codes[code]?.[level===250?500:level]:undefined;
    const native=dimensions?calibratedNativeSvg(svg,dimensions,pen):undefined;
    if(!native && layer.metadata?.["dm:icon-legacy-layout"]){
      const legacy=layer.metadata["dm:icon-legacy-layout"];
      layer.layout["icon-size"]=legacy.size;
      if(legacy.offset)layer.layout["icon-offset"]=legacy.offset;else delete layer.layout["icon-offset"];
      delete layer.metadata["dm:icon-native-size"];delete layer.metadata["dm:icon-canvas-mm"];delete layer.metadata["dm:icon-legacy-layout"];
    }
    if(native){
      // Calibrated variants use a square logical frame, including legacy rectangular bases.
      layer.metadata={...layer.metadata,"dm:icon-legacy-layout":layer.metadata?.["dm:icon-legacy-layout"]??{size:layer.layout["icon-size"],offset:layer.layout["icon-offset"]??null}};
      const baseline=getZoomByScale(level,36),nominal=native.canvas*MM_TO_PX/32;
      layer.layout["icon-size"]=["interpolate",["exponential",2],["zoom"],14,nominal*2**(14-baseline),24,nominal*2**(24-baseline)];
      layer.layout["icon-offset"]=native.anchor.map(v=>-v*32/native.canvas);
      layer.metadata={...layer.metadata,"dm:icon-native-size":{width:native.width,height:native.height,page:nativeSizes.codes[code].page},"dm:icon-canvas-mm":native.canvas};
    }
    const canonical = new Resvg(svg.replaceAll(/param\([^)]+\)\s+([^"'\s;]+)/g, "$1")).toString();
    if (!hasSvgStrokes(canonical) && !native) {
      layer.layout["icon-image"] = base;
      if (layer.metadata) { delete layer.metadata["dm:icon-base"]; delete layer.metadata["dm:icon-pen"]; }
      audit.set(base, {id: base, representation: "filled-shape"}); continue;
    }
    const size = layer.layout["icon-size"];
    if (!Array.isArray(size) || size[0] !== "interpolate" || typeof size[4] !== "number") throw new Error(`unsupported icon size: ${layer.id}`);
    const nominalScale = size[4] * 2 ** (getZoomByScale(level, 36) - size[3]);
    const pixelStroke = pen * 0.05 * MM_TO_PX / nominalScale;
    const id = `${base}-pen-${level}-${Math.round(pixelStroke * 1e6)}`;
    const variant = {id, baseId: base, level, pen, pixelStroke, ...spriteSize(base), ...(native?{width:32,height:32,nativeSize:dimensions,...(source?{nativeSource:source}:{})}: {})};
    const existing = variants.get(id);
    if (existing && Math.abs(existing.pixelStroke - pixelStroke) > 0.0001) throw new Error(`inconsistent icon stroke: ${id}`);
    variants.set(id, variant); audit.set(base, {id: base, representation: "stroke"});
    layer.layout["icon-image"] = id;
    layer.metadata = {...layer.metadata, "dm:icon-base": base, "dm:icon-pen": pen};
  }
  await writeFile(path.join(root, `style-${level}.json`), JSON.stringify(style, undefined, 2) + "\n");
}
await writeFile(path.join(root, "pen-icon-variants.json"), JSON.stringify({variants: [...variants.values()], audit: [...audit.values()]}, undefined, 2) + "\n");
console.log(`${variants.size} pen-normalized sprite variants; ${audit.size} source icons audited`);
