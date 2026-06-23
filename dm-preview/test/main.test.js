import assert from "node:assert/strict";
import {test} from "node:test";
import {parseArguments} from "../src/main.js";

test("parseArguments accepts output and no-open", () => {
  assert.deepEqual(parseArguments(["output", "--no-open"]), {
    help: false,
    noOpen: true,
    output: "output",
  });
});

test("parseArguments rejects unknown and missing arguments", () => {
  assert.throws(() => parseArguments(["--unknown", "output"]), /unknown option/);
  assert.throws(() => parseArguments([]), /exactly one OUTPUT/);
});
