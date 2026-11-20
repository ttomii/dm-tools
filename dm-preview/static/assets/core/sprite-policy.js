export const SPRITE_FILES = new Set([
  "sprite.json",
  "sprite.png",
  "sprite@2x.json",
  "sprite@2x.png",
]);

export const SPRITE_ORDER = [
  "dm-3503", "dm-3504", "dm-3507", "dm-3509", "dm-3510", "dm-3511",
  "dm-3514", "dm-3515", "dm-3516", "dm-3519", "dm-3521", "dm-3522",
  "dm-3523", "dm-3524", "dm-3530", "dm-3532", "dm-3534", "dm-3548",
  "dm-3549", "dm-4201", "dm-4202", "dm-4219", "dm-4225", "dm-4231",
  "dm-4234", "dm-4235", "dm-4236", "dm-4239", "dm-4241", "dm-5221",
  "dm-6215", "dm-6221", "dm-6222", "dm-6225", "dm-6226", "dm-6311",
  "dm-6313", "dm-6317", "dm-6318", "dm-6319", "dm-6321", "dm-6331",
  "dm-6332", "dm-6333", "dm-6334", "dm-6335", "dm-6336", "dm-6337",
  "dm-7301", "dm-7302", "dm-7308", "dm-2239", "dm-3505", "dm-3517",
  "dm-3525", "dm-3526", "dm-3531", "dm-3536", "dm-3545", "dm-3546",
  "dm-3550", "dm-3556", "dm-3560", "dm-4203", "dm-4204", "dm-4205",
  "dm-4207", "dm-4222", "dm-4228", "dm-4243", "dm-4251", "dm-5226",
  "dm-5227", "dm-6212", "dm-6214", "dm-6216", "dm-6217", "dm-6314",
  "dm-6323", "dm-6338", "dm-6340", "dm-5105", "dm-7201", "dm-7206",
  "dm-7211", "dm-7213", "dm-7303", "dm-7305", "dm-5241", "dm-5228",
  "dm-4221", "dm-3401", "dm-4208", "dm-6315", "dm-7304", "dm-4265",
  "dm-2221", "dm-2241", "dm-2242", "dm-2243", "dm-2244", "dm-2246",
  "dm-2247", "dm-2251", "dm-2255", "dm-2256", "dm-2261", "dm-2262",
  "dm-2263", "dm-3508", "dm-3553", "dm-3557", "dm-4206", "dm-4211",
  "dm-4216", "dm-4217", "dm-4223", "dm-4232", "dm-4233", "dm-4237",
  "dm-4242", "dm-4252", "dm-4253", "dm-4254", "dm-4255", "dm-4256",
  "dm-5255", "dm-5256", "dm-6223", "dm-6224", "dm-6312", "dm-6316",
  "dm-6345", "dm-3512", "dm-3513", "dm-3518", "dm-3527", "dm-3512-level-1000",
  "dm-3513-level-1000", "dm-3518-level-1000", "dm-3527-level-1000", "dm-3523-level-1000", "dm-3523-level-2500", "dm-3523-level-5000",
  "dm-3528", "dm-3528-level-1000", "dm-3529", "dm-3529-level-1000", "dm-3552", "dm-3552-level-1000",
  "dm-4101", "dm-4111", "dm-4121", "dm-4131", "dm-4141", "dm-4151",
  "dm-4161", "dm-4215", "dm-4224", "dm-4226", "dm-4227", "dm-3559",
  "dm-3559-level-1000", "dm-4119", "dm-4132", "dm-4142", "dm-4238", "dm-4245",
  "dm-3556-level-1000", "dm-3556-level-2500", "dm-3556-level-5000", "dm-4228-level-2500", "dm-4228-level-5000", "dm-4208-level-2500",
  "dm-4208-level-5000", "dm-6322", "dm-5106", "dm-5219", "dm-2401", "dm-3508-level-1000", "dm-3553-level-1000", "dm-3557-level-1000", "dm-6223-level-1000",
];

export const CUSTOM_SIZES = new Map([
  ["dm-5241", {width: 40, height: 8}],
  ["dm-5228", {width: 48, height: 16}],
  ["dm-7201", {width: 64, height: 32}],
  ["dm-7211", {width: 64, height: 32}],
]);

export const toSpriteId = (value) => /^\d+$/.test(value) ? `dm-${value}` : value;

export const iconEntry = (relative) => {
  const base = relative.split(/[\\/]/).at(-1).replace(/\.[^.]+$/, "");
  const dmcode = /^\d+(?:-level-\d+)?$/.test(base) ? base.split("-")[0] : "";
  const spriteId = dmcode ? `dm-${base}` : "";
  const status = dmcode ? "supported" : "unused";
  const note = dmcode ? "" : "source filename does not identify a DMCode";
  return {relative, dmcode, spriteId, status, note};
};

export const orderIconMappingRows = (entries) => {
  const custom = ["dm-5241", "dm-5228"];
  return [
    ...custom.map((spriteId) => entries.find((entry) => entry.spriteId === spriteId)).filter(Boolean),
    ...entries.filter((entry) => !custom.includes(entry.spriteId)),
  ];
};

export const spriteSize = (spriteId) => CUSTOM_SIZES.get(spriteId) ?? {width: 32, height: 32};
