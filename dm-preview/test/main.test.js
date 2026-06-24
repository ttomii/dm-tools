import assert from "node:assert/strict";
import {test} from "node:test";
import {parseArguments} from "../src/main.js";

test("parseArguments accepts preview command", () => {
  assert.deepEqual(parseArguments(["preview", "output", "--no-open"]), {
    command: "preview",
    help: false,
    noOpen: true,
    output: "output",
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
  assert.throws(() => parseArguments(["bundle", "input.pmtiles"]), /bundle requires PMTILES and OUTPUT/);
  assert.throws(() => parseArguments([]), /preview requires exactly one OUTPUT/);
});
