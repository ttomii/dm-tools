import {spawn} from "node:child_process";

export const runConverter = ({executable, args, onLog}) => {
  const child = spawn(executable, args, {stdio: ["ignore", "pipe", "pipe"], windowsHide: true});
  child.stdout.setEncoding("utf8").on("data", onLog);
  child.stderr.setEncoding("utf8").on("data", onLog);
  const completed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({code, signal}));
  });
  return {completed, cancel: () => child.kill("SIGTERM"), kill: () => child.kill("SIGKILL")};
};
