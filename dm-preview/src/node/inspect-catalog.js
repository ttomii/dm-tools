import {createHash} from "node:crypto";
import {mkdir, readFile, realpath, readdir, writeFile} from "node:fs/promises";
import path from "node:path";
import {InputError} from "../core/manifest-policy.js";
import {createInspectCatalogDm, inspectCatalogCases, inspectSourceKind, INSPECT_LEVELS} from "../core/inspect-catalog.js";
import {createDefaultAssetRoots} from "./asset-roots.js";
import {hashFile, readSession} from "./inspect-files.js";

export const prepareInspectCatalogRoot = async (output) => {
  await mkdir(path.resolve(output), {recursive: true});
  const root = await realpath(path.resolve(output));
  const session = await readSession(root);
  if ((!session && (await readdir(root)).length) || (session && session.catalog !== 1)) {
    throw new InputError("catalog work directory must be empty or an inspect catalog session");
  }
  return {root, input: path.join(root, "catalog-input"), session, catalog: 1};
};

export const readInspectCatalogCases = async () => {
  const {maplibreAssets} = createDefaultAssetRoots();
  const styles = await Promise.all(INSPECT_LEVELS.map(async (level) =>
    JSON.parse(await readFile(path.join(maplibreAssets, `style-${level}.json`), "utf8"))));
  const spec=JSON.parse(await readFile(path.join(maplibreAssets,"pen-spec.json"),"utf8"));
  return inspectCatalogCases(styles,spec);
};

export const writeInspectCatalog = async (input, levels) => {
  const cases = await readInspectCatalogCases();
  await mkdir(input, {recursive: true});
  for (const level of levels) await writeFile(path.join(input, `level-${level}.dm`), createInspectCatalogDm(cases, level));
  return {codes: [...new Set(cases.map((sample) => sample.code))], cases: cases.length};
};

export const canReuseInspectCatalog = async (context, converter) => {
  if (context?.manifest.catalogLayout !== 3) return false;
  try {
    const record = JSON.parse(await readFile(path.join(context.root, "execution.json"), "utf8"));
    if (record.converterHash !== await hashFile(converter)) return false;
    const sources = new Set(context.manifest.sourceLayers);
    const cases = await readInspectCatalogCases();
    if (!cases.every(sample => sources.has(`dm_${sample.code}_${inspectSourceKind(sample.kind)}`))) return false;
    return INSPECT_LEVELS.every(level => {
      const expected = createHash("sha256").update(createInspectCatalogDm(cases, level)).digest("hex");
      return record.inputs?.some(input => path.basename(input.path) === `level-${level}.dm` && input.sha256 === expected);
    });
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return false;
    throw error;
  }
};
