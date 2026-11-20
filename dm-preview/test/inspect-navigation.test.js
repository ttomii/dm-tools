import assert from "node:assert/strict";
import {test} from "node:test";
import {inspectNavigationTarget, inspectStyleNotice} from "../src/core/inspect-navigation.js";
import {inspectNavigationTarget as browserTarget, inspectStyleNotice as browserNotice} from "../static/assets/core/inspect-navigation.js";

for (const [name, target] of [["source", inspectNavigationTarget], ["browser", browserTarget]]) {
  test(`${name}: navigation prefers an available formal original feature and respects selected levels`, () => {
    const entries = [
      {dmCode: 1101, level: 250, count: 1, sourceLayer: "dm_1101_line"},
      {dmCode: 1101, level: 500, count: 2, sourceLayer: "dm_1101_line_deco_line"},
      {dmCode: 1101, level: 500, count: 1, sourceLayer: "dm_1101_line"},
      {dmCode: 2204, level: 2500, count: 0, sourceLayer: "dm_2204_line"},
    ];
    assert.equal(target({entries}, "1101", [250, 500]), entries[2]);
    assert.equal(target({entries}, "1101", [250]), entries[0]);
    assert.equal(target({entries}, "", [500]), entries[2]);
    assert.equal(target({entries}, "2204", [2500]), undefined);
    assert.equal(target({entries}, "3553", [500]), undefined);
    assert.equal(target(undefined, "1101", [500]), undefined);
    assert.equal(target({entries}, "1101", []), undefined);
  });
}

for (const [name, notice] of [["source", inspectStyleNotice], ["browser", browserNotice]]) {
  test(`${name}: missing formal styles are distinguished from missing sample data`, () => {
    const inventory = {entries: [{dmCode: 3553, level: 500, kind: "point", count: 2, sourceLayer: "dm_3553_point"}]};
    const layer = {id: "point", source: "dm", "source-layer": "dm_3553_point", metadata: {"dm:style-origin": "individual"}};
    assert.equal(notice(inventory, {layers: [layer]}, {}, "3553", 500), "");
    assert.match(notice(inventory, {layers: []}, {}, "3553", 500), /正式図式は未対応/);
    assert.match(notice(inventory, {layers: []}, {}, "3553", 250), /未対応/);
    const withLine = {entries: [...inventory.entries, {dmCode: 3553, level: 500, kind: "line", count: 1, sourceLayer: "dm_3553_line"}]};
    assert.match(notice(withLine, {layers: [layer]}, {}, "3553", 500), /一部/);
  });
}

for (const path of ["../src/core/inspect-navigation.js", "../static/assets/core/inspect-navigation.js"]) {
  test(`${path}: catalog navigation centers all geometries of the selected code and level`, async () => {
    const {inspectCatalogCenter} = await import(path);
    const feature = (code, level, layer, coordinates) => ({properties: {DMCODE: code, LEVEL: level, DM_SOURCE_LAYER: layer}, geometry: {type: "Point", coordinates}});
    const data = {features: [feature(2419, 500, "dm_2419_line", [0, 0]), feature(2419, 500, "dm_2419_point", [10, 2]),
      feature(2419, 1000, "dm_2419_point", [100, 100]), feature(1101, 500, "dm_1101_line", [200, 200]),
      feature(2419, 500, "inspect_labels", [-100, -100])]};
    assert.deepEqual(inspectCatalogCenter(data, "2419", 500), [5, 1]);
    assert.equal(inspectCatalogCenter(data, "2419", 2500), undefined);
  });
}
