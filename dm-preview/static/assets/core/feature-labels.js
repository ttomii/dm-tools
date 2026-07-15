import {dmLayerName} from "./dm-layer-names.js";

export const featureTitle = (feature) => {
  const text = feature.properties.TEXT ? ` ${feature.properties.TEXT}` : "";
  return `USER_ID ${feature.properties.USER_ID ?? feature.id ?? feature.fid}${text}`;
};

export const featureMeta = (feature) => {
  const dmcode = getDmCode(feature);
  const layerName = dmLayerName(dmcode, feature.sourceLayer);
  const dmfile = feature.properties.DMFILE ?? feature.properties.SRC_DMFILE ?? "";
  return [feature.sourceLayer, layerName, dmfile]
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
