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
  if (!info.indexes.length) {
    container.textContent = "DMI情報はありません。";
    return;
  }

  const selector = document.createElement("select");
  selector.id = "dmi-index-select";
  selector.setAttribute("aria-label", "DMI情報の切り替え");
  for (const [position, index] of info.indexes.entries()) {
    const option = document.createElement("option");
    option.value = String(position);
    option.textContent = dmiLabel(index);
    selector.append(option);
  }

  const details = document.createElement("div");
  details.id = "dmi-index-details";
  selector.onchange = () => renderIndex(details, info.indexes[Number(selector.value)]);
  selector.value = "0";
  renderIndex(details, info.indexes[0]);
  container.append(selector, details);
};

const dmiLabel = (index) => {
  const level = index.mapLevels?.length ? index.mapLevels.map((value) => `1/${value}`).join(", ") : "縮尺未確認";
  return `${level} — ${index.source}`;
};

const renderIndex = (container, index) => {
  if (!index) return;
  const document = container.ownerDocument;
  container.replaceChildren();
  const section = document.createElement("section");
  const heading = document.createElement("h3");
  heading.textContent = dmiLabel(index);
  section.append(heading);
  section.append(table(document, ["項目", "値"], [
    ["平面直角座標系", `${index.zone}系`], ["計画機関", index.planner],
    ["分類数", index.classificationCount], ["転位", flag(index.displacement)],
    ["間断", flag(index.interruption)], ["作業規程年", index.ruleYear],
    ["作業規程名", index.ruleName], ["DMバージョン", index.formatVersion],
    ["予備領域使用区分", index.spareUsage],
  ]));
  const classifications = document.createElement("details");
  const title = document.createElement("summary");
  title.textContent = `分類コード対応（${index.classificationCount}件）`;
  classifications.append(title, table(document, ["使用", "標準", "種別", "方向定義", "次元", "説明"], index.classifications.map((item) => [
    item.usedCode, item.standardCode,
    TYPE_NAMES.filter((_, i) => item.types[i] === 1).join("・"),
    ({0: "標準", 1: "独自"})[item.direction] ?? `不明(${item.direction})`,
    ({0: "混在", 2: "2次元", 3: "3次元"})[item.dimension] ?? `不明(${item.dimension})`, item.description,
  ])));
  section.append(classifications);
  container.append(section);
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
