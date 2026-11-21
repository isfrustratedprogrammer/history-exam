// Приложение: темы, интервальные карточки, гайд, случайный билет.
TOPICS.sort((a, b) => a.n - b.n);

const ERAS = {
  empire: ["Российская империя", "1894–1917"],
  revolution: ["Революция и Гражданская война", "1917–1922"],
  ussr20: ["СССР в 1920–1930-е", "1921–1939"],
  war: ["Вторая мировая война", "1939–1945"],
  postwar: ["СССР после войны", "1945–1985"],
  perestroika: ["Перестройка и распад СССР", "1985–1991"],
  russia: ["Новая Россия", "1991–2022"],
};
const KINDS = {
  q: { label: "Вопрос", hint: "Ответьте своими словами", code: "В" },
  a: { label: "План", hint: "Вспомните план ответа по билету", code: "П" },
  d: { label: "Дата", hint: "Назовите дату или период", code: "Д" },
  p: { label: "Личность", hint: "Кто это и чем важен в теме?", code: "Л" },
  t: { label: "Термин", hint: "Дайте определение", code: "Т" },
  s: { label: "Источник", hint: "Что это за документ и что он доказывает?", code: "И" },
};
const KIND_ORDER = ["q", "a", "d", "p", "t", "s"];
// До экзамена 4 дня: по умолчанию учим только вопросы и планы ответа, остальное по желанию
const CORE_KINDS = ["q", "a"];
const NEW_PER_DAY = 50;
const DAYS = [
  { from: 1, to: 9, title: "Империя, революции, СССР в 1920–1930-е" },
  { from: 10, to: 18, title: "Внешняя политика 1930-х, война, послевоенный СССР" },
  { from: 19, to: 26, title: "Культура и спорт СССР, перестройка, новая Россия" },
];

// Карточки собираются из данных тем
const CARDS = [];
for (const T of TOPICS) {
  T.ids = [];
  const add = (kind, list, toQA) => list.forEach((row, i) => {
    const [q, a] = toQA(row);
    const id = `${T.n}-${kind}${i}`;
    CARDS.push({ id, n: T.n, kind, i, q, a });
    T.ids.push(id);
  });
  add("q", T.cards, r => r);
  add("a", [T.plan], plan => [T.title, plan]);
  add("d", T.dates, ([d, e]) => [e, d]);
  add("p", T.people, r => r);
  add("t", T.terms, r => r);
  add("s", T.docs, r => r);
}
const CARD = Object.fromEntries(CARDS.map(c => [c.id, c]));
const CORE_COUNT = CARDS.filter(c => CORE_KINDS.includes(c.kind)).length;
const TOPIC = Object.fromEntries(TOPICS.map(t => [t.n, t]));
const pad = n => String(n).padStart(2, "0");

// ---------- Интервальное повторение (упрощённый алгоритм Anki) ----------
// Интервал не длиннее 2 дней, чтобы до экзамена каждая карточка успела вернуться.
const MIN = 60e3, HOUR = 36e5, DAY = 864e5, CUTOFF = 4 * HOUR, MAX_IVL = 2;
const LEARN = [1 * MIN, 10 * MIN], RELEARN = LEARN;

function studyDayStart(now) {
  const d = new Date(now - CUTOFF);
  d.setHours(0, 0, 0, 0);
  return d.getTime() + CUTOFF;
}
function studyDayKey(now) {
  const d = new Date(now - CUTOFF);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function toReview(st, ivl, now) {
  st.s = "r"; st.step = 0;
  st.ivl = Math.min(MAX_IVL, Math.max(1, Math.round(ivl)));
  st.due = studyDayStart(now) + st.ivl * DAY;
}
function schedule(prev, g, now) {
  const st = prev ? { ...prev } : { s: "n", step: 0, ivl: 0, e: 2.5, l: 0 };
  if (st.s === "n") st.s = "l";
  if (st.s === "l" || st.s === "rl") {
    const steps = st.s === "l" ? LEARN : RELEARN;
    if (g === 1) { st.step = 0; st.due = now + steps[0]; }
    else if (g === 2) {
      st.due = now + (st.step === 0 && steps.length > 1 ? Math.round((steps[0] + steps[1]) / 2) : steps[Math.min(st.step, steps.length - 1)]);
    } else if (g === 3) {
      st.step += 1;
      if (st.step >= steps.length) toReview(st, st.s === "l" ? 1 : st.ivl, now);
      else st.due = now + steps[st.step];
    } else toReview(st, st.s === "l" ? 4 : st.ivl + 1, now);
  } else {
    // Снова — заново через минуту; Трудно — ещё раз сегодня; Хорошо — завтра; Легко — через 2 дня
    st.ivl = 1;
    if (g === 1) { st.l += 1; st.s = "rl"; st.step = 0; st.due = now + RELEARN[0]; }
    else if (g === 2) { st.s = "rl"; st.step = 1; st.due = now + RELEARN[1]; }
    else toReview(st, g === 3 ? 1 : 2, now);
  }
  st.e = Math.round(st.e * 100) / 100;
  st.t = now;
  return st;
}
function intervalLabel(prev, g, now) {
  const n = schedule(prev, g, now);
  if (n.s === "r") return `${n.ivl} дн`;
  const m = Math.round((n.due - now) / MIN);
  return m < 1 ? "<1 мин" : `${m} мин`;
}

// ---------- Состояние и хранение ----------
const LS_KEY = "hist-exam-srs-v1";
const blank = () => ({
  v: 1, cards: {}, day: "", newToday: 0, extraToday: 0,
  settings: { v: 2, newPerDay: NEW_PER_DAY, deck: "all", kinds: CORE_KINDS.slice() }, settingsAt: 0,
});
let S = blank();
try {
  const raw = localStorage.getItem(LS_KEY);
  if (raw) S = Object.assign(blank(), JSON.parse(raw));
} catch (e) { /* хранилище недоступно — работаем в памяти */ }
// Настройки первой версии были рассчитаны на все 764 карточки — заменяем их новыми
if (!S.settings || S.settings.v !== 2) { S.settings = blank().settings; S.settingsAt = Date.now(); }
S.settings = Object.assign(blank().settings, S.settings);

function rollDay() {
  const k = studyDayKey(Date.now());
  if (S.day !== k) { S.day = k; S.newToday = 0; S.extraToday = 0; }
}
rollDay();

function saveLocal() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) { /* нет доступа */ }
}
function save() { saveLocal(); schedulePush(); }

// Синхронизация через хранилище артефакта (если страница открыта на claude.ai)
let docRef = null, pushTimer = null, pushing = false, pushAgain = false, syncState = "connecting";
const SYNC_TEXT = {
  connecting: "Подключаю синхронизацию…",
  cloud: "Прогресс сохраняется в аккаунте и доступен на других устройствах",
  local: "Прогресс хранится в этом браузере",
  slow: "Хранилище не отвечает — прогресс пока сохраняется в этом браузере",
  readonly: "Нет прав на запись — прогресс сохраняется в этом браузере",
  error: "Не удалось сохранить в аккаунт, повторю при следующей оценке",
};
function setSync(s) {
  syncState = s;
  document.querySelectorAll("[data-sync]").forEach(el => { el.dataset.s = s; el.textContent = SYNC_TEXT[s]; });
}
function merge(remote) {
  if (!remote || typeof remote !== "object") return { changed: false, needPush: true };
  let changed = false, needPush = false;
  const rc = remote.cards || {};
  for (const id of Object.keys(rc)) {
    const l = S.cards[id], r = rc[id];
    if (!l || (r.t || 0) > (l.t || 0)) { S.cards[id] = r; changed = true; }
  }
  for (const id of Object.keys(S.cards)) {
    if (!rc[id] || (S.cards[id].t || 0) > (rc[id].t || 0)) needPush = true;
  }
  if (remote.day === S.day) {
    if ((remote.newToday || 0) !== S.newToday || (remote.extraToday || 0) !== S.extraToday) needPush = true;
    S.newToday = Math.max(S.newToday, remote.newToday || 0);
    S.extraToday = Math.max(S.extraToday, remote.extraToday || 0);
  }
  const rs = remote.settings && remote.settings.v === 2 ? remote : { settingsAt: 0 };
  if ((rs.settingsAt || 0) > (S.settingsAt || 0)) {
    S.settings = Object.assign(blank().settings, rs.settings); S.settingsAt = rs.settingsAt; changed = true;
  } else if ((S.settingsAt || 0) > (rs.settingsAt || 0)) needPush = true;
  return { changed, needPush };
}
function schedulePush() {
  if (!docRef) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 1200);
}
async function push() {
  pushTimer = null;
  if (!docRef) return;
  if (pushing) { pushAgain = true; return; }
  pushing = true;
  try {
    await docRef.set(JSON.parse(JSON.stringify(S)));
    setSync("cloud");
  } catch (e) {
    if (e && e.code === "invalid_argument") { docRef = null; setSync("readonly"); }
    else setSync("error");
  }
  pushing = false;
  if (pushAgain) { pushAgain = false; push(); }
}
async function pull() {
  if (!docRef) return;
  try {
    const snap = await docRef.get();
    rollDay();
    const { changed, needPush } = merge(snap.exists ? snap.data() : null);
    saveLocal();
    if (changed) render();
    if (needPush) push(); else setSync("cloud");
  } catch (e) { setSync("error"); }
}
async function initSync() {
  if (!window.claude || typeof window.claude.use !== "function") { setSync("local"); return; }
  const slow = setTimeout(() => { if (syncState === "connecting") setSync("slow"); }, 10000);
  try {
    const [db, user] = await Promise.all([window.claude.use("db"), window.claude.use("user")]);
    const uid = db && user ? await user.id() : null;
    if (!uid) { clearTimeout(slow); setSync("local"); return; }
    docRef = db.doc(`data/users/${uid}/srs`);
    await pull();
  } catch (e) { setSync("local"); }
  clearTimeout(slow);
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && pushTimer) { clearTimeout(pushTimer); push(); }
  if (document.visibilityState === "visible") { rollDay(); pull(); }
});

// ---------- Колода и очередь ----------
function inDeck(c) {
  const d = S.settings.deck;
  if (!S.settings.kinds.includes(c.kind)) return false;
  if (d === "all") return true;
  if (d.startsWith("era:")) return TOPIC[c.n].era === d.slice(4);
  if (d.startsWith("t:")) return c.n === +d.slice(2);
  return true;
}
function newLimitLeft() {
  return Math.max(0, S.settings.newPerDay + S.extraToday - S.newToday);
}
function queue(now) {
  const learn = [], learnSoon = [], review = [], fresh = [];
  for (const c of CARDS) {
    if (!inDeck(c)) continue;
    const st = S.cards[c.id];
    if (!st || st.s === "n") fresh.push(c);
    else if (st.s === "r") { if (st.due <= now) review.push(c); }
    else if (st.due <= now) learn.push(c);
    else if (st.due <= now + 20 * MIN) learnSoon.push(c);
  }
  const byDue = (a, b) => S.cards[a.id].due - S.cards[b.id].due;
  learn.sort(byDue); learnSoon.sort(byDue); review.sort(byDue);
  return { learn, learnSoon, review, fresh: fresh.slice(0, newLimitLeft()), freshAll: fresh.length };
}
let shown = 0;
function pickNext(now) {
  const q = queue(now);
  if (q.learn.length) return q.learn[0];
  if (q.review.length && (!q.fresh.length || shown % 4 !== 3)) return q.review[0];
  if (q.fresh.length) return q.fresh[0];
  if (q.review.length) return q.review[0];
  if (q.learnSoon.length) return q.learnSoon[0];
  return null;
}
function topicProgress(T) {
  let learned = 0, total = 0;
  for (const id of T.ids) {
    if (!S.settings.kinds.includes(CARD[id].kind)) continue;
    total++;
    const st = S.cards[id]; if (st && st.s === "r") learned++;
  }
  return { learned, total };
}

// ---------- Отрисовка ----------
const $ = s => document.querySelector(s);
const main = $("#main"), rail = $("#rail"), shell = $("#shell");
let view = "topics", topicN = 0, current = null, revealed = false, confirmReset = false;

function eraGroups() {
  const out = [];
  for (const T of TOPICS) {
    const last = out[out.length - 1];
    if (last && last.era === T.era) last.items.push(T); else out.push({ era: T.era, items: [T] });
  }
  return out;
}
function listHTML(active) {
  return eraGroups().map(g => `
    <section class="era">
      <div class="era-h"><span class="lbl">${ERAS[g.era][0]}</span><span class="mono">${ERAS[g.era][1]}</span></div>
      ${g.items.map(T => {
        const p = topicProgress(T);
        return `<a class="ti" href="#t-${T.n}"${T.n === active ? ' aria-current="page"' : ""}>
          <span class="num">${pad(T.n)}</span><span class="tt">${T.short}</span>
          <span class="pr"><span class="bar"><i style="width:${Math.round(100 * p.learned / p.total)}%"></i></span><span class="mono">${p.learned}/${p.total}</span></span>
        </a>`;
      }).join("")}
    </section>`).join("");
}
function overallStats() {
  const now = Date.now();
  let learned = 0, started = 0, due = 0, fresh = 0;
  for (const c of CARDS) {
    if (!S.settings.kinds.includes(c.kind)) continue;
    const st = S.cards[c.id];
    if (!st || st.s === "n") { fresh++; continue; }
    started++;
    if (st.s === "r") learned++;
    if (st.due <= now) due++;
  }
  return { today: Math.min(fresh, newLimitLeft()), learned, started, due };
}
function planHTML() {
  const stats = DAYS.map(D => {
    let total = 0, seen = 0;
    for (const c of CARDS) {
      if (c.n < D.from || c.n > D.to || !S.settings.kinds.includes(c.kind)) continue;
      total++;
      const st = S.cards[c.id]; if (st && st.s !== "n") seen++;
    }
    return { total, seen };
  });
  let cur = stats.findIndex(s => s.seen < s.total);
  if (cur < 0) cur = DAYS.length;
  const day = (i, head, body) => `<li${i === cur ? ' class="now"' : ""}><div><b>${head}</b>${i === cur ? ' <span class="stamp">сейчас</span>' : ""}<p>${body}</p></div></li>`;
  return `<ol class="steps days">
    ${DAYS.map((D, i) => day(i, `День ${i + 1} · темы ${pad(D.from)}–${pad(D.to)}`,
      `${D.title}. Теория ${D.to - D.from + 1} тем, затем их карточки и повторы. Вечером — два случайных билета вслух.
       <span class="meta">Карточек пройдено: ${stats[i].seen} из ${stats[i].total}</span>`)).join("")}
    ${day(DAYS.length, "День 4 · повторение",
      "Новых карточек нет, только повторы. Затем 5–6 случайных билетов вслух на время; по слабым темам перечитайте «Суть» и «План ответа». Вечером выспитесь: память закрепляется во сне.")}
  </ol>`;
}
function critTable() {
  return `<div class="table-wrap"><table class="crit-table">
    <thead><tr><th>Критерий оценки</th><th>Баллы</th><th>Что показать в ответе</th></tr></thead>
    <tbody>
      <tr><td>1. Источники информации и ресурсы для решения задач</td><td class="pts">0–2</td><td>Назвать, откуда мы это знаем: документы, статистика, мемуары, труды историков. Блок «Документы и источники» в каждой теме.</td></tr>
      <tr><td>2. Место и роль России в мировой истории, системные знания</td><td class="pts">0–4</td><td>Причины → ход → итоги с датами и именами, связь с мировыми процессами. «План ответа» и блок «Россия в мировой истории».</td></tr>
      <tr><td>3. Анализ документов, работа с историческими источниками</td><td class="pts">0–4</td><td>Сказать, что за документ, кто и зачем его создал, что он доказывает и чему в нём можно доверять.</td></tr>
    </tbody></table></div>`;
}
function renderOverview() {
  const s = overallStats();
  const last = (() => { try { return +localStorage.getItem("hist-exam-last") || 0; } catch (e) { return 0; } })();
  main.innerHTML = `
    <section class="hero">
      <span class="stamp">Устный экзамен · билет из 2 вопросов</span>
      <h1>Подготовка к экзамену по истории России</h1>
      <p class="lead">26 тем от рубежа XIX–XX веков до 2022 года. В каждой — суть, план ответа на 3–5 минут, теория, документы и место России в мире. Подготовка рассчитана на 4 дня: три дня по 8–9 тем с карточками, четвёртый — повторение и пробные билеты.</p>
      <div class="row">
        <a class="btn primary" href="#cards">Учить карточки</a>
        ${last && TOPIC[last] ? `<a class="btn" href="#t-${last}">Продолжить: тема ${pad(last)}</a>` : `<a class="btn" href="#t-1">Начать с темы 01</a>`}
        <button class="btn" type="button" data-ticket>Случайный билет</button>
        <a class="btn quiet" href="#guide">Как готовиться →</a>
      </div>
    </section>
    <h2 class="sec">План на 4 дня</h2>
    ${planHTML()}
    <div class="stats">
      <div><span class="lbl">Новых на сегодня</span><b>${s.today}</b></div>
      <div><span class="lbl">Начато</span><b>${s.started}</b></div>
      <div><span class="lbl">Выучено</span><b>${s.learned}</b></div>
      <div><span class="lbl">К повтору сейчас</span><b>${s.due}</b></div>
    </div>
    <h2 class="sec">Как оценивают ответ (максимум 10 баллов)</h2>
    ${critTable()}
    <div class="inline-list"><h2 class="sec">Темы</h2>${listHTML(0)}</div>`;
}
function renderTopic(T) {
  try { localStorage.setItem("hist-exam-last", String(T.n)); } catch (e) { /* нет доступа */ }
  const prev = TOPIC[T.n - 1], next = TOPIC[T.n + 1];
  const p = topicProgress(T);
  main.innerHTML = `
    <article class="topic">
      <a class="btn quiet back" href="#topics">← Все темы</a>
      <div class="eyebrow"><span class="stamp">Тема № ${pad(T.n)}</span><span class="mono">${T.years}</span><span>${ERAS[T.era][0]}</span></div>
      <h1>${T.short}</h1>
      <p class="official"><span class="lbl">В билете:</span>${T.title}</p>
      <section class="panel gist"><span class="lbl">Суть за 30 секунд</span><p>${T.gist}</p></section>
      <section class="panel plan"><span class="lbl">План ответа на 3–5 минут</span><ol>${T.plan.map(x => `<li>${x}</li>`).join("")}</ol></section>
      <div class="body">${T.body}</div>
      <section class="block"><h2 class="lbl">Хронология</h2>
        <ol class="timeline">${T.dates.map(([d, e]) => `<li><span class="d">${d}</span><span>${e}</span></li>`).join("")}</ol></section>
      <div class="two">
        <section class="block"><h2 class="lbl">Личности</h2><dl class="defs">${T.people.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join("")}</dl></section>
        <section class="block"><h2 class="lbl">Термины</h2><dl class="defs">${T.terms.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join("")}</dl></section>
      </div>
      <section class="block docs"><h2 class="lbl">Документы и источники <span class="crit">критерии 1 и 3</span></h2>
        <ul>${T.docs.map(([a, b]) => `<li><b>${a}</b>${b}</li>`).join("")}</ul></section>
      <section class="block world"><h2 class="lbl">Россия в мировой истории <span class="crit">критерий 2</span></h2>
        <div class="panel"><p>${T.world}</p></div></section>
      <div class="topic-cta">
        <button class="btn primary" type="button" data-study="${T.n}">Учить карточки темы · ${p.total}</button>
        <div class="row">
          ${prev ? `<a class="btn quiet" href="#t-${prev.n}">← ${pad(prev.n)}</a>` : ""}
          ${next ? `<a class="btn" href="#t-${next.n}">Тема ${pad(next.n)} →</a>` : ""}
        </div>
      </div>
    </article>`;
}

function deckOptions() {
  const d = S.settings.deck;
  const opt = (v, label) => `<option value="${v}"${v === d ? " selected" : ""}>${label}</option>`;
  let html = opt("all", "Все темы");
  html += `<optgroup label="Эпохи">${Object.entries(ERAS).map(([k, v]) => opt(`era:${k}`, `${v[0]} (${v[1]})`)).join("")}</optgroup>`;
  html += `<optgroup label="Темы">${TOPICS.map(T => opt(`t:${T.n}`, `${pad(T.n)}. ${T.short}`)).join("")}</optgroup>`;
  return html;
}
function nextDueText(now) {
  let soonest = Infinity;
  for (const c of CARDS) {
    if (!inDeck(c)) continue;
    const st = S.cards[c.id];
    if (st && st.s !== "n" && st.due > now) soonest = Math.min(soonest, st.due);
  }
  if (soonest === Infinity) return "";
  const diff = soonest - now;
  if (diff < HOUR) return `Следующая карточка через ${Math.max(1, Math.round(diff / MIN))} мин.`;
  if (diff < DAY) return `Следующая карточка через ${Math.round(diff / HOUR)} ч.`;
  return `Следующее повторение через ${Math.round(diff / DAY)} дн.`;
}
function renderStudy() {
  rollDay();
  const now = Date.now();
  const q = queue(now);
  if (!current || !inDeck(current)) { current = pickNext(now); revealed = false; }
  const st = current ? S.cards[current.id] : null;
  const T = current ? TOPIC[current.n] : null;
  const K = current ? KINDS[current.kind] : null;
  const learnCount = q.learn.length + q.learnSoon.length;
  const deckTopic = S.settings.deck.startsWith("t:") ? +S.settings.deck.slice(2) : 0;

  let cardHTML;
  if (current) {
    const code = `№ ${pad(current.n)}-${K.code}-${pad(current.i + 1)}`;
    cardHTML = `
      <div class="fcard">
        <div class="fc-head"><span class="lbl">Тема ${current.n} · ${T.short}</span><span class="mono">${code}</span></div>
        <div class="fc-body">
          <span class="lbl">${K.label} · ${K.hint}</span>
          <p class="q">${current.q}</p>
          <div class="ans"${revealed ? "" : " hidden"}><div class="divider"><span class="lbl">Ответ</span></div>${Array.isArray(current.a) ? `<ol>${current.a.map(x => `<li>${x}</li>`).join("")}</ol>` : `<p>${current.a}</p>`}</div>
        </div>
        <span class="hole" aria-hidden="true"></span>
      </div>
      <div class="actions">
        ${revealed ? `<div class="grades">
          ${[["Снова", 1], ["Трудно", 2], ["Хорошо", 3], ["Легко", 4]].map(([l, g]) => `<button class="grade" type="button" data-g="${g}">${l}<small>${intervalLabel(st, g, now)}</small></button>`).join("")}
        </div>` : `<button class="btn primary wide" type="button" id="reveal">Показать ответ <kbd>Пробел</kbd></button>`}
      </div>`;
  } else {
    const more = q.freshAll > 0;
    cardHTML = `
      <div class="fcard"><div class="fc-head"><span class="lbl">Колода пройдена</span><span class="mono">${studyDayKey(now)}</span></div>
        <div class="done">
          <h2>На сегодня всё</h2>
          <p>${nextDueText(now) || "В этой колоде карточек к повтору нет."} ${more ? `Новых карточек в колоде ещё ${q.freshAll}.` : ""}</p>
          <div class="row">
            ${more ? `<button class="btn primary" type="button" id="moreNew">Ещё 10 новых сегодня</button>` : ""}
            ${deckTopic ? `<a class="btn" href="#t-${deckTopic}">Теория темы ${pad(deckTopic)}</a>` : `<a class="btn" href="#topics">К темам</a>`}
          </div>
        </div>
        <span class="hole" aria-hidden="true"></span>
      </div>`;
  }

  main.innerHTML = `
    <section class="study">
      <div class="deckbar">
        <label class="lbl" for="deck">Колода</label>
        <select id="deck">${deckOptions()}</select>
      </div>
      <div class="kinds" role="group" aria-label="Типы карточек">
        ${KIND_ORDER.map(k => `<button class="chip" type="button" data-kind="${k}" aria-pressed="${S.settings.kinds.includes(k)}">${KINDS[k].label}</button>`).join("")}
      </div>
      <div class="counters">
        <div class="c-new"><span class="lbl">Новые</span><b>${q.fresh.length}</b></div>
        <div class="c-learn"><span class="lbl">Учу</span><b>${learnCount}</b></div>
        <div class="c-due"><span class="lbl">Повтор</span><b>${q.review.length}</b></div>
      </div>
      ${cardHTML}
      <div class="fc-foot">
        <span class="sync" data-sync></span>
        ${current ? `<a href="#t-${current.n}">Теория темы ${pad(current.n)}</a>` : ""}
      </div>
      <details class="settings" id="settings">
        <summary>Настройки карточек</summary>
        <div class="set-row"><label for="npd">Новых карточек в день</label><input id="npd" type="number" min="0" max="300" step="5" value="${S.settings.newPerDay}"><span class="note">Сегодня уже взято новых: ${S.newToday}</span></div>
        <div class="set-row">
          ${confirmReset
            ? `<span>Весь прогресс карточек будет удалён на всех устройствах.</span><button class="btn danger" type="button" id="resetYes">Да, сбросить</button><button class="btn" type="button" id="resetNo">Отмена</button>`
            : `<button class="btn danger" type="button" id="reset">Сбросить прогресс</button>`}
        </div>
        <p class="note">Горячие клавиши: <kbd>Пробел</kbd> — показать ответ, затем «Хорошо»; <kbd>1</kbd>–<kbd>4</kbd> — оценки.</p>
      </details>
    </section>`;
  setSync(syncState);
  if (confirmReset) $("#settings").open = true;
}
function grade(g) {
  if (!current || !revealed) return;
  const now = Date.now();
  rollDay();
  const prev = S.cards[current.id];
  if (!prev || prev.s === "n") S.newToday += 1;
  S.cards[current.id] = schedule(prev, g, now);
  shown += 1;
  save();
  current = pickNext(Date.now());
  revealed = false;
  renderStudy();
}

function guideHTML() {
  return `
  <article class="guide">
    <span class="stamp">Как учить</span>
    <h1>Как готовиться по этой странице</h1>
    <p>Экзамен устный: вы тянете случайный билет с двумя вопросами из 26 тем и отвечаете преподавателю. Готовиться нужно к любой паре тем, поэтому работают две вещи: понимание логики каждой темы и регулярное повторение фактов. Для первого есть теория и план ответа, для второго — карточки.</p>

    <h2>Как оценивают ответ</h2>
    ${critTable()}
    <p>Самая частая потеря баллов — ответ без источников. Даже хорошо рассказанная тема без упоминания документов теряет баллы по критериям 1 и 3. Поэтому в каждой теме есть блок «Документы и источники»: назовите хотя бы два документа и скажите, что они доказывают.</p>

    <h2>Как построить устный ответ</h2>
    <ol class="steps">
      <li><div><b>Рамки и суть (30 секунд).</b> Годы, эпоха и одна фраза о главном. Возьмите её из блока «Суть за 30 секунд».</div></li>
      <li><div><b>Причины и предпосылки.</b> Две-три причины, лучше разного рода: экономические, политические, внешние.</div></li>
      <li><div><b>Ход событий.</b> Этапы с датами и именами из «Хронологии» и «Личностей». Даты называйте точно, а если не уверены — хотя бы год.</div></li>
      <li><div><b>Документы.</b> «Об этом говорит…» — название документа, кто и зачем его создал, что он показывает. Для мемуаров добавьте, почему им нельзя доверять полностью.</div></li>
      <li><div><b>Итоги и значение.</b> Что изменилось для страны: плюсы и цена.</div></li>
      <li><div><b>Россия в мире.</b> Одна-две фразы, как событие связано с мировыми процессами (блок «Россия в мировой истории»).</div></li>
      <li><div><b>Оценки.</b> Если тема спорная (пакт 1939 г., коллективизация, распад СССР), покажите две точки зрения — это признак системного знания.</div></li>
    </ol>

    <h2>Как работают карточки</h2>
    <p>Карточки устроены по принципу интервального повторения, как в Anki: программа возвращает карточку, когда вы вот-вот её забудете, и время уходит только на то, что вы ещё не знаете. В обычном Anki интервалы растут до недель и месяцев, но до экзамена 4 дня, поэтому здесь интервал не больше двух дней. Новая карточка возвращается через минуту, через десять минут и на следующий день, так что до экзамена каждая успеет вернуться несколько раз.</p>
    <ol>
      <li>Прочитайте вопрос и <b>ответьте вслух или про себя до того, как откроете ответ</b>. Узнать ответ после показа ≠ вспомнить его.</li>
      <li>Нажмите «Показать ответ» и честно оцените себя:</li>
    </ol>
    <div class="table-wrap"><table class="gtable">
      <thead><tr><th>Кнопка</th><th>Когда нажимать</th><th>Что произойдёт</th></tr></thead>
      <tbody>
        <tr><td style="color:var(--again)">Снова</td><td>Не вспомнили или ошиблись в главном</td><td>Вернётся через минуту и пройдёт шаги заново</td></tr>
        <tr><td style="color:var(--hard)">Трудно</td><td>Вспомнили с большим трудом или частично</td><td>Ещё раз сегодня, через 6–10 минут</td></tr>
        <tr><td style="color:var(--accent)">Хорошо</td><td>Вспомнили правильно, немного подумав</td><td>Следующий шаг, а после шагов — завтра. Основная кнопка</td></tr>
        <tr><td style="color:var(--easy)">Легко</td><td>Ответ пришёл мгновенно</td><td>Вернётся через 2 дня</td></tr>
      </tbody></table></div>
    <p>Под каждой кнопкой написано, когда карточка появится снова. Если вспомнили наполовину, жмите «Трудно», а не «Хорошо»: завышенная оценка — главная причина, по которой повторение перестаёт работать.</p>
    <p><b>Типы карточек.</b> По умолчанию включены два типа: «Вопрос» — причины, итоги, сравнения, и «План» — по формулировке билета вспомнить план ответа. Это ${CORE_COUNT} карточек, по 5–6 на тему: столько реально выучить за 4 дня. Типы «Дата», «Личность», «Термин» и «Источник» включайте кнопками над счётчиками, только если останется время. Те же даты, имена и документы есть на странице каждой темы.</p>
    <p><b>Колода.</b> Можно учить всё сразу (новые карточки идут по порядку тем), одну эпоху или одну тему — например, сразу после чтения её теории. Кнопка «Учить карточки темы» внизу каждой темы открывает именно её.</p>
    <p><b>Лимит новых.</b> ${NEW_PER_DAY} новых карточек в день — это как раз темы одного дня плана, около часа вместе с повторениями. Новые идут по порядку тем, так что за три дня пройдут все ${CORE_COUNT}, а четвёртый день останется на повторение. Если начали на день позже, поднимите лимит в настройках или нажмите «Ещё 10 новых сегодня».</p>
    <p><b>Счётчики.</b> «Новые» — сколько новых осталось на сегодня, «Учу» — карточки на коротких шагах (минуты), «Повтор» — карточки, у которых подошёл срок повторения.</p>
    <p><b>Прогресс.</b> Если страница открыта на claude.ai, прогресс сохраняется в вашем аккаунте и одинаков на компьютере и телефоне. В остальных случаях он хранится в браузере. Строка под карточкой показывает, где он сейчас.</p>
    <p><b>Клавиши.</b> <kbd>Пробел</kbd> — показать ответ, повторное нажатие — «Хорошо»; <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd> — оценки.</p>

    <h2>План на 4 дня</h2>
    ${planHTML()}
    <p><b>Как проходить тему.</b> Прочитайте «Суть» и «План ответа», затем теорию. Закройте страницу и расскажите тему вслух по плану за 2–3 минуты, потом откройте её карточки. На тему уходит 15–20 минут, на весь день — около 3–4 часов вместе с карточками и билетами.</p>
    <p><b>Случайный билет</b> выдаёт две темы, как на экзамене. Отвечайте вслух на время, 3–5 минут на вопрос, потом сверьтесь со спрятанным планом. В первые дни берите билеты из уже пройденных тем: если выпала непройденная, вытяните другой.</p>
    <p class="note">Отметка «сейчас» ставится по пройденным карточкам, а не по календарю: начали позже или ушли вперёд — план подстроится.</p>

    <h2>Типичные ошибки</h2>
    <ul>
      <li>Перечитывать теорию вместо того, чтобы вспоминать. Чтение создаёт ощущение знания, а вспоминание — само знание.</li>
      <li>Оставлять темы на последний вечер: четвёртый день нужен для повторения, а не для нового.</li>
      <li>Отвечать без дат, имён и документов — ответ получается «общими словами».</li>
      <li>Нажимать «Хорошо», когда ответ вспомнился лишь частично.</li>
    </ul>
    <p class="note">Теория написана по общепринятым фактам курса отечественной истории. Если преподаватель давал свои материалы или акценты, сверяйтесь с ними: при расхождении приоритет у материалов курса.</p>
    <div class="row" style="margin-top:24px"><a class="btn primary" href="#cards">Перейти к карточкам</a><a class="btn" href="#t-1">Открыть тему 01</a></div>
  </article>`;
}

function setTabs() {
  const tab = view === "topic" ? "topics" : view;
  document.querySelectorAll("[data-tab]").forEach(a => {
    if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
}
function render() {
  setTabs();
  const withRail = view === "topics" || view === "topic";
  shell.classList.toggle("solo", !withRail);
  if (withRail) rail.innerHTML = listHTML(view === "topic" ? topicN : 0);
  if (view === "topic" && TOPIC[topicN]) renderTopic(TOPIC[topicN]);
  else if (view === "cards") renderStudy();
  else if (view === "guide") main.innerHTML = guideHTML();
  else renderOverview();
}
function route() {
  const h = location.hash.slice(1);
  const prevView = view, prevN = topicN;
  if (h === "cards") view = "cards";
  else if (h === "guide") view = "guide";
  else if (/^t-\d+$/.test(h) && TOPIC[+h.slice(2)]) { view = "topic"; topicN = +h.slice(2); }
  else view = "topics";
  confirmReset = false;
  render();
  if (prevView !== view || prevN !== topicN) {
    window.scrollTo(0, 0);
    if (view === "topic") {
      const a = rail.querySelector('[aria-current="page"]');
      if (a) a.scrollIntoView({ block: "nearest" });
    }
  }
}

// ---------- Случайный билет ----------
const ticket = $("#ticket");
let lastFocus = null;
function drawTicket() {
  const a = Math.floor(Math.random() * TOPICS.length);
  let b = Math.floor(Math.random() * (TOPICS.length - 1));
  if (b >= a) b += 1;
  const pair = [TOPICS[a], TOPICS[b]].sort((x, y) => x.n - y.n);
  $("#ticketList").innerHTML = pair.map((T, i) => `
    <li>
      <span class="mono">Вопрос ${i + 1} · тема ${pad(T.n)}</span>
      <p>${T.title}</p>
      <details><summary>Сверить с планом ответа</summary><ol>${T.plan.map(x => `<li>${x}</li>`).join("")}</ol>
        <p class="note"><a href="#t-${T.n}" data-close>Открыть теорию темы ${pad(T.n)}</a></p></details>
    </li>`).join("");
}
function openTicket() {
  lastFocus = document.activeElement;
  drawTicket();
  ticket.hidden = false;
  $("#ticketAgain").focus();
}
function closeTicket() {
  ticket.hidden = true;
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

// ---------- События ----------
document.addEventListener("click", e => {
  const t = e.target.closest("button, a");
  if (!t) return;
  if (t.matches("[data-ticket]")) { openTicket(); return; }
  if (t.id === "ticketClose") { closeTicket(); return; }
  if (t.id === "ticketAgain") { drawTicket(); return; }
  if (t.matches("[data-close]")) { ticket.hidden = true; return; }
  if (t.matches("[data-study]")) {
    S.settings.deck = `t:${t.dataset.study}`; S.settingsAt = Date.now(); save();
    current = null; location.hash = "cards"; return;
  }
  if (t.id === "reveal") { revealed = true; renderStudy(); return; }
  if (t.matches(".grade")) { grade(+t.dataset.g); return; }
  if (t.matches("[data-kind]")) {
    const k = t.dataset.kind, kinds = S.settings.kinds;
    const nextKinds = kinds.includes(k) ? kinds.filter(x => x !== k) : KIND_ORDER.filter(x => kinds.includes(x) || x === k);
    if (!nextKinds.length) return;
    S.settings.kinds = nextKinds; S.settingsAt = Date.now(); save();
    current = null; renderStudy(); return;
  }
  if (t.id === "moreNew") { S.extraToday += 10; save(); current = null; renderStudy(); return; }
  if (t.id === "reset") { confirmReset = true; renderStudy(); return; }
  if (t.id === "resetNo") { confirmReset = false; renderStudy(); return; }
  if (t.id === "resetYes") {
    const keep = S.settings;
    S = blank(); S.settings = keep; S.settingsAt = Date.now(); rollDay();
    confirmReset = false; current = null; save(); renderStudy(); return;
  }
});
ticket.addEventListener("click", e => { if (e.target === ticket) closeTicket(); });
document.addEventListener("change", e => {
  if (e.target.id === "deck") {
    S.settings.deck = e.target.value; S.settingsAt = Date.now(); save();
    current = null; renderStudy();
  }
  if (e.target.id === "npd") {
    const v = Math.max(0, Math.min(300, Math.round(+e.target.value || 0)));
    S.settings.newPerDay = v; S.settingsAt = Date.now(); save();
    current = null; renderStudy();
  }
});
document.addEventListener("keydown", e => {
  if (!ticket.hidden && e.key === "Escape") { closeTicket(); return; }
  if (view !== "cards" || !ticket.hidden) return;
  if (e.target.closest("input, select, textarea, summary, button, a") || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    if (!current) return;
    if (!revealed) { revealed = true; renderStudy(); } else grade(3);
  } else if (revealed && ["1", "2", "3", "4"].includes(e.key)) grade(+e.key);
});
window.addEventListener("hashchange", route);

route();
initSync();
