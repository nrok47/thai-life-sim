// เอนจินเกม "1 ใน 66 ล้าน" — เฟส 1
// ข้อมูลทั้งหมดมาจาก GAMEDATA (สร้างจาก build-data.py) · ห้าม hardcode ตัวเลขสุขภาพในไฟล์นี้

const W = GAMEDATA.world;
const EVENTS = GAMEDATA.events;              // รวมทุกงานแล้วจาก build-data.py
const MILESTONES = GAMEDATA.milestones.milestones;
const LT = GAMEDATA["life-table"];
const WEALTH = W.wealth;

// ---------- สุ่มแบบกำหนดเมล็ดได้ เพื่อให้ชีวิตเดียวกันเล่นซ้ำได้ผลเหมือนเดิม ----------
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

// ---------- สถานะเกม ----------
const G = {
  rng: null,
  seed: 0,
  age: 0,
  alive: true,
  sex: "female",
  name: "",
  partner: "",
  province: null,
  subdistrict: "",
  stats: {},
  flags: new Set(),
  used: new Set(),
  log: [],          // { age, text, tone, stat }
  focus: "health",
  speed: 4,
  auto: false,
  pending: null,    // การ์ดที่ค้างอยู่
  timer: null,
  autoTimer: null,
  reflection: "",
};

// นิทานพื้นบ้านดาวอาสตร้า — เรื่องแต่งล้วน ไม่ใช่โหราศาสตร์ไทย ห้ามปนกับกล่องสถิติจริง (ดู SCOPE-ลอกอะไรได้บ้าง.md ข้อ 4)
const FORTUNES = [
  "ชาวบ้านเล่าว่าเด็กที่เกิดคืนฟ้าใสจะมีน้ำใจงาม",
  "ว่ากันว่าเด็กที่เกิดตอนไก่ขันจะขยันไม่รู้จักเหนื่อย",
  "ผู้เฒ่าในหมู่บ้านเชื่อว่าเด็กที่ร้องเสียงดังจะโชคดีเรื่องเพื่อนฝูง",
  "มีคำเล่าลือว่าเด็กที่เกิดวันฝนตกจะใจเย็นเป็นพิเศษ",
  "ชาวนาแถวนี้ว่าเด็กที่เกิดช่วงเก็บเกี่ยวจะไม่อดอยาก",
  "มีคนทายว่าเด็กที่เกิดตอนพระจันทร์เต็มดวงจะมีลางสังหรณ์ดี",
  "ผู้ใหญ่ในบ้านพูดติดตลกว่าเด็กที่นอนหลับง่ายจะโตมาไม่ดื้อ",
  "มีความเชื่อว่าเด็กที่เกิดตอนแดดจัดจะอดทนกว่าใคร",
];

// ช่วงวัย — ใช้แสดงผลอย่างเดียว ไม่ผูกกับ event/effect ใด ๆ
const STAGES = [
  { id: "child", label: "วัยเด็ก", from: 0, to: 12 },
  { id: "teen", label: "วัยเรียน", from: 13, to: 19 },
  { id: "work", label: "วัยทำงาน", from: 20, to: 59 },
  { id: "elder", label: "สูงอายุ", from: 60, to: 999 },
];

// โอกาสเกิดแบบนี้ = สัดส่วนจริงที่ใช้สุ่มในเกม (เพศ 50/50 × จังหวัดสุ่มเท่ากัน × ฐานะตาม dist_by_province)
// ไม่ใช่เลขแต่งขึ้น — ดึงจากตัวแปรเดียวกับที่ newLife() ใช้สุ่มจริง
function rarityOneIn() {
  const sexP = 0.5;
  const provP = 1 / W.provinces.length;
  const dist = WEALTH.dist_by_province[G.province.id] || [];
  const wealthP = dist[G.wealth] ?? 0.2;
  const p = sexP * provP * wealthP;
  return p > 0 ? Math.round(1 / p) : null;
}

const FOCUS = {
  health: { label: "ดูแลสุขภาพ", bias: { phys: 1 } },
  family: { label: "ครอบครัวและคนรอบข้าง", bias: { mind: 1 } },
  work: { label: "งานและรายได้", bias: { mind: -0.5 } },
  learn: { label: "เรียนรู้เรื่องสุขภาพ", bias: { lit: 1 } },
};

function newLife(seed) {
  G.seed = seed >>> 0;
  G.rng = makeRng(G.seed);
  const r = G.rng;
  G.age = 0;
  G.alive = true;
  G.sex = r() < 0.5 ? "male" : "female";
  const given = G.sex === "male" ? W.names.given_male : W.names.given_female;
  G.name = `${pick(r, given)} ${pick(r, W.names.family)}`;
  G.partner = `${pick(r, r() < 0.5 ? W.names.given_male : W.names.given_female)}`;
  G.province = pick(r, W.provinces);
  G.subdistrict = pick(r, W.subdistricts);
  G.stats = {};
  W.stats.forEach((s) => (G.stats[s.id] = s.id === "env" ? G.province.env_base : s.start));
  G.flags = new Set();
  G.used = new Set();
  G.log = [];
  G.pending = null;
  G.reflection = "";
  G.wealth = pickWealth();
  if (r() < 0.185) G.flags.add("smoker"); // ความชุกการสูบบุหรี่ จาก NHES7
}

// ---------- การเดินเวลา ----------
function clamp(v) { return Math.max(0, Math.min(100, v)); }

function applyEffect(eff) {
  if (!eff) return;
  Object.entries(eff).forEach(([k, v]) => {
    if (G.stats[k] === undefined) return;
    G.stats[k] = clamp(G.stats[k] + v);
  });
}

function addLog(text, tone, stat) {
  G.log.unshift({ age: G.age, text, tone: tone || "neutral", stat: stat || null });
}

// ---------- ตารางชีพ ----------
// nqx ในไฟล์คือโอกาสตาย "ตลอดช่วงอายุ" ต้องแปลงเป็นรายปีก่อนใช้: 1-(1-nqx)^(1/n)
const LT_ROWS = (() => {
  const rows = [];
  Object.keys(LT.male).forEach((k) => {
    const [lo, hi] = k.split("-").map(Number);
    rows.push({ lo, hi, n: hi - lo + 1, m: LT.male[k], f: LT.female[k] });
  });
  return rows.sort((a, b) => a.lo - b.lo);
})();

function baseQx() {
  const row = LT_ROWS.find((r) => G.age >= r.lo && G.age <= r.hi) || LT_ROWS[LT_ROWS.length - 1];
  const nqx = G.sex === "male" ? row.m : row.f;
  if (nqx >= 1) return 1;
  return 1 - Math.pow(1 - nqx, 1 / row.n);
}

// ความเสี่ยงตายต่อปี = ค่าจากตารางชีพ ปรับด้วยสถานะกาย สิ่งแวดล้อม และฐานะ
// ตัวคูณด้านล่างยังเป็นค่าสมมติ — ตารางชีพเองก็ยังเป็น placeholder (ดู data/life-table.json)
function deathChance() {
  const q = baseQx();
  const frail = Math.max(0, (70 - G.stats.phys) / 100);
  const envPenalty = Math.max(0, (60 - G.stats.env) / 100);
  const poverty = Math.max(0, -WEALTH.tiers[G.wealth].access / 100);
  return Math.min(1, q * (1 + frail * 1.6 + envPenalty * 0.4 + poverty * 2.0));
}

// ---------- ฐานะทางเศรษฐกิจ ----------
function pickWealth() {
  const dist = WEALTH.dist_by_province[G.province.id] || [0.2, 0.3, 0.3, 0.15, 0.05];
  let t = G.rng();
  for (let i = 0; i < dist.length; i++) { t -= dist[i]; if (t <= 0) return i; }
  return dist.length - 1;
}

function canAfford(cost) {
  return !cost || WEALTH.tiers[G.wealth].spare_monthly >= cost;
}

function wealthDrift() {
  const m = WEALTH.mobility;
  const up = m.up_per_year + (G.stats.lit > 70 ? m.up_bonus_if_lit_high : 0);
  if (G.wealth < 4 && G.rng() < up) {
    G.wealth++;
    addLog(`ฐานะครอบครัวขยับขึ้นเป็น "${WEALTH.tiers[G.wealth].label}"`, "good");
  } else if (G.wealth > 0 && G.rng() < m.down_per_year) {
    G.wealth--;
    addLog(`ฐานะครอบครัวถอยลงมาเป็น "${WEALTH.tiers[G.wealth].label}"`, "bad");
  }
}

function yearlyDrift() {
  // ร่างกายเสื่อมตามอายุ · สิ่งแวดล้อมเกาะค่าพื้นฐานของพื้นที่
  if (G.age > 30) G.stats.phys = clamp(G.stats.phys - (G.age > 60 ? 1.2 : 0.4));
  G.stats.env = clamp(G.stats.env + (G.province.env_base - G.stats.env) * 0.15);
  const bias = FOCUS[G.focus].bias;
  Object.entries(bias).forEach(([k, v]) => (G.stats[k] = clamp(G.stats[k] + v)));
  // ธงที่ส่งผลสะสมทุกปี
  if (G.flags.has("smoker")) G.stats.phys = clamp(G.stats.phys - 0.8);
  if (G.flags.has("stopped_meds")) G.stats.phys = clamp(G.stats.phys - 1.2);
  if (G.flags.has("sugar_habit")) G.stats.phys = clamp(G.stats.phys - 0.5);
  if (G.flags.has("isolated")) G.stats.mind = clamp(G.stats.mind - 1.5);
  if (G.flags.has("adherent")) G.stats.phys = clamp(G.stats.phys + 0.4);
}

function eligible(list, isEvent) {
  return list.filter((e) => {
    if (G.used.has(e.id)) return false;
    if (isEvent) {
      if (G.age < e.age[0] || G.age > e.age[1]) return false;
    } else if (e.age !== G.age) return false;
    if (e.require && !e.require.every((f) => G.flags.has(f))) return false;
    return true;
  });
}

function weightedPick(list) {
  const total = list.reduce((s, e) => s + (e.weight || 1), 0);
  let t = G.rng() * total;
  for (const e of list) {
    t -= e.weight || 1;
    if (t <= 0) return e;
  }
  return list[list.length - 1];
}

function fillText(t) {
  return t
    .replace("{place}", `ตำบล${G.subdistrict} จังหวัด${G.province.name}`)
    .replace("{partner}", G.partner);
}

function tick() {
  if (!G.alive || G.pending) return;

  // ทอยความตายของ "ปีที่เพิ่งใช้ไป" ก่อนขึ้นอายุ — ไม่งั้นช่วงอายุ 0 ปีจะไม่ถูกใช้เลย
  // (อัตราตายทารกเป็นค่าจริงจาก Yearbook ตาราง 1.15 จึงต้องมีผลจริง)
  if (G.rng() < deathChance()) { die(); render(); return; }

  G.age += 1;
  yearlyDrift();
  wealthDrift();

  // หมุดเหตุการณ์ของปีนี้
  const ms = eligible(MILESTONES, false);
  if (ms.length && G.rng() < 0.8) {
    const m = weightedPick(ms);
    G.used.add(m.id);
    applyEffect(m.effect);
    (m.flag || []).forEach((f) => G.flags.add(f));
    addLog(fillText(m.text), m.tone, m.stat);
  }

  // การ์ดตัดสินใจ — ไม่เกินปีละใบ
  const evs = eligible(EVENTS, true);
  if (evs.length && G.rng() < 0.35) {
    G.pending = weightedPick(evs);
    render();
    if (G.auto) scheduleAutoChoice();
    return;
  }

  render();
}

function choose(idx) {
  const ev = G.pending;
  if (!ev) return;
  clearTimeout(G.autoTimer);
  const opt = ev.options[idx];
  G.used.add(ev.id);
  applyEffect(opt.effect);
  (opt.flag || []).forEach((f) => G.flags.add(f));
  const good = Object.values(opt.effect || {}).reduce((a, b) => a + b, 0) >= 0;
  addLog(good ? ev.log.good : ev.log.bad, good ? "good" : "bad", ev.stat);
  addLog(`${ev.title} · การตัดสินใจ: ${opt.label}`, "sub", null);
  G.pending = null;
  render();
}

function scheduleAutoChoice() {
  // เลือกตัวเลือกที่ดีต่อสถานะรวมที่สุด — เลียนแบบปุ่ม "ให้ตัดสินใจอัตโนมัติ" ของต้นแบบ
  const ev = G.pending;
  let best = 0, bestScore = -Infinity;
  ev.options.forEach((o, i) => {
    if (!canAfford(o.money)) return;
    const s = Object.values(o.effect || {}).reduce((a, b) => a + b, 0);
    if (s > bestScore) { bestScore = s; best = i; }
  });
  G.autoTimer = setTimeout(() => choose(best), 2200);
}

function die() {
  G.alive = false;
  clearInterval(G.timer);
  addLog(`${G.name} จากไปเมื่ออายุ ${G.age} ปี`, "bad", null);
  renderEnding();
}

// ---------- การแสดงผล ----------
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function statBoxHtml(stat) {
  if (!stat) return "";
  const badges =
    (stat.warn ? '<span class="warnbadge">ค่าน่าสงสัย — ยังไม่ยืนยันกับหน่วยงาน</span>' : "") +
    (stat.draft ? '<span class="draft">ยังไม่ยืนยัน</span>' : "");
  const warnLine = stat.warn && stat.warn_text ? `<span class="warntext">${esc(stat.warn_text)}</span>` : "";
  return `<div class="statbox">${badges}${esc(stat.text)}<span class="cite">${esc(stat.cite || "")}</span>${warnLine}</div>`;
}

// ---------- ตัวการ์ตูน chibi แสดงสถานะ (ตัวอย่างล้วน วาดด้วย SVG ไม่ใช้รูปนอก) ----------
const WEALTH_COLORS = ["#6b5c4f", "#7a6a52", "#5f7a6e", "#2c7a7b", "#c9a227"];
function lerpColor(hexA, hexB, t) {
  const a = [1, 3, 5].map((i) => parseInt(hexA.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(hexB.slice(i, i + 2), 16));
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * Math.max(0, Math.min(1, t))));
  return `rgb(${c.join(",")})`;
}
function renderChibi() {
  const box = $("chibi");
  if (!box) return;
  const phys = G.stats.phys ?? 70, mind = G.stats.mind ?? 70, env = G.stats.env ?? 55;
  const mood = (phys + mind) / 2;

  $("chibi-aura").setAttribute("fill", lerpColor("#9b2c2c", "#48bb78", env / 100));
  $("chibi-body-shape").setAttribute("fill", WEALTH_COLORS[G.wealth ?? 2]);

  const mouth = mood >= 60
    ? "M 50 52 Q 60 60 70 52"
    : mood >= 38
      ? "M 50 54 Q 60 54 70 54"
      : "M 50 56 Q 60 49 70 56";
  $("chibi-mouth").setAttribute("d", mouth);

  box.classList.toggle("low-phys", phys < 35);
  box.classList.toggle("good-mood", mood >= 60);
  box.classList.toggle("bad-mood", mood < 38);

  const moodWord = mood >= 60 ? "ร่าเริงแข็งแรง" : mood >= 38 ? "เรื่อย ๆ" : "เหนื่อยล้า";
  const tier = WEALTH.tiers[G.wealth ?? 2];
  $("chibi-caption").innerHTML = `<b>${esc(moodWord)}</b>ฐานะ: ${esc(tier.label)}`;
}

function renderStageTrack() {
  const box = $("stagetrack");
  if (!box) return;
  box.innerHTML = STAGES.map((s) => {
    const on = G.age >= s.from && G.age <= s.to;
    return `<div class="stage${on ? " on" : ""}" data-from="${s.from}">${esc(s.label)}</div>`;
  }).join("");
  box.querySelectorAll(".stage").forEach((el) =>
    el.addEventListener("click", () => {
      const from = Number(el.dataset.from);
      const target = [...$("log").children].reverse().find((row) =>
        Number(row.querySelector(".la").textContent.replace(/\D/g, "")) >= from);
      (target || $("log").lastElementChild)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }));
}

function renderBirthCard() {
  const box = $("birthcard");
  const sexLabel = G.sex === "male" ? "เด็กชาย" : "เด็กหญิง";
  const tier = WEALTH.tiers[G.wealth];
  const rarity = rarityOneIn();
  box.innerHTML = `
    <div class="chead">ลิขิตฟ้า ณ วันเกิด</div>
    <h2>${esc(G.name)}</h2>
    <div class="birthrow"><span>เกิดเป็น</span><span>${esc(sexLabel)}</span></div>
    <div class="birthrow"><span>ที่อยู่</span><span>ตำบล${esc(G.subdistrict)} จังหวัด${esc(G.province.name)}</span></div>
    <div class="birthrow"><span>ฐานะครอบครัวแรกเกิด</span><span>${esc(tier.label)}</span></div>
    <div class="fortunebox"><span class="tag">นิทานพื้นบ้านดาวอาสตร้า — เรื่องเล่าเล่น ๆ ไม่ใช่โหราศาสตร์ไทย</span>${esc(pick(G.rng, FORTUNES))}</div>
    ${rarity ? `<div class="raritybox">โอกาสเกิดเป็นแบบนี้ (เพศ · พื้นที่ · ฐานะ) ประมาณ <b>1 ใน ${rarity.toLocaleString("th-TH")}</b></div>` : ""}
    <div class="erow">
      <button class="big" id="confirmbtn">เริ่มใช้ชีวิต</button>
      <button id="rerollbtn">สุ่มใหม่</button>
    </div>`;
  $("confirmbtn").addEventListener("click", confirmLife);
  $("rerollbtn").addEventListener("click", rerollBirth);
}

function confirmLife() {
  $("birthcard").hidden = true;
  $("hdr").hidden = false;
  render();
  setSpeed(4);
}

function rerollBirth() {
  newLife(Date.now() + Math.floor(Math.random() * 1e6));
  renderBirthCard();
}

function render() {
  $("age").textContent = G.age;
  renderStageTrack();
  const tier = WEALTH.tiers[G.wealth];
  $("who").textContent = `${G.name} · ตำบล${G.subdistrict} จังหวัด${G.province.name}`;
  $("wealth").innerHTML =
    `<b>ฐานะครอบครัว:</b> ${esc(tier.label)} <em>${esc(tier.detail)}</em>` +
    (WEALTH.verified ? "" : ' <span class="draft">ยังไม่ยืนยัน</span>');

  renderChibi();

  $("bars").innerHTML = W.stats.map((s) => `
    <div class="bar">
      <span class="bl">${esc(s.label)}</span>
      <b>${Math.round(G.stats[s.id])}</b>
      <i style="width:${Math.round(G.stats[s.id])}%;background:${s.color}"></i>
    </div>`).join("");

  $("log").innerHTML = G.log.map((l) => `
    <div class="le ${l.tone}">
      <span class="la">อายุ ${l.age}</span>
      <div><div class="lt">${esc(l.text)}</div>${statBoxHtml(l.stat)}</div>
    </div>`).join("");

  const card = $("card");
  if (!G.pending) { card.hidden = true; return; }
  const ev = G.pending;
  card.hidden = false;
  card.innerHTML = `
    <div class="chead">การตัดสินใจครั้งสำคัญ · อายุ ${G.age} ปี</div>
    <h2>${esc(ev.title)}</h2>
    <p>${esc(ev.body)}</p>
    ${statBoxHtml(ev.stat)}
    <div class="opts">${ev.options.map((o, i) => {
      const ok = canAfford(o.money);
      return `<button class="opt" data-i="${i}"${ok ? "" : " disabled"}>
        <span class="n">${i + 1}</span>
        <span><b>${esc(o.label)}</b><em>${ok ? esc(o.hint || "") : "เงินไม่พอในฐานะตอนนี้"}</em></span>
      </button>`;
    }).join("")}</div>
    ${ev.hotline ? `<div class="hot">ขอความช่วยเหลือได้: ${esc(ev.hotline)}</div>` : ""}
    <button class="autobtn">${G.auto ? "ปิดการตัดสินใจอัตโนมัติ" : "ให้ตัดสินใจอัตโนมัติตั้งแต่นี้ไป"}</button>`;
  card.querySelectorAll(".opt").forEach((b) =>
    b.addEventListener("click", () => choose(Number(b.dataset.i))));
  card.querySelector(".autobtn").addEventListener("click", () => {
    G.auto = !G.auto;
    if (G.auto) scheduleAutoChoice(); else clearTimeout(G.autoTimer);
    render();
  });
}

function renderEnding() {
  const good = G.log.filter((l) => l.tone === "good").length;
  $("ending").hidden = false;
  $("ending").innerHTML = `
    <h2>${esc(G.name)}</h2>
    <p class="years">ปีที่ ${2569} – ${2569 + G.age}</p>
    <p>เกิดที่ตำบล${esc(G.subdistrict)} จังหวัด${esc(G.province.name)} บนดาวอาสตร้า</p>
    <p>มีชีวิตอยู่ ${G.age} ปี หรือราว ${(G.age * 365).toLocaleString("th-TH")} วัน</p>
    <p class="sum">จบชีวิตในฐานะ "${esc(WEALTH.tiers[G.wealth].label)}" · ตลอดชีวิตมีเรื่องดี ${good} ครั้ง · ความรอบรู้สุขภาพปลายทาง ${Math.round(G.stats.lit)}</p>
    <label>เขียนความรู้สึกหลังได้ใช้ชีวิตนี้สักบรรทัด (ไม่บังคับ)
      <textarea id="refl" rows="2" placeholder="เช่น ดีใจที่กลับไปตรวจซ้ำตามนัดวันนั้น"></textarea></label>
    <div class="erow">
      <button id="copybtn">คัดลอกข้อความสำหรับแชร์</button>
      <button id="againbtn">เกิดใหม่อีกครั้ง</button>
    </div>
    <p class="disc">${esc(W.disclaimer.full)}</p>`;
  $("copybtn").addEventListener("click", copyShare);
  $("againbtn").addEventListener("click", () => location.reload());
}

function copyShare() {
  const refl = ($("refl").value || "").trim();
  const txt = [
    refl,
    `${G.name} · อายุ ${G.age} ปี · ตำบล${G.subdistrict} จังหวัด${G.province.name}`,
    `กาย ${Math.round(G.stats.phys)} · ใจ ${Math.round(G.stats.mind)} · ความรอบรู้สุขภาพ ${Math.round(G.stats.lit)} · สิ่งแวดล้อม ${Math.round(G.stats.env)}`,
    `1 ใน 66 ล้าน — ${W.disclaimer.short}`,
  ].filter(Boolean).join("\n");
  navigator.clipboard?.writeText(txt);
  $("copybtn").textContent = "คัดลอกแล้ว";
}

// ---------- ตัวควบคุม ----------
function setSpeed(mult) {
  G.speed = mult;
  clearInterval(G.timer);
  if (mult === 0) return;
  G.timer = setInterval(tick, 12000 / mult);
  document.querySelectorAll(".sp").forEach((b) =>
    b.classList.toggle("on", Number(b.dataset.s) === mult));
}

function start() {
  $("intro").hidden = true;
  newLife(Date.now());
  $("birthcard").hidden = false;
  renderBirthCard();
}

document.addEventListener("DOMContentLoaded", () => {
  $("disc-intro").textContent = W.disclaimer.full;
  $("startbtn").addEventListener("click", start);
  document.querySelectorAll(".sp").forEach((b) =>
    b.addEventListener("click", () => setSpeed(Number(b.dataset.s))));
  $("focus").innerHTML = Object.entries(FOCUS)
    .map(([k, v]) => `<option value="${k}">จุดเน้น: ${v.label}</option>`).join("");
  $("focus").addEventListener("change", (e) => (G.focus = e.target.value));
});
