import {getDmCode} from "./dm-source-layers.js";
import {dmLayerName, dmCodes} from "./dm-layer-names.js";

export const inspectCodeOptions = (inventory, sourceLayers, catalogCodes = []) => {
  const entries = inventory?.entries ?? [];
  const codes = [...dmCodes(), ...catalogCodes, ...entries.map((entry) => entry.dmCode)];
  if (inventory?.complete !== true) codes.push(...(sourceLayers ?? []).map(getDmCode));
  return [...new Set(codes.filter((code) => Number.isSafeInteger(code) && code >= 0 && code <= 9999))]
    .sort((a, b) => a - b)
    .map((code) => ({value: String(code), label: [String(code).padStart(4, "0"), (dmLayerName(code) || dmLayerName(code, "dm_annotation"))].filter(Boolean).join(" ")}));
};
