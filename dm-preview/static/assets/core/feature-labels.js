export const featureTitle = (feature) => {
  const text = feature.properties.TEXT ? ` ${feature.properties.TEXT}` : "";
  return `USER_ID ${feature.properties.USER_ID ?? feature.id ?? feature.fid}${text}`;
};

export const featureMeta = (feature) => {
  const featureId = feature.id ?? feature.fid;
  const dmcode = feature.properties.DMCODE ?? feature.properties.SRC_DMCODE ?? "";
  const dmfile = feature.properties.DMFILE ?? feature.properties.SRC_DMFILE ?? "";
  return [feature.sourceLayer, featureId !== undefined && `ID ${featureId}`, dmcode && `DMCODE ${dmcode}`, dmfile]
    .filter(Boolean)
    .join(" / ");
};
