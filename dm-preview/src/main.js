import {openBrowser} from "./open-browser.js";
import {readManifest} from "./manifest.js";
import {startServer} from "./server.js";

export const main = async (args) => {
  const options = parseArguments(args);
  if (options.help) {
    console.log("Usage: dm-preview OUTPUT [--no-open]");
    return;
  }
  const {manifest, root} = await readManifest(options.output);
  const {server, url} = await startServer(root, {manifest});
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
  const noOpen = args.includes("--no-open");
  const unknown = args.filter((value) => value.startsWith("-") && value !== "--no-open");
  const positional = args.filter((value) => !value.startsWith("-"));
  if (unknown.length) throw inputError(`unknown option: ${unknown[0]}`);
  if (positional.length !== 1) throw inputError("exactly one OUTPUT directory is required");
  return {help: false, noOpen, output: positional[0]};
};

const waitForShutdown = (server) => new Promise((resolve) => {
  const close = () => server.close(resolve);
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
});

const inputError = (message) => Object.assign(new Error(message), {name: "InputError"});
