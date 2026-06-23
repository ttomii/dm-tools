import {spawn} from "node:child_process";

export const openBrowser = (url, options = {}) => {
  const platform = options.platform ?? process.platform;
  const start = options.spawn ?? spawn;
  const command = browserCommand(platform, url);
  return new Promise((resolve, reject) => {
    const child = start(command.file, command.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
};

const browserCommand = (platform, url) => {
  if (platform === "win32") {
    return {file: "cmd", args: ["/c", "start", "", url]};
  }
  if (platform === "darwin") {
    return {file: "open", args: [url]};
  }
  return {file: "xdg-open", args: [url]};
};
