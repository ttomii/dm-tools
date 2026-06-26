import {createBundle} from "./node/bundle.js";
import {openBrowser} from "./node/open-browser.js";
import {readManifest} from "./node/manifest.js";
import {projectGeometry} from "./proj4/gpkg-projection.js";
import {startServer} from "./server.js";

export const main = async (args) => {
  const options = parseArguments(args);
  if (options.help) {
    console.log([
      "Usage:",
      "  dm-preview preview OUTPUT [--no-open]",
      "  dm-preview bundle PMTILES OUTPUT",
    ].join("\n"));
    return;
  }
  if (options.command === "bundle") {
    const output = await createBundle(options.pmtiles, options.output);
    console.log(output);
    return;
  }
  const {manifest, root} = await readManifest(options.output);
  const {server, url} = await startServer(root, {manifest, projectGeometry});
  console.log(url);
  if (!options.noOpen) {
    await openBrowser(url).catch((error) => {
      console.error(`warning: browser launch failed: ${error.message}`);
    });
  }
  await waitForShutdown(server);
};

export const parseArguments = (args) => {
  if (args.includes("--help") || args.includes("-h")) return {help: true};
  if (args[0] === "preview") return parsePreviewArguments(args.slice(1));
  if (args[0] === "bundle") return parseBundleArguments(args.slice(1));
  return parsePreviewArguments(args);
};

const parsePreviewArguments = (args) => {
  const noOpen = args.includes("--no-open");
  const unknown = args.filter((value) => value.startsWith("-") && value !== "--no-open");
  const positional = args.filter((value) => !value.startsWith("-"));
  if (unknown.length) throw inputError(`unknown option: ${unknown[0]}`);
  if (positional.length !== 1) throw inputError("preview requires exactly one OUTPUT directory");
  return {command: "preview", help: false, noOpen, output: positional[0]};
};

const parseBundleArguments = (args) => {
  const unknown = args.filter((value) => value.startsWith("-"));
  if (unknown.length) throw inputError(`unknown option: ${unknown[0]}`);
  if (args.length !== 2) throw inputError("bundle requires PMTILES and OUTPUT");
  return {command: "bundle", help: false, pmtiles: args[0], output: args[1]};
};

const waitForShutdown = (server) => new Promise((resolve) => {
  const close = () => server.close(resolve);
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
});

const inputError = (message) => Object.assign(new Error(message), {name: "InputError"});
