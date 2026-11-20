import assert from "node:assert/strict";
import {test} from "node:test";
import {inspectCodeOptions} from "../src/core/inspect-code-options.js";
import {inspectCodeOptions as browserOptions} from "../static/assets/core/inspect-code-options.js";

for (const [name, options] of [["source", inspectCodeOptions], ["browser", browserOptions]]) {
  test(`${name}: all registered codes remain available without input features`, () => {
    const choices = options({complete: true, entries: [{level: 500, dmCode: 9999}]}, []);
    assert.ok(choices.length > 200);
    assert.deepEqual(choices.find(item => item.value === "1101"), {value: "1101", label: "1101 都府県界"});
    assert.deepEqual(choices.at(-1), {value: "9999", label: "9999"});
    assert.equal(new Set(choices.map(item => item.value)).size, choices.length);
    assert.deepEqual(choices.map(item => Number(item.value)), choices.map(item => Number(item.value)).sort((a,b) => a-b));
    assert.ok(options(undefined, []).some(item => item.value === "2204"));
    assert.ok(options({complete: false, entries: []}, ["dm_9998_line"]).some(item => item.value === "9998"));
  });
}
