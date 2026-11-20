import {planInspectCases, PAIRED_CODES, INSPECT_LEVELS} from "./inspect-catalog-plan.js";
export {INSPECT_LEVELS, inspectSourceKind} from "./inspect-catalog-plan.js";

export const inspectCatalogCases = (styles, spec = {}) => {
  const plan=planInspectCases(styles,spec);
  let id=1;
  const cases=plan.flatMap(({code,variants},row)=>variants.map(variant=>({
    ...variant,code,elementId:(id++*2)-1,column:0,row,rows:plan.length,
  })));
  const widths=INSPECT_LEVELS.map(level=>Math.max(1,...plan.map(({code})=>cases.filter(s=>s.code===code&&s.levels.includes(level)).length))*50+80);
  for(const sample of cases){
    sample.slots=Object.fromEntries(sample.levels.map(level=>[level,cases.filter(s=>s.code===sample.code&&s.levels.includes(level)).indexOf(sample)]));
    sample.slot=Math.min(...Object.values(sample.slots));sample.columnWidths=widths;
  }
  return cases;
};
export const inspectCasesForLevel=(cases,level)=>cases.filter(s=>(s.levels?s.levels.includes(level):isInspectCodeLevel(s.code,level)) && !(s.code===4262&&s.kind==="line"&&level>=2500))
  .map(s=>({...s,slot:s.slots?.[level]??s.slot}));
export const isInspectCodeLevel = (code, level) => code !== 2204 || [250, 500, 1000].includes(level);

// Coordinates are hundredths of a metre; fixed rows keep codes aligned across levels.
export const inspectCatalogOrigin = (sample, level) => {
  const column = INSPECT_LEVELS.slice(0, INSPECT_LEVELS.indexOf(level))
    .reduce((sum, value) => sum + (sample.columnWidths?.[INSPECT_LEVELS.indexOf(value)] ?? 450) * value / 10, 0);
  return [column, ((sample.rows ?? 1) - 1 - sample.row) * 16000];
};

const field = (value, width) => {
  const text = String(value);
  if (text.length > width) throw new Error(`DM field overflow: ${text}`);
  return text.padStart(width, " ");
};
const record = (fields) => {
  const chars = Array(84).fill(" ");
  for (const [offset, value] of fields) chars.splice(offset, String(value).length, ...String(value));
  return chars.join("");
};
const coordinateRows = (points) => {
  const rows = [];
  for (let index = 0; index < points.length; index += 6) rows.push(record([[0,
    points.slice(index, index + 6).map(([x, y]) => field(y, 7) + field(x, 7)).join("")]]));
  return rows;
};

const featureRecords = (sample, level) => {
  const scale = level / 10; // Paper mm to hundredths of a metre.
  const origin = inspectCatalogOrigin(sample, level);
  const bridge = sample.kind === "line" && (sample.code === 2203 && level >= 2500 || sample.code === 2204 && [250, 500, 1000].includes(level));
  const paired = sample.kind === "line" && (sample.code === 5211 || [5212, 5226, 5231, 6101, 6102, 6110, 6111, 6112, 6113].includes(sample.code) && level <= 1000);
  const slot = sample.slot;
  const x = origin[0] + (30 + slot * 50) * scale;
  const y = origin[1] + (sample.figtype === 12 ? bridge ? 6 * scale : paired ? -6 * scale : 0 : 0);
  const point = (dx, dy) => [Math.round(x + dx * scale), Math.round(y + dy * scale)];
  const polygon = [point(0, 0), point(40, 0), point(40, 12), point(0, 12), point(0, 0)];
  const straight = bridge || paired || sample.kind === "line" && (sample.code === 2205 || sample.code === 2213 && level <= 1000);
  let line = sample.code === 7199 && sample.kind === "line" ? [point(18, 0), point(21, 0)] : straight ? [point(0, 0), point(40, 0)] : [point(0, 0), point(20, 0), point(40, 8)];
  if (sample.context && paired && sample.figtype === 12) {
    line = [point(0, 6), point(0, 0), point(40, 0), point(40, 6)];
  }
  if (sample.figtype === 12) line.reverse();
  const points = sample.kind === "polygon" ? polygon : sample.kind === "point" ? [point(20, 4)] : sample.kind === "direction" ? [point(20, 4), sample.rotation === 90 ? point(24, 4) : point(20, 8)] : line;
  const text = `DM ${String(sample.code).padStart(4, "0")}`;
  const rows = sample.kind === "point" ? [] : sample.kind === "text" ? [record([[0, sample.rotation === 1 ? "1" : "0"], [1, field(0, 7)],
    [8, field(30, 5)], [13, field(0, 5)], [18, "03"], [20, text]])] : coordinateRows(points);
  const type = {polygon: "1", line: "2", point: "5", direction: "6", text: "7"}[sample.kind];
  return [record([[0, `E${type}`], [2, field(sample.code, 4)], [12, field(sample.elementId, 4)],
    [18, field(sample.figtype, 2)], [20, "2"], [23, "2"],
    [27, field(sample.kind === "point" ? 0 : sample.kind === "text" ? text.length : points.length, 4)], [31, field(rows.length, 4)],
    [35, field(sample.kind === "point" ? points[0][1] : Math.round(y), 7)], [42, field(sample.kind === "point" ? points[0][0] : Math.round(x), 7)]]), ...rows];
};

export const createInspectCatalogDm = (cases, level) => [
  record([[0, "M 09DF244"], [30, field(level, 4)], [64, " 0"]]),
  record([[0, field(0, 7)], [7, field(0, 7)], [44, field(10, 3)]]), record([]),
  record([[9, "0"]]), record([[40, "00000000"]]),
  ...inspectCasesForLevel(cases,level).flatMap(sample=>{
    const rows=featureRecords(sample,level);
    const paired=sample.kind==="line"&&((PAIRED_CODES.has(sample.code)&&(level<=1000||sample.code===5211)&&sample.figtype===11)
      ||(sample.code===2203&&level>=2500||sample.code===2204)&&sample.figtype===0);
    if(paired){
      const upper={...sample,figtype:11};
      return [...featureRecords(upper,level),...featureRecords({...sample,figtype:12,context:true,elementId:sample.elementId+1},level)];
    }
    return rows;
  }), "",
].join("\r\n");

export const inspectSampleLabel = sample => {
  const name={point:"点",direction:"方向点",line:"線",polygon:"ポリゴン",text:"注記"}[sample.kind];
  if(!name)return "";
  const figure=sample.figtype?` 区分${sample.figtype}`:"";
  return `${name}${figure}${sample.kind==="direction"?` ${sample.rotation}°`:sample.kind==="text"?sample.rotation?" 縦書き":" 横書き":""}`;
};
