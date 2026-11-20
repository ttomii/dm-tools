import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";
import {hashFile, snapshotInputs} from "./inspect-files.js";
import {runConverter} from "./inspect-process.js";

export const convertInspectInput = async ({root, descriptor, id}, {isCancelled, onProcess, onLog, getLog, execute = runConverter}) => {
  const prepared = await prepareConversion(root, descriptor, id);
  if (isCancelled()) return false;
  if (descriptor.catalog) await mkdir(prepared.output, {recursive: true});
  const job = execute({executable: descriptor.converter, args: prepared.record.args, onLog});
  onProcess(job);
  const result = await job.completed;
  await recordExecution(prepared, result, getLog());
  if (isCancelled()) return false;
  if (result.code !== 0) throw new Error(`converter exited with ${result.code ?? result.signal}`);
  const after = await snapshotInputs(descriptor.input);
  if (JSON.stringify(prepared.record.inputs) !== JSON.stringify(after)) throw new Error("input changed during conversion; retry with stable input");
  return true;
};

const prepareConversion = async (root, descriptor, id) => ({
  output: path.join(root, "runs", id),
  record: {id, startedAt: new Date().toISOString(), converter: descriptor.converter,
    args: ["convert", descriptor.input, ...(descriptor.catalog ? [path.join(root, "runs", id, "inspect.gpkg"), "--format", "gpkg"]
        : [path.join(root, "runs", id), "--format", "pmtiles", "--layer-name", "inspect"]),
      "--input-datum", descriptor.inputDatum, "--decorations", "true",
      "--include-levels", descriptor.levels.join(",")],
    converterHash: await hashFile(descriptor.converter), inputs: await snapshotInputs(descriptor.input)},
});

const recordExecution = async ({output, record}, result, log) => {
  await mkdir(output, {recursive: true});
  await writeFile(path.join(output, "execution.json"), JSON.stringify({...record, finishedAt: new Date().toISOString(), result}, undefined, 2));
  await writeFile(path.join(output, "conversion.log"), log);
};
