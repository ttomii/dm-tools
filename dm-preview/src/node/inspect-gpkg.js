import path from "node:path";
import {readFile, writeFile} from "node:fs/promises";
import {GpkgFeatureStore} from "./gpkg-features.js";
import {inspectCatalogOrigin, INSPECT_LEVELS, inspectCasesForLevel, inspectSampleLabel} from "../core/inspect-catalog.js";
import {getZoomByScale} from "../core/map-scale.js";

export const writeInspectGpkgMetadata = async (output, cases, dependencies) => {
  const {databaseAdapter: adapter, projectGeometry} = dependencies;
  const database = await adapter.openDatabase(path.join(output, "inspect.gpkg"), {readOnly: false});
  try {
    writeLabels(database, adapter, cases);
  } finally { adapter.closeDatabase(database); }
  const store = await GpkgFeatureStore.create(output, {layerName: "inspect"}, dependencies);
  try {
    const sourceLayers = [...store.layers.keys()];
    const inventory = store.inventory();
    const first = cases.find(sample => sample.code === 1101) ?? cases[0];
    const [x, y] = inspectCatalogOrigin(first, 500);
    const center = projectGeometry({type: "Point", coordinates: [x / 100 + 25, y / 100]}, 9).coordinates;
    const extents = adapter.queryRows(store.database, "SELECT c.min_x, c.min_y, c.max_x, c.max_y, g.srs_id FROM gpkg_contents c JOIN gpkg_geometry_columns g ON g.table_name=c.table_name WHERE c.data_type='features'");
    const bounds = extents.reduce((box, row) => {
      if (row.min_x === null) return box;
      for (const x of [row.min_x, row.max_x]) for (const y of [row.min_y, row.max_y]) {
        const [longitude, latitude] = projectGeometry({type: "Point", coordinates: [x, y]}, row.srs_id - 6668).coordinates;
        box[0] = Math.min(box[0], longitude); box[1] = Math.min(box[1], latitude);
        box[2] = Math.max(box[2], longitude); box[3] = Math.max(box[3], latitude);
      }
      return box;
    }, [Infinity, Infinity, -Infinity, -Infinity]);
    const manifest = {version: 1, layerName: "inspect", geojson: "api/inspect/geojson", catalogLayout: 3, featureInventory: "feature-inventory.json",
      levels: INSPECT_LEVELS, sourceLayers, bounds, center: [...center, getZoomByScale(500, center[1])]};
    await writeFile(path.join(output, "inspect-manifest.json"), JSON.stringify(manifest));
    await writeFile(path.join(output, "feature-inventory.json"), JSON.stringify(inventory));
    return manifest;
  } finally { store.close(); }
};

export const readInspectGpkgManifest = async (output) => JSON.parse(await readFile(path.join(output, "inspect-manifest.json"), "utf8"));

const writeLabels = (database, adapter, cases) => {
  const run = (sql, params) => adapter.queryRows(database, sql, params);
  run("BEGIN IMMEDIATE");
  try {
    run("CREATE TABLE inspect_labels (fid INTEGER PRIMARY KEY, geom BLOB NOT NULL, DMCODE INTEGER NOT NULL, LEVEL INTEGER NOT NULL, TEXT TEXT NOT NULL)");
    run("INSERT INTO gpkg_contents (table_name, data_type, identifier, srs_id) VALUES ('inspect_labels', 'features', 'DM code labels', 6677)");
    run("INSERT INTO gpkg_geometry_columns VALUES ('inspect_labels', 'geom', 'POINT', 6677, 0, 0)");
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    const insert=(sample,level,x,y,text)=>{
      bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);
      bounds[2]=Math.max(bounds[2],x);bounds[3]=Math.max(bounds[3],y);
      run("INSERT INTO inspect_labels (geom, DMCODE, LEVEL, TEXT) VALUES (?, ?, ?, ?)",
        [pointBlob(x,y),sample.code,level,text]);
    };
    for(const level of INSPECT_LEVELS){
      const seen=new Set();
      for(const sample of inspectCasesForLevel(cases,level)){
        const [x,y]=inspectCatalogOrigin(sample,level);
        if(!seen.has(sample.code)){
          insert(sample,level,x/100,y/100+level*.004,`${String(sample.code).padStart(4,"0")}  1:${level}`);
          seen.add(sample.code);
        }
        const label=inspectSampleLabel(sample);
        if(label)insert(sample,level,x/100+(50+sample.slot*50)*level/1000,y/100-level*.01,label);
      }
    }
    run("UPDATE gpkg_contents SET min_x=?, min_y=?, max_x=?, max_y=? WHERE table_name='inspect_labels'", bounds);
    run("COMMIT");
  } catch (error) { run("ROLLBACK"); throw error; }
};

const pointBlob = (x, y) => {
  const bytes = Buffer.alloc(61);
  bytes.write("GP"); bytes[3] = 3; bytes.writeInt32LE(6677, 4);
  for (const [offset, value] of [[8, x], [16, x], [24, y], [32, y]]) bytes.writeDoubleLE(value, offset);
  bytes[40] = 1; bytes.writeUInt32LE(1, 41); bytes.writeDoubleLE(x, 45); bytes.writeDoubleLE(y, 53);
  return bytes;
};
