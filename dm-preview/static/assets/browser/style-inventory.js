import {createStyleInventory, INVENTORY_GROUPS, parseFeatureInventory, STYLE_STATES} from "../core/style-inventory.js";

const KIND_NAMES = {point: "点", line: "線", polygon: "面", text: "注記"};

export const createInventoryView = (container, manifest) => {
  const controls = createControls(container, manifest);
  const state = {inventory: undefined, style: undefined, error: ""};
  const render = () => renderInventory(controls, state, manifest);
  for (const input of [controls.search, controls.level, controls.group]) {
    input.addEventListener(input === controls.search ? "input" : "change", render);
  }
  return {
    setStyle: (style) => { state.style = style; render(); },
    load: async (api) => {
      Object.assign(state, await loadInventory(api, manifest));
      render();
    },
  };
};

const loadInventory = async (api, manifest) => {
  try {
    const inventory = manifest.featureInventory
      ? parseFeatureInventory(await api.style(api.resourceUrl(manifest.featureInventory)))
      : {version: 1, entries: [], complete: false};
    return {inventory, error: ""};
  } catch (error) {
    return {inventory: {version: 1, entries: [], complete: false}, error: `データ内訳を読み込めません: ${error.message}。`};
  }
};

const createControls = (container, manifest) => {
  const document = container.ownerDocument;
  const search = element(document, "input");
  search.type = "search";
  search.placeholder = "DMコードを検索";
  search.setAttribute("aria-label", "DMコードを検索");
  const level = select(document, "地図情報レベル", [["", "すべてのレベル"], ...manifest.levels.map((value) => [String(value), String(value)])]);
  const group = select(document, "定義の分類", [["", "すべての分類"], ...INVENTORY_GROUPS.map((label, index) => [String(index), label])]);
  const controls = element(document, "div");
  controls.className = "inventory-controls";
  controls.append(search, level, group);
  const notice = element(document, "p", "データ内訳を読み込み中...");
  notice.setAttribute("role", "status");
  const result = element(document, "div");
  container.replaceChildren(controls, notice, result);
  return {search, level, group, notice, result};
};

const renderInventory = ({search, level, group, notice, result}, state, manifest) => {
  const rows = createStyleInventory(state.inventory, state.style, manifest).filter((row) =>
    String(row.dmCode).includes(search.value ?? "") && (!level.value || String(row.level) === level.value) &&
    (!group.value || String(row.group) === group.value));
  notice.textContent = state.inventory?.complete === false || !state.inventory
    ? `${state.error} データ内訳がないため、実データの有無・レベル別内訳・自動生成図形の有無は判定不明です。統合注記のコードは省略される場合があります。`
    : `${rows.length}件`;
  renderRows(result, rows);
};

export const renderRows = (container, rows) => {
  const document = container.ownerDocument;
  container.replaceChildren();
  if (!rows.length) {
    container.append(element(document, "p", "該当するDMコードはありません。"));
    return;
  }
  for (const [index, label] of INVENTORY_GROUPS.entries()) {
    const members = rows.filter((row) => row.group === index);
    if (!members.length) continue;
    const section = element(document, "section");
    section.append(element(document, "h4", `${label}（${members.length}件）`));
    const table = element(document, "table");
    table.className = "dmi-table inventory-table";
    const head = element(document, "thead");
    head.append(tableRow(document, ["レベル／DMコード", "元図形", "自動生成図形", "詳細"], true));
    const body = element(document, "tbody");
    for (const row of members) body.append(inventoryRow(document, row));
    table.append(head, body);
    section.append(table);
    container.append(section);
  }
};

const inventoryRow = (document, row) => {
  const baseEntries = row.entries.filter((entry) => !isGenerated(entry));
  const generated = row.entries.filter(isGenerated);
  const base = ["point", "line", "polygon", "text"].map((kind) => {
    const entries = baseEntries.filter((entry) => entry.kind === kind);
    return `${KIND_NAMES[kind]}: ${entries.length ? [...new Set(entries.map((entry) => STYLE_STATES[entry.status]))].join("・") : row.complete ? "対象データなし" : "判定不明"}`;
  }).join("\n");
  const decorations = generated.map((entry) => `${entry.decoration ?? "種別不明"}（${KIND_NAMES[entry.kind]}）: ${STYLE_STATES[entry.status]}`).join("\n");
  const result = tableRow(document, [`${row.level} / ${row.dmCode}${row.partial ? "\n一部個別定義" : ""}`, base,
    row.complete ? decorations || "なし" : "有無は判定不明", ""]);
  const details = element(document, "details");
  details.append(element(document, "summary", "対応レイヤ"));
  for (const entry of row.entries) {
    const lines = [entry.sourceLayer, `${entry.count ?? "不明"}件`,
      ...(entry.srcLayer ? [`生成元: ${entry.srcLayer} / DMコード ${row.dmCode}`] : []),
      ...entry.layers.map((layer) => `${layer.id}（${layer.origin === "individual" ? "個別定義" : layer.origin === "default" ? "デフォルト" : "判定不明"}）`)];
    details.append(element(document, "p", lines.join("\n")));
  }
  result.children[3].append(details);
  return result;
};

const isGenerated = (entry) => entry.decoration != null || entry.generated;
const element = (document, tag, text) => {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
};
const select = (document, label, options) => {
  const result = element(document, "select");
  result.setAttribute("aria-label", label);
  for (const [value, text] of options) {
    const option = element(document, "option", text);
    option.value = value;
    result.append(option);
  }
  result.value = "";
  return result;
};
const tableRow = (document, values, header = false) => {
  const row = element(document, "tr");
  for (const value of values) {
    const cell = element(document, header ? "th" : "td", value);
    if (header) cell.setAttribute("scope", "col");
    row.append(cell);
  }
  return row;
};
