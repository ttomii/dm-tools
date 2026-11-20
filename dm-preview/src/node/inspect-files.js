import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {access, mkdir, readFile, readdir, realpath, rename, stat, writeFile} from "node:fs/promises";
import path from "node:path";
import {InputError} from "../core/manifest-policy.js";

export const hashFile = async (file) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
};

export const resolveConverter = async (value) => {
  const candidates = value.includes("/") || value.includes("\\") ? [path.resolve(value)]
    : (process.env.PATH ?? "").split(path.delimiter).flatMap((directory) =>
      process.platform === "win32" ? [path.join(directory, value), path.join(directory, `${value}.exe`)] : [path.join(directory, value)]);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      if ((await stat(candidate)).isFile()) return await realpath(candidate);
    } catch (error) {
      if (!["ENOENT", "ENOTDIR", "EACCES"].includes(error.code)) throw error;
    }
  }
  throw new InputError(`converter not found: ${value}`);
};

export const inputFiles = async (input) => {
  const metadata = await stat(input);
  if (metadata.isFile()) {
    if (!/\.dm$/i.test(input)) throw new InputError("inspect input must be a DM file or directory");
    const directory = path.dirname(input);
    const dmi = (await readdir(directory)).filter((name) => /\.dmi$/i.test(name)).map((name) => path.join(directory, name));
    return [input, ...dmi].sort();
  }
  if (!metadata.isDirectory()) throw new InputError("inspect input must be a DM file or directory");
  const files = await walkInput(input);
  if (!files.some((file) => /\.dm$/i.test(file))) throw new InputError("input contains no DM files");
  return files.sort();
};

const walkInput = async (directory) => {
  const entries = await readdir(directory, {withFileTypes: true});
  const nested = await Promise.all(entries.map(async (entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkInput(file);
    return entry.isFile() && /\.(dm|dmi)$/i.test(file) ? [file] : [];
  }));
  return nested.flat();
};

export const snapshotInputs = async (input) => Promise.all((await inputFiles(input)).map(async (file) => ({
  path: file, sha256: await hashFile(file),
})));

export const readSession = async (root) => {
  try {
    return JSON.parse(await readFile(path.join(root, "session.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
};

export const saveSession = async (root, session) => {
  const file = path.join(root, "session.json");
  await writeFile(`${file}.tmp`, `${JSON.stringify(session, undefined, 2)}\n`);
  await rename(`${file}.tmp`, file);
};

export const prepareInspectRoot = async (input, output) => {
  const source = await realpath(input);
  await inputFiles(source);
  const requested = path.resolve(output);
  await mkdir(requested, {recursive: true});
  const root = await realpath(requested);
  if (source === root || root.startsWith(`${source}${path.sep}`) || source.startsWith(`${root}${path.sep}`)) {
    throw new InputError("inspect work directory must be separate from input");
  }
  const session = await readSession(root);
  if (!session && (await readdir(root)).length) throw new InputError("inspect work directory must be empty or an inspect session");
  return {input: source, root, session};
};
