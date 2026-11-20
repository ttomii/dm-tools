import {featureCenter} from "./geometry.js";
import {createStyleInventory} from "./style-inventory.js";

export const inspectNavigationTarget = (inventory, code, levels) => (inventory?.entries ?? [])
  .filter((entry) => (!code || entry.dmCode === Number(code)) && levels.includes(entry.level) && entry.count > 0
    && !entry.sourceLayer.includes("_deco_"))
  .sort((a, b) => Number(a.level === 250) - Number(b.level === 250) || a.level - b.level
    || a.sourceLayer.localeCompare(b.sourceLayer))[0];

export const inspectStyleNotice = (inventory, style, manifest, code, level) => {
  const entries = (inventory?.entries ?? []).filter((entry) => entry.dmCode === Number(code) && entry.level === level);
  const rows = createStyleInventory({entries, complete: true}, style, manifest);
  const parts = rows.flatMap((row) => row.entries);
  if (!parts.some((entry) => entry.hasIndividual)) return "個別の正式図式は未対応です。確認用データは変換済みです。";
  if (parts.some((entry) => entry.status === "missing" || entry.status === "default")) return "一部の図式は未対応です。";
  return "";
};

export const inspectCatalogCenter = (data, code, level) => featureCenter({
  type: "MultiPoint",
  coordinates: (data.features ?? [])
    .filter(feature => feature.properties.DMCODE === Number(code) && feature.properties.LEVEL === level
      && feature.properties.DM_SOURCE_LAYER !== "inspect_labels")
    .flatMap(feature => {
      const center = featureCenter(feature.geometry);
      return center ? [center] : [];
    }),
});
