import {createPreviewControls} from "./preview-controls.js";
import {stableFeatureQuery} from "../core/inspect-style.js";

// Only data preparation differs; preview and inspect use the same viewer controls.
export const startBrowserApp = async ({app, document, fetch, location, window}) => {
  const base = new URL(".", location.href);
  const controls = createPreviewControls({app, document, fetch, location});
  const first = await fetch(new URL("api/inspect/state", base), {cache: "no-store"});
  if (first.status === 404) { await app.start(); await controls.refresh(); return; }
  if (!first.ok) throw new Error(`inspect startup failed: ${first.status}`);
  let activeRun;
  let started = false;
  let selected;
  let timer;
  let disposed = false;
  const blocked = [];
  app.onSelection(feature => { selected = feature; });
  const get = id => document.getElementById(id);
  const report = error => { get("preparation-status").hidden = false; get("preparation-status").textContent = error.message ?? String(error); };
  const display = async state => {
    const labels = {idle: state.ready ? "変換済み" : "変換準備中", running: "変換中", cancelling: "中止中", succeeded: "変換完了", failed: "変換失敗", cancelled: "中止しました"};
    const message = `${labels[state.status] ?? state.status}${state.error ? `: ${state.error}` : ""}`;
    get("data-generation").hidden = false;
    get("data-generation-status").textContent = message;
    get("data-generation-log").textContent = state.log;
    get("preparation-status").hidden = state.ready && !["running", "cancelling", "failed"].includes(state.status);
    get("preparation-status").textContent = message;
    if (!state.ready || state.lastRun === activeRun) return;
    for (const [element, disabled] of blocked.splice(0)) element.disabled = disabled;
    const previous = selected;
    if (started) await app.reload({dataChanged: true});
    else { await app.start(); started = true; }
    await controls.refresh();
    const query = stableFeatureQuery(previous);
    if (query) {
      const url = new URL("api/restore", base); url.search = new URLSearchParams(query);
      const response = await fetch(url, {cache: "no-store"});
      if (!response.ok) throw new Error(`選択を復元できません: HTTP ${response.status}`);
      const restored = await response.json();
      if (restored.feature) app.selectFeature(restored.feature);
    }
    activeRun = state.lastRun;
  };
  const poll = async () => {
    if (disposed) return;
    try {
      const response = await fetch(new URL("api/inspect/state", base), {cache: "no-store"});
      if (!response.ok) throw new Error(`データ生成状況を取得できません: HTTP ${response.status}`);
      await display(await response.json());
    } catch (error) { report(error); }
    if (!disposed) timer = setTimeout(poll, 700);
  };
  window.addEventListener("pagehide", () => { disposed = true; clearTimeout(timer); }, {once: true});
  const initial = await first.json();
  if (!initial.ready) for (const element of document.querySelectorAll('#sidebar input, #sidebar select, #sidebar button:not([role="tab"]), header input, header select')) {
    blocked.push([element, element.disabled]); element.disabled = true;
  }
  await display(initial);
  if (!initial.catalog && !initial.ready && !["running", "cancelling"].includes(initial.status)) {
    const response = await fetch(new URL("api/inspect/convert", base), {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({levels: [250, 500, 1000, 2500, 5000]})});
    if (!response.ok) throw new Error(`自動変換を開始できません: HTTP ${response.status}`);
    await display(await response.json());
  }
  timer = setTimeout(poll, 700);
};
