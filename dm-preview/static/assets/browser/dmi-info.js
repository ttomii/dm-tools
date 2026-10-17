const TYPE_NAMES = ["面", "線", "円", "円弧", "点", "方向", "注記", "属性", "格子/TIN"];

export const loadDmiInfo = async (container, manifest, api) => {
  if (!manifest.dmiInfo) {
    container.textContent = "DMI情報はありません（変換時にDMIがない、または旧形式の出力です）。";
    return;
  }
  try {
    const info = await api.style(api.resourceUrl(manifest.dmiInfo));
    renderDmiInfo(container, info);
  } catch (error) {
    container.textContent = `DMI情報を読み込めません: ${error.message}`;
  }
};

export const renderDmiInfo = (container, info) => {
  if (info.version !== 1 || !Array.isArray(info.indexes)) throw new Error("未対応のDMI情報形式です");
  const document = container.ownerDocument;
  container.replaceChildren();
  if (!info.indexes.length) container.textContent = "DMI情報はありません。";
  for (const index of info.indexes) {
    const section = document.createElement("section");
    const heading = document.createElement("h3");
    heading.textContent = `${index.source}（地図情報レベル: ${index.mapLevels?.join(", ") || "未確認"}）`;
    section.append(heading);
    section.append(table(document, ["項目", "値"], [
      ["対応DM数", index.dmFiles?.length || "未確認"],
      ["平面直角座標系", `${index.zone}系`], ["計画機関", index.planner],
      ["図郭数", index.meshCount], ["分類数", index.classificationCount],
      ["転位", flag(index.displacement)], ["間断", flag(index.interruption)],
      ["作業規程年", index.ruleYear], ["作業規程名", index.ruleName],
      ["DMバージョン", index.formatVersion], ["予備領域使用区分", index.spareUsage],
    ]));
    const files = document.createElement("details");
    const fileTitle = document.createElement("summary");
    fileTitle.textContent = `対応DM一覧（${index.dmFiles?.length ?? 0}件）`;
    const fileText = document.createElement("p");
    fileText.textContent = index.dmFiles?.join(", ") || "未確認";
    files.append(fileTitle, fileText);
    section.append(files);
    const meshes = document.createElement("details");
    const meshTitle = document.createElement("summary");
    meshTitle.textContent = `図郭一覧（${index.meshCount}件）`;
    const meshText = document.createElement("p");
    meshText.textContent = index.meshes.join(", ");
    meshes.append(meshTitle, meshText);
    section.append(meshes);
    const details = document.createElement("details");
    const title = document.createElement("summary");
    title.textContent = `分類コード対応（${index.classificationCount}件）`;
    details.append(title, table(document, ["使用", "標準", "種別", "方向定義", "次元", "説明"], index.classifications.map((item) => [
      item.usedCode, item.standardCode,
      TYPE_NAMES.filter((_, i) => item.types[i] === 1).join("・"),
      ({0: "標準", 1: "独自"})[item.direction] ?? `不明(${item.direction})`,
      ({0: "混在", 2: "2次元", 3: "3次元"})[item.dimension] ?? `不明(${item.dimension})`, item.description,
    ])));
    section.append(details);
    container.append(section);
  }
};

const flag = (value) => ({0: "未設定", 1: "設定あり"})[value] ?? `不明(${value})`;

const table = (document, headers, rows) => {
  const result = document.createElement("table");
  result.className = "dmi-table";
  for (const [index, values] of [headers, ...rows].entries()) {
    const row = document.createElement("tr");
    for (const value of values) {
      const cell = document.createElement(index === 0 ? "th" : "td");
      cell.textContent = String(value ?? "");
      row.append(cell);
    }
    result.append(row);
  }
  return result;
};
