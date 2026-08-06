// ====== 配置 ======
const API_BASE = "";

// ====== 工具 ======
function $(id) { return document.getElementById(id); }
function qs(sel, ctx) { return (ctx || document).querySelector(sel); }
function qsa(sel, ctx) { return (ctx || document).querySelectorAll(sel); }

const CLOUD_MODE = typeof SUPABASE_CONFIG !== "undefined" && SUPABASE_CONFIG.url && !SUPABASE_CONFIG.url.includes("YOUR_PROJECT");
let sb = null;
if (CLOUD_MODE) {
  try { sb = supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey); } catch (e) { console.error("Supabase init failed:", e); }
}

async function api(path, opts = {}) {
  if (!CLOUD_MODE || !sb) {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json", ...opts.headers },
      ...opts,
    });
    return res.json();
  }
  return cloudApi(path, opts);
}

// ====== 云端 API（Supabase） ======
async function cloudApi(path, opts = {}) {
  const method = opts.method || "GET";

  // GET /api/data/:date
  let m = path.match(/^\/api\/data\/(\d{4}-\d{2}-\d{2})$/);
  if (m && method === "GET") {
    const { data, error } = await sb.from("daily_records").select("date,data").eq("date", m[1]).maybeSingle();
    if (error) return { error: error.message };
    if (data) return { date: m[1], data: data.data || {}, exists: true };
    return { date: m[1], exists: false };
  }

  // GET /api/data/recent/:days
  m = path.match(/^\/api\/data\/recent\/(\d+)$/);
  if (m && method === "GET") {
    const { data, error } = await sb.from("daily_records").select("date,data").order("date", { ascending: false }).limit(parseInt(m[1]));
    if (error) return [];
    return (data || []).reverse().map(r => ({ ...(r.data || {}), _date: r.date }));
  }

  // POST /api/data/save
  if (path === "/api/data/save" && method === "POST") {
    const body = JSON.parse(opts.body || "{}");
    const { error } = await sb.from("daily_records").upsert({ date: body.date, data: body.fields || {} });
    if (error) return { error: error.message };
    return { success: true };
  }

  // GET /api/analysis/:date
  m = path.match(/^\/api\/analysis\/(\d{4}-\d{2}-\d{2})$/);
  if (m && method === "GET") {
    const { data, error } = await sb.from("analysis_reports").select("content").eq("date", m[1]).maybeSingle();
    if (error) return { date: m[1], exists: false };
    if (data) return { date: m[1], content: data.content, exists: true };
    return { date: m[1], exists: false };
  }

  // GET /api/analysis/recent
  if (path === "/api/analysis/recent" && method === "GET") {
    const { data } = await sb.from("analysis_reports").select("date").order("date", { ascending: false }).limit(7);
    return (data || []).map(r => ({ date: r.date, path: r.date }));
  }

  // GET /api/career
  if (path === "/api/career" && method === "GET") {
    const { data, error } = await sb.from("career_plans").select("module,data");
    if (error) return { modules: [] };
    const names = ["学业考试", "竞赛", "自媒体", "AI学习", "创作及转化"];
    const modules = names.map(name => {
      const row = (data || []).find(r => r.module === name);
      return { module: name, frontmatter: row ? row.data || {} : {} };
    });
    return { overview: null, modules };
  }

  // PUT /api/career
  if (path === "/api/career" && method === "PUT") {
    const body = JSON.parse(opts.body || "{}");
    const { data: existing } = await sb.from("career_plans").select("data").eq("module", body.module).maybeSingle();
    const merged = { ...(existing?.data || {}), ...(body.fields || {}) };
    const { error } = await sb.from("career_plans").upsert({ module: body.module, data: merged });
    if (error) return { error: error.message };
    return { success: true };
  }

  return { error: "unknown cloud route: " + path };
}

function toast(msg) {
  let el = qs(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2500);
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function greet() {
  const h = new Date().getHours();
  if (h < 6) return "夜深了";
  if (h < 9) return "早上好";
  if (h < 12) return "上午好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

function formatDate(dateStr) {
  const [, m, d] = dateStr.split("-");
  return `${parseInt(m)}月${parseInt(d)}日`;
}

function weekDay(dateStr) {
  const days = ["日","一","二","三","四","五","六"];
  return `周${days[new Date(dateStr).getDay()]}`;
}

// 滑块数值同步
document.addEventListener("input", (e) => {
  if (e.target.type === "range") {
    const rv = $(`rv-${e.target.id.replace("f-","")}`);
    if (rv) rv.textContent = e.target.value;
  }
});

// Tab 切换
const tabs = ["home","entry","trends","analysis","career"];
qsa(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    qsa(".nav-item").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    qsa(".tab-content").forEach(c => c.classList.remove("active"));
    $(`tab-${tab}`).classList.add("active");
    if (tab === "home") loadHome();
    if (tab === "trends") loadTrends();
    if (tab === "analysis") loadAnalysis();
    if (tab === "career") loadCareer();
    if (tab === "entry") loadEntry();
  });
});

// 初始化
let energyChartToday = null, trendMainChart = null, trendEnergyChart = null, trendFocusChart = null, careerPieChart = null;

document.addEventListener("DOMContentLoaded", () => {
  $("header-date").textContent = `${formatDate(todayStr())} ${weekDay(todayStr())}`;
  $("greeting").textContent = `${greet()} ☀️`;
  const ed = $("entry-date");
  if (ed) ed.value = todayStr();
  loadHome();
});


// Chart.js 全局样式
Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
Chart.defaults.color = "#6a8a94";
Chart.defaults.borderColor = "rgba(47,164,160,.08)";
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.pointStyle = "circle";`n// ====== 首页 ======
async function loadHome() {
  const data = await api(`/api/data/${todayStr()}`);
  let recent = [];
  try { recent = await api("/api/data/recent/7"); } catch {}

  if (data.exists && data.data) {
    const d = data.data;
    $("sc-body").textContent = d["身体_评分"] || "--";
    $("sc-energy").textContent = d["精力_评分"] || "--";
    $("sc-mood").textContent = d["情绪_平均值"] || "--";

    if (recent.length >= 2) {
      const prev = recent[recent.length-2];
      showTrend("sc-body-trend", d["身体_评分"], prev["身体_评分"]);
      showTrend("sc-energy-trend", d["精力_评分"], prev["精力_评分"]);
      showTrend("sc-mood-trend", d["情绪_平均值"], prev["情绪_平均值"]);
    }

    $("qi-sleep").textContent = d["睡眠_入睡时间"] && d["睡眠_起床时间"]
      ? `${d["睡眠_入睡时间"]}-${d["睡眠_起床时间"]}` : "--";
    $("qi-focus").textContent = d["专注_总时长"] ? `${d["专注_总时长"]}h` : "--";
    $("qi-water").textContent = d["喝水_杯数"] ? `${d["喝水_杯数"]}杯` : "--";
    $("qi-activity").textContent = d["活动_列表"] || "--";

    renderEnergyCurve(d);
    renderPrediction(d);
  } else {
    ["sc-body","sc-energy","sc-mood"].forEach(id => $(id).textContent = "--");
    ["qi-sleep","qi-focus","qi-water","qi-activity"].forEach(id => $(id).textContent = "--");
  }
}

function showTrend(elId, curr, prev) {
  const el = $(elId);
  if (!curr || !prev) { el.textContent = ""; return; }
  const diff = parseInt(curr) - parseInt(prev);
  if (diff > 0) el.innerHTML = `↑ ${diff}`;
  else if (diff < 0) el.innerHTML = `↓ ${Math.abs(diff)}`;
  else el.textContent = "→ 0";
  el.className = "sc-trend " + (diff > 0 ? "up" : diff < 0 ? "down" : "");
}

function renderEnergyCurve(d) {
  const labels = ["早6-9","上午9-12","午后12-14","下午14-18","傍晚18-21","夜间21-24"];
  const values = [
    parseInt(d["精力_早晨_6_9点"])||0, parseInt(d["精力_上午_9_12点"])||0,
    parseInt(d["精力_午后_12_14点"])||0, parseInt(d["精力_下午_14_18点"])||0,
    parseInt(d["精力_傍晚_18_21点"])||0, parseInt(d["精力_夜间_21_24点"])||0,
  ];

  if (energyChartToday) energyChartToday.destroy();
  energyChartToday = new Chart($("energy-curve-today"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: "#6366f1",
        backgroundColor: "rgba(99,102,241,.12)",
        fill: true, tension: .35,
        pointBackgroundColor: "#6366f1",
        pointRadius: 4, borderWidth: 2.5,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { min: 0, max: 10, ticks: { stepSize: 2, font: { size: 10 } }, grid: { color: "rgba(0,0,0,.05)" } },
        x: { ticks: { font: { size: 10 } }, grid: { display: false } },
      },
    },
  });
}

function renderPrediction(d) {
  const body = parseInt(d["身体_评分"]) || 5;
  const energy = parseInt(d["精力_评分"]) || 5;
  const mood = parseInt(d["情绪_平均值"]) || 5;
  const sleepQ = parseInt(d["睡眠_质量"]) || 5;
  const predBody = Math.max(1, Math.min(10, body - 0.5 + (sleepQ-5)*0.15));
  const predEnergy = Math.max(1, Math.min(10, energy - 1 + (sleepQ-5)*0.12));
  const predMood = Math.max(1, Math.min(10, mood + (sleepQ-5)*0.08));
  $("pred-body").style.width = `${predBody*10}%`;
  $("pred-energy").style.width = `${predEnergy*10}%`;
  $("pred-mood").style.width = `${predMood*10}%`;
}

// ====== 录入 ======
function entryDate() {
  const el = $("entry-date");
  return el && el.value ? el.value : todayStr();
}

async function loadEntry() {
  try {
    const d = entryDate();
    const data = await api(`/api/data/${d}`);
    if (data.exists && data.data) fillForm(data.data);
  } catch {}
}

$("entry-date").addEventListener("change", () => {
  loadEntry();
});

function fillToday() {
  const now = new Date();
  $("f-睡眠_起床时间").value = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
  loadEntry();
}

function fillForm(d) {
  const fields = [
    "睡眠_入睡时间","睡眠_起床时间","睡眠_时长小时","睡眠_质量",
    "午休_开始","午休_结束","午休_时长分钟","午休_质量",
    "经期_第几天","经期_强度","饮食_质量","饮食_备注",
    "喝水_杯数","身体_症状","身体_评分",
    "精力_早晨_6_9点","精力_上午_9_12点","精力_午后_12_14点",
    "精力_下午_14_18点","精力_傍晚_18_21点","精力_夜间_21_24点",
    "专注_总时长","专注_最高强度","专注_平均强度","精力_评分",
    "情绪_平均值","情绪_最低","情绪_最高","情绪_描述","情绪_触发事件",
    "活动_列表","恢复_列表","总结_今日亮点","总结_今日挑战","总结_一句话",
  ];
  fields.forEach(f => {
    const el = $(`f-${f}`);
    if (el && d[f] !== undefined && d[f] !== null) {
      el.value = d[f];
      if (el.type === "range") {
        const rv = $(`rv-${f}`);
        if (rv) rv.textContent = d[f];
      }
    }
  });
}

$("entry-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("entry-submit");
  btn.disabled = true;
  btn.textContent = "保存中...";

  const fields = {};
  const fieldNames = [
    "睡眠_入睡时间","睡眠_起床时间","睡眠_时长小时","睡眠_质量",
    "午休_开始","午休_结束","午休_时长分钟","午休_质量",
    "经期_第几天","经期_强度","饮食_质量","饮食_备注",
    "喝水_杯数","身体_症状","身体_评分",
    "精力_早晨_6_9点","精力_上午_9_12点","精力_午后_12_14点",
    "精力_下午_14_18点","精力_傍晚_18_21点","精力_夜间_21_24点",
    "专注_总时长","专注_最高强度","专注_平均强度","精力_评分",
    "情绪_平均值","情绪_最低","情绪_最高","情绪_描述","情绪_触发事件",
    "活动_列表","恢复_列表","总结_今日亮点","总结_今日挑战","总结_一句话",
  ];
  fieldNames.forEach(f => {
    const el = $(`f-${f}`);
    if (el) {
      const val = el.value.trim();
      if (val !== "") fields[f] = val;
    }
  });

  try {
    const result = await api("/api/data/save", {
      method: "POST",
      body: JSON.stringify({ date: entryDate(), fields }),
    });
    if (result.success) {
      toast("今日记录已保存 ✅");
      loadHome();
    } else {
      toast("保存失败: " + (result.error || "未知错误"));
    }
  } catch (err) {
    toast("保存失败: " + err.message);
  }
  btn.disabled = false;
  btn.textContent = "保存记录";
});

// ====== 趋势 ======
async function loadTrends() {
  const data = await api("/api/data/recent/7");
  if (!data.length) {
    $("trend-main").parentElement.innerHTML = '<p class="empty-state">暂无足够数据</p>';
    return;
  }

  const labels = data.map(d => formatDate(d._date));
  const bodyVals = data.map(d => parseInt(d["身体_评分"])||0);
  const energyVals = data.map(d => parseInt(d["精力_评分"])||0);
  const moodVals = data.map(d => parseInt(d["情绪_平均值"])||0);
  const focusVals = data.map(d => parseFloat(d["专注_总时长"])||0);

  if (trendMainChart) trendMainChart.destroy();
  trendMainChart = new Chart($("trend-main"), {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "身体", data: bodyVals, borderColor: "#2563eb", backgroundColor: "rgba(37,99,235,.08)", fill: true, tension: .35, pointRadius: 3, borderWidth: 2 },
        { label: "精力", data: energyVals, borderColor: "#d97706", backgroundColor: "rgba(217,119,6,.08)", fill: true, tension: .35, pointRadius: 3, borderWidth: 2 },
        { label: "情绪", data: moodVals, borderColor: "#db2777", backgroundColor: "rgba(219,39,119,.08)", fill: true, tension: .35, pointRadius: 3, borderWidth: 2 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "top", labels: { font: { size: 11 }, boxWidth: 12, padding: 8 } } },
      scales: { y: { min: 1, max: 10, ticks: { stepSize: 2, font: { size: 10 } }, grid: { color: "rgba(0,0,0,.05)" } }, x: { ticks: { font: { size: 10 } }, grid: { display: false } } },
    },
  });

  const periodLabels = ["早6-9","上午9-12","午后12-14","下午14-18","傍晚18-21","夜间21-24"];
  const periodKeys = ["精力_早晨_6_9点","精力_上午_9_12点","精力_午后_12_14点","精力_下午_14_18点","精力_傍晚_18_21点","精力_夜间_21_24点"];
  const periodDatasets = periodKeys.map((key,i) => ({
    label: periodLabels[i],
    data: data.map(d => parseInt(d[key])||0),
    borderColor: `hsl(${250+i*12},60%,55%)`,
    backgroundColor: `hsla(${250+i*12},60%,55%,.08)`,
    fill: true, tension: .35, pointRadius: 3, borderWidth: 1.5,
  }));

  if (trendEnergyChart) trendEnergyChart.destroy();
  trendEnergyChart = new Chart($("trend-energy"), {
    type: "line",
    data: { labels, datasets: periodDatasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "top", labels: { font: { size: 10 }, boxWidth: 10, padding: 6 } }, title: { display: true, text: "各时段精力趋势", font: { size: 13 } } },
      scales: { y: { min: 1, max: 10, ticks: { stepSize: 2, font: { size: 10 } }, grid: { color: "rgba(0,0,0,.05)" } }, x: { ticks: { font: { size: 10 } }, grid: { display: false } } },
    },
  });

  if (trendFocusChart) trendFocusChart.destroy();
  trendFocusChart = new Chart($("trend-focus"), {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "专注时长(h)",
        data: focusVals,
        backgroundColor: "rgba(99,102,241,.6)",
        borderColor: "#6366f1", borderWidth: 1, borderRadius: 4,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, title: { display: true, text: "专注时长趋势", font: { size: 13 } } },
      scales: { y: { beginAtZero: true, ticks: { font: { size: 10 } }, grid: { color: "rgba(0,0,0,.05)" } }, x: { ticks: { font: { size: 10 } }, grid: { display: false } } },
    },
  });
}

// ====== 分析 ======
async function loadAnalysis() {
  const content = $("analysis-content");
  try {
    const analysis = await api(`/api/analysis/${todayStr()}`);
    if (analysis.exists && analysis.content) {
      content.innerHTML = marked.parse(analysis.content) + `<hr style="margin:16px 0;border:none;border-top:1px solid var(--border)"><p style="font-size:11px;color:var(--text2);text-align:center">分析由 Codex 生成</p>`;
    } else {
      const list = await api("/api/analysis/recent");
      if (list.length > 0) {
        const latest = await api(`/api/analysis/${list[0].date}`);
        if (latest.exists && latest.content) {
          content.innerHTML = `<div style="font-size:13px;line-height:1.7;white-space:pre-wrap">${latest.content.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>`;
          return;
        }
      }
      content.innerHTML = '<p class="empty-state">暂无分析报告。填写每日记录后，我将在下次分析中生成。</p>';
    }
  } catch {
    content.innerHTML = '<p class="empty-state">无法加载分析数据</p>';
  }
}

// ====== 生涯 ======
async function loadCareer() {
  try {
    const data = await api("/api/career");
    if (!data || !data.modules) return;

    const modules = data.modules;
    const names = modules.map(m => m.module);
    const pcts = modules.map(m => parseInt(m.frontmatter?.energy_percentage)||0);
    const colors = ["#6366f1","#f59e0b","#22c55e","#ef4444","#8b5cf6"];
    const hasData = pcts.some(p => p > 0);

    if (hasData) {
      if (careerPieChart) careerPieChart.destroy();
      careerPieChart = new Chart($("career-pie"), {
        type: "doughnut",
        data: { labels: names, datasets: [{ data: pcts, backgroundColor: colors, borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { font: { size: 11 }, boxWidth: 12, padding: 8 } } }, cutout: "65%" },
      });
    } else {
      qs("#career-pie").parentElement.innerHTML = '<p class="empty-state">暂未记录能量分配数据</p>';
    }

    const container = $("career-modules");
    container.innerHTML = modules.map((m,i) => {
      const fm = m.frontmatter || {};
      return `
        <div class="career-module" data-module="${m.module}">
          <div class="cm-info">
            <div class="cm-name">${m.module}</div>
            <div class="cm-meta">${fm.status||"待开始"} · 下一步: ${fm.next_action||"待定义"} · 截止: ${fm.target_date||"待定"}</div>
          </div>
          <div class="cm-progress" style="color:${colors[i]}">${fm.progress||0}%</div>
          <button class="cm-edit" onclick="editCareer('${m.module}')">编辑</button>
        </div>
      `;
    }).join("");
  } catch {}
}

function editCareer(module) {
  const newProgress = prompt(`"${module}" 当前进度 (%)：`);
  if (newProgress === null) return;
  const newNext = prompt(`"${module}" 下一步行动：`);
  const newTarget = prompt(`"${module}" 目标日期 (YYYY-MM-DD)：`);
  const fields = {};
  if (newProgress) fields.progress = newProgress;
  if (newNext) fields.next_action = newNext;
  if (newTarget) fields.target_date = newTarget;
  api("/api/career", { method: "PUT", body: JSON.stringify({ module, fields }) })
    .then(r => { if (r.success) { toast("更新成功 ✅"); loadCareer(); } else toast("更新失败"); });
}
