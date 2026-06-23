#!/usr/bin/env node

import {main} from "../src/main.js";

main(process.argv.slice(2)).catch((error) => {
  console.error(`preview error: ${error.message}`);
  process.exitCode = error.name === "InputError" ? 2 : 1;
});
