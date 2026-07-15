import assert from "node:assert/strict";
import {test} from "node:test";
import {createHelpText, parseArguments} from "../src/main.js";

test("parseArguments accepts preview command", () => {
  assert.deepEqual(parseArguments(["preview", "output", "--no-open"]), {
    command: "preview",
    help: false,
    noOpen: true,
    output: "output",
  });
});

test("parseArguments accepts preview port option", () => {
  assert.deepEqual(parseArguments(["preview", "output", "--port", "3000"]), {
    command: "preview",
    help: false,
    noOpen: false,
    output: "output",
    port: 3000,
  });
  assert.deepEqual(parseArguments(["preview", "output", "--port=3001"]), {
    command: "preview",
    help: false,
    noOpen: false,
    output: "output",
    port: 3001,
  });
});

test("parseArguments accepts verbose preview diagnostics", () => {
  assert.deepEqual(parseArguments(["preview", "output", "--verbose"]), {
    command: "preview",
    help: false,
    noOpen: false,
    output: "output",
    verbose: true,
  });
});

test("parseArguments keeps legacy preview form", () => {
  assert.deepEqual(parseArguments(["output", "--no-open"]), {
    command: "preview",
    help: false,
    noOpen: true,
    output: "output",
  });
});

test("parseArguments accepts bundle command", () => {
  assert.deepEqual(parseArguments(["bundle", "input.pmtiles", "public"]), {
    command: "bundle",
    help: false,
    pmtiles: "input.pmtiles",
    output: "public",
  });
});

test("parseArguments rejects unknown and missing arguments", () => {
  assert.throws(() => parseArguments(["--unknown", "output"]), /unknown option/);
  assert.throws(() => parseArguments(["preview"]), /preview requires exactly one OUTPUT/);
  assert.throws(() => parseArguments(["preview", "output", "--port", "0"]), /port must be an integer/);
  assert.throws(() => parseArguments(["preview", "output", "--port", "65536"]), /port must be an integer/);
  assert.throws(() => parseArguments(["preview", "output", "--port", "abc"]), /port must be an integer/);
  assert.throws(() => parseArguments(["bundle", "input.pmtiles"]), /bundle requires PMTILES and OUTPUT/);
  assert.throws(() => parseArguments([]), /preview requires exactly one OUTPUT/);
});

test("createHelpText explains commands, options, URL parameters, and exit codes", () => {
  const help = createHelpText();

  assert.match(help, /dm-preview preview OUTPUT \[--no-open\] \[--port PORT\]/);
  assert.match(help, /dm-preview bundle PMTILES OUTPUT/);
  assert.match(help, /--no-open\s+Print the preview URL/);
  assert.match(help, /--port PORT\s+Listen on PORT/);
  assert.match(help, /--verbose\s+Print asset roots/);
  assert.match(help, /layers=NAME\s+Selected feature-list layer/);
  assert.match(help, /Exit codes:/);
});
