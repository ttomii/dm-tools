import {dmCodes, dmLayerName, dmAnnotationCodes} from "./dm-layer-names.js";

export const INSPECT_LEVELS = [250, 500, 1000, 2500, 5000];
export const inspectSourceKind = kind => kind === "direction" ? "point" : kind;
const ORDER = ["point", "direction", "line", "polygon", "text"];
// E6 entries in the specification tables, plus the implemented directional 2401 symbol.
const DIRECTION_CODES = new Set([2219,2241,2242,2243,2244,2246,2247,2401,2419,3401,4119,4132,4142,4206,4207,4219,5219,5221,5226,5227,5228,5241,7206]);
export const PAIRED_CODES = new Set([5211,5212,5226,5231,6101,6102,6110,6111,6112,6113]);
const POINT_CODES = new Set([1111,2221,2241,2242,2243,2244,2246,2247,2251,2252,2253,2255,2256,2261,2262,2263,2501,2503,2504,2511,5255,5256]);
const POLYGON_CODES = new Set([3000,3403,3404,6223,6224,6312,6316]);
const fallbackKinds = code => {
  if(code>=8000 || !dmLayerName(code))return ["text"];
  if(POLYGON_CODES.has(code))return ["point","polygon"];
  if(POINT_CODES.has(code)||(code>=3500&&code<4300)||(code>=6300&&code<6400)||(code>=7300&&code<7400))return ["point"];
  return ["line"];
};
const valuesFor = (value, property) => {
  if(!Array.isArray(value))return value&&typeof value==="object"?Object.values(value).flatMap(item=>valuesFor(item,property)):[];
  if(["==","!=","in","!in"].includes(value[0])&&value[1]?.[0]==="get"&&value[1][1]===property){
    return typeof value[2]==="number"?[value[2]]:value[2]?.[0]==="literal"?value[2][1]:[];
  }
  return value.flatMap(item=>valuesFor(item,property));
};
const styleFacts = styles => {
  const facts=new Map();
  for(const style of styles)for(const layer of style.layers??[]){
    const match=/^dm_(\d+)_(point|line|polygon|text)$/.exec(layer["source-layer"]??"");
    if(!match)continue;
    const code=Number(match[1]),kind=match[2];
    const levels=valuesFor(layer.filter,"LEVEL");
    for(const level of levels.length?levels:INSPECT_LEVELS){
      const key=`${code}/${level}/${kind}`,entry=facts.get(key)??[];entry.push(layer);facts.set(key,entry);
    }
  }
  return facts;
};
const rulesFor = (spec,code) => {
  const alias=spec.aliases?.find(a=>code>=a.from&&code<=a.to);
  return (spec.codes?.[code]??spec.codes?.[alias?.code])?.rules??[];
};
const figuresFor = (code,kind,rules,layers,level) => {
  const explicit=[...new Set([...rules.flatMap(r=>r.figtypes),...layers.flatMap(l=>[...valuesFor(l.filter,"DMFIGTYPE"),...valuesFor(l.paint,"DMFIGTYPE")])])].sort((a,b)=>a-b);
  if(kind==="line"&&code===6132&&level<=1000)return [26,27];
  if(kind==="line"&&code===4262)return [47];
  if(kind==="line"&&PAIRED_CODES.has(code)&&(level<=1000||code===5211))return [11,12];
  if(!explicit.length)return [0];
  const ordinary=rules.some(r=>!r.figtypes.length)&&!explicit.some(v=>v===11||v===12);
  return ordinary?[0,...explicit]:explicit;
};
export const planInspectCases = (styles,spec={}) => {
  const facts=styleFacts(styles);
  const codes=[...new Set([...dmCodes(),...[...facts.keys()].map(k=>Number(k.split('/')[0]))])].sort((a,b)=>a-b);
  return codes.map(code=>{
    const allRules=rulesFor(spec,code),known=new Set(allRules.map(r=>r.kind)),variants=new Map();
    for(const level of INSPECT_LEVELS){
      if(code===2204&&level>1000)continue;
      const basis=level===250?500:level;
      const exact=allRules.filter(r=>r.levels.includes(basis));
      const kinds=new Set(exact.map(r=>r.kind));
      for(const kind of ["point","line","polygon","text"]){
        if(facts.has(`${code}/${level}/${kind}`)&&(!known.size||known.has(kind)))kinds.add(kind);
      }
      if(!known.size&&!kinds.size)for(const kind of fallbackKinds(code))kinds.add(kind);
      if(dmAnnotationCodes().includes(code))kinds.add("text");
      for(const sourceKind of kinds){
        if(code===4262&&sourceKind==="line"&&level>=2500)continue;
        const kind=sourceKind==="point"&&(DIRECTION_CODES.has(code)||code===7213&&level>=2500)?"direction":sourceKind;
        const rules=exact.filter(r=>r.kind===sourceKind),layers=facts.get(`${code}/${level}/${sourceKind}`)??[];
        for(const figtype of figuresFor(code,sourceKind,rules,layers,level))for(const rotation of kind==="direction"?[0,90]:kind==="text"?[0,1]:[0]){
          const key=`${kind}/${figtype}/${rotation}`,v=variants.get(key)??{kind,figtype,rotation,levels:[]};v.levels.push(level);variants.set(key,v);
        }
      }
    }
    return {code,variants:[...variants.values()].sort((a,b)=>ORDER.indexOf(a.kind)-ORDER.indexOf(b.kind)||a.figtype-b.figtype||a.rotation-b.rotation)};
  });
};
