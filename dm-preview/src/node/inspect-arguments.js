import {InputError} from "../core/manifest-policy.js";

export const parseInspectArguments = (args) => {
  const options = {command: "inspect", inputDatum: "jgd2024", converter: "dm-converter", noOpen: false};
  const values = new Map([["--work-dir", "workDir"], ["--converter", "converter"], ["--input-datum", "inputDatum"], ["--port", "port"]]);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--no-open") options.noOpen = true;
    else if (values.has(arg)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new InputError(`missing value for ${arg}`);
      if (Object.hasOwn(options, values.get(arg)) && !["converter", "inputDatum"].includes(values.get(arg))) throw new InputError(`duplicate option: ${arg}`);
      options[values.get(arg)] = value;
    } else if (arg.startsWith("-") || options.input) throw new InputError(`unexpected argument: ${arg}`);
    else options.input = arg;
  }
  if (!options.workDir) throw new InputError("inspect requires --work-dir DIR");
  if (!["jgd2000", "jgd2011", "jgd2024"].includes(options.inputDatum)) throw new InputError("invalid input datum");
  if (options.port !== undefined) {
    if (!/^\d+$/.test(options.port) || Number(options.port) > 65535) throw new InputError("invalid port");
    options.port = Number(options.port);
  }
  return options;
};
