import {dmLayerName} from "./dm-layer-names.js";

export const featureTitle = (feature) => {
  const text = feature.properties.TEXT ? ` ${feature.properties.TEXT}` : "";
  return `USER_ID ${feature.properties.USER_ID ?? feature.id ?? feature.fid}${text}`;
};

export const featureMeta = (feature) => {
  const featureId = feature.id ?? feature.fid;
  const dmcode = getDmCode(feature);
  const layerName = dmLayerName(dmcode, feature.sourceLayer);
  const dmcodeLabel = dmcode || dmcode === 0
    ? `${layerName ? `${layerName} (` : ""}DMCODE ${dmcode}${layerName ? ")" : ""}`
    : "";
  const dmfile = feature.properties.DMFILE ?? feature.properties.SRC_DMFILE ?? "";
  return [feature.sourceLayer, featureId !== undefined && `ID ${featureId}`, dmcodeLabel, dmfile]
    .filter(Boolean)
    .join(" / ");
};

export const featureDetails = (feature) => ({
  sourceLayer: feature.sourceLayer,
  id: feature.id,
  layerName: dmLayerName(getDmCode(feature), feature.sourceLayer),
  properties: feature.properties,
});

const getDmCode = (feature) => feature.properties.DMCODE ?? feature.properties.SRC_DMCODE ?? "";
