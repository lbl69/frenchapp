import { buildSystemPrompt, QUICK_ACTIONS, SESSION_START, SESSION_END } from "./prompt.js";
import {
  getEngine, CLAUDE_MODELS, historyBudget, listApiModels,
} from "./engines.js";
import { renderMarkdown } from "./markdown.js";

const $ = (s) => document.querySelector(s);
const KEY = "tuteur-langues:v1";

const DEFAULTS = {
  language: "French",
  level: "intermediate",
  goals: "fluent",
  native: "English",
  engine: "claude",
  claudeKey: "",
  claudeModel: "claude-haiku-5-5",
  apiBase: "http://localhost:11434/v1",
  apiModel: "",
};

// ---------- Données (localStorage, uniquement sur cet appareil) ----------

function readStore() {
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}
const stored = readStore();
const firstRun = !stored;
const data = stored || { settings: {}, sessions: [], currentId: null, vocab: [], fixes: [] };
data.settings = { ...DEFAULTS, ...data.settings };
// Réglages d'une version précédente : le moteur dans le navigateur (WebLLM) n'existe plus.
if (data.settings.engine === "webllm") data.settings.engine = "claude";
for (const k of Object.keys(data.settings)) if (!(k in DEFAULTS)) delete data.settings[k];

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("Sauvegarde impossible", e);
  }
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const current = () => data.sessions.find((s) => s.id === data.currentId);
const NEW_TITLE = "Nouvelle séance";

// ---------- Nettoyage et mémoire (vocabulaire, erreurs) ----------

function clean(raw) {
  return raw
    .replace(/<think>[\s\S]*?(<\/think>|$)/g, "")
    .replace(/\[\[(VOCAB|FIX):[\s\S]*?(\]\]|$)/g, "")
    .replace(/\[\[?[A-Z]*$/, "")
    .trim();
}

function parseWord(item) {
  let left = item;
  let meaning = "";
  const eq = item.indexOf("=");
  if (eq > 0) {
    left = item.slice(0, eq);
    meaning = item.slice(eq + 1);
  } else {
    const m = item.match(/^(.*?)(?:\s[—–-]\s|:\s)(.*)$/);
    if (m) [, left, meaning] = m;
  }
  let word = left.trim();
  let pron = "";
  const p = word.match(/^(.*?)\s*\((.*)\)\s*$/);
  if (p) [, word, pron] = p;
  word = word.replace(/^[*_\s]+|[*_\s]+$/g, "");
  return word ? { word, pron: pron.trim(), meaning: meaning.trim() } : null;
}

function remember(raw) {
  const added = [];
  for (const m of raw.matchAll(/\[\[VOCAB:([\s\S]*?)\]\]/g)) {
    for (const item of m[1].split(/[;\n]/)) {
      const w = parseWord(item.trim());
      if (!w) continue;
      const existing = data.vocab.find((v) => v.word.toLowerCase() === w.word.toLowerCase());
      if (existing) {
        existing.pron ||= w.pron;
        existing.meaning ||= w.meaning;
      } else {
        data.vocab.push({ ...w, added: Date.now() });
        added.push(w.word);
      }
    }
  }
  let fixes = 0;
  for (const m of raw.matchAll(/\[\[FIX:([\s\S]*?)\]\]/g)) {
    for (const item of m[1].split(/[;\n]/)) {
      const text = item.trim();
      if (text && !data.fixes.some((f) => f.text === text)) {
        data.fixes.push({ text, added: Date.now() });
        fixes++;
      }
    }
  }
  data.fixes = data.fixes.slice(-100);
  updateVocabCount();
  return { added, fixes };
}

// ---------- Synthèse vocale (voix du système, fonctionne hors-ligne) ----------

const LANG_CODES = {
  french: "fr-FR", français: "fr-FR", francais: "fr-FR",
  english: "en-US", anglais: "en-US",
  spanish: "es-ES", espagnol: "es-ES",
  german: "de-DE", allemand: "de-DE",
  italian: "it-IT", italien: "it-IT",
  portuguese: "pt-PT", portugais: "pt-PT",
  japanese: "ja-JP", japonais: "ja-JP",
  "mandarin chinese": "zh-CN", chinese: "zh-CN", mandarin: "zh-CN", chinois: "zh-CN",
  korean: "ko-KR", coréen: "ko-KR",
  arabic: "ar-SA", arabe: "ar-SA",
  russian: "ru-RU", russe: "ru-RU",
  dutch: "nl-NL", néerlandais: "nl-NL",
};

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(
    text.replace(/[*_#>`|]/g, "").replace(/\p{Extended_Pictographic}/gu, "")
  );
  const code = LANG_CODES[data.settings.language.trim().toLowerCase()];
  if (code) {
    u.lang = code;
    const voice = speechSynthesis.getVoices().find((v) => v.lang.replace("_", "-") === code)
      || speechSynthesis.getVoices().find((v) => v.lang.startsWith(code.slice(0, 2)));
    if (voice) u.voice = voice;
  }
  u.rate = 0.9;
  speechSynthesis.speak(u);
}

// ---------- Affichage ----------

const messagesEl = $("#messages");

function nearBottom() {
  return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120;
}
function scrollDown(force) {
  if (force || nearBottom()) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function msgTools(el, msg) {
  const tools = document.createElement("div");
  tools.className = "msg-tools";
  const listen = document.createElement("button");
  listen.className = "mini";
  listen.type = "button";
  listen.textContent = "🔊 Écouter";
  listen.title = "Lit le texte sélectionné, ou tout le message";
  listen.onclick = () => {
    const sel = String(getSelection());
    speak(sel && el.contains(getSelection().anchorNode) ? sel : msg.content);
  };
  const copy = document.createElement("button");
  copy.className = "mini";
  copy.type = "button";
  copy.textContent = "📋 Copier";
  copy.onclick = () => navigator.clipboard?.writeText(msg.content);
  tools.append(listen, copy);
  if (msg.newWords?.length) {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = `+${msg.newWords.length} mot${msg.newWords.length > 1 ? "s" : ""} au vocabulaire`;
    tag.title = msg.newWords.join(", ");
    tools.append(tag);
  }
  el.append(tools);
}

function messageEl(msg) {
  const el = document.createElement("div");
  el.className = `msg ${msg.role}`;
  if (msg.role === "assistant") {
    el.innerHTML = renderMarkdown(msg.content);
    msgTools(el, msg);
  } else {
    el.textContent = msg.content;
  }
  return el;
}

function renderMessages() {
  messagesEl.innerHTML = "";
  const s = current();
  const visible = s ? s.messages.filter((m) => !m.hidden) : [];
  if (!visible.length && !busy) {
    messagesEl.innerHTML = `<div class="empty"><div class="big">🗣️</div>
      <p>Ton tuteur de langues personnel.</p>
      <button class="btn primary" type="button" id="startBtn">Commencer une séance</button></div>`;
    $("#startBtn").onclick = () => (s ? greet() : newSession());
    return;
  }
  for (const m of visible) messagesEl.append(messageEl(m));
  scrollDown(true);
}

function renderSessions() {
  const ul = $("#sessions");
  ul.innerHTML = "";
  for (const s of data.sessions) {
    const li = document.createElement("li");
    if (s.id === data.currentId) li.className = "active";
    const open = document.createElement("button");
    open.className = "open";
    open.type = "button";
    open.textContent = s.title;
    const date = document.createElement("small");
    date.textContent = new Date(s.created).toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    open.append(date);
    open.onclick = () => {
      if (busy) return;
      data.currentId = s.id;
      save();
      renderSessions();
      renderMessages();
      closeNav();
    };
    const del = document.createElement("button");
    del.className = "mini del";
    del.type = "button";
    del.textContent = "✕";
    del.title = "Supprimer la séance";
    del.onclick = () => {
      if (busy || !confirm(`Supprimer « ${s.title} » ?`)) return;
      data.sessions = data.sessions.filter((x) => x !== s);
      if (data.currentId === s.id) data.currentId = data.sessions[0]?.id ?? null;
      save();
      renderSessions();
      renderMessages();
    };
    li.append(open, del);
    ul.append(li);
  }
}

let engineReady = false;

function updateStatus() {
  const st = data.settings;
  const model = st.engine === "api"
    ? `Serveur local · ${st.apiModel || "aucun modèle"}`
    : CLAUDE_MODELS.find((m) => m.id === st.claudeModel)?.label.split(" — ")[0] ?? st.claudeModel;
  $("#status").innerHTML = `<span class="dot ${engineReady ? "ok" : ""}"></span>${st.language} · ${model} · ${
    navigator.onLine ? "en ligne" : "hors-ligne"
  }`;
}

function updateVocabCount() {
  $("#vocabCount").textContent = data.vocab.length;
}

// ---------- Moteur et envoi ----------

let busy = false;
let controller = null;

function setBusy(b) {
  busy = b;
  $("#send").hidden = b;
  $("#stop").hidden = !b;
  $("#endSession").disabled = b;
}

async function ensureLoaded(engine) {
  await engine.load();
  engineReady = true;
  updateStatus();
}

function modelMessages(s) {
  // Prompt figé pour toute la séance : un début de conversation identique permet au moteur
  // de réutiliser ce qu'il a déjà calculé au lieu de tout retraiter à chaque message.
  const sys = (s.system ||= buildSystemPrompt(data.settings, data.vocab, data.fixes));
  let budget = historyBudget(data.settings) - sys.length;
  const hist = [];
  for (let i = s.messages.length - 1; i >= 0; i--) {
    const m = s.messages[i];
    // On renvoie au modèle sa réponse brute : identique à ce qu'il a produit, elle n'a pas à être relue.
    const content = m.raw ?? m.content;
    budget -= content.length;
    if (budget < 0 && hist.length) break;
    hist.unshift({ role: m.role, content });
  }
  while (hist.length && hist[0].role !== "user") hist.shift();
  return [{ role: "system", content: sys }, ...hist];
}

function showError(message, retry) {
  const el = document.createElement("div");
  el.className = "msg error";
  el.textContent = message;
  if (retry) {
    const b = document.createElement("button");
    b.className = "btn small";
    b.type = "button";
    b.textContent = "Réessayer";
    b.style.marginLeft = "10px";
    b.onclick = () => {
      el.remove();
      retry();
    };
    el.append(b);
  }
  messagesEl.append(el);
  scrollDown(true);
}

async function send(text, { hidden = false } = {}) {
  if (busy || !text.trim()) return;
  let s = current();
  if (!s) {
    s = createSession();
    renderSessions();
  }
  const userMsg = { role: "user", content: text, hidden };
  s.messages.push(userMsg);
  if (!hidden && s.title === NEW_TITLE) {
    s.title = text.replace(/\s+/g, " ").slice(0, 48);
    renderSessions();
  }
  save();
  setBusy(true);
  if (messagesEl.querySelector(".empty")) messagesEl.innerHTML = "";
  let userEl = null;
  if (!hidden) {
    userEl = messageEl(userMsg);
    messagesEl.append(userEl);
  }
  const el = document.createElement("div");
  el.className = "msg assistant typing";
  messagesEl.append(el);
  scrollDown(true);

  let raw = "";
  let frame = 0;
  const paint = () => {
    frame = 0;
    el.innerHTML = renderMarkdown(clean(raw));
    scrollDown();
  };
  controller = new AbortController();
  let failure = null;
  try {
    const engine = getEngine(data.settings);
    await ensureLoaded(engine);
    await engine.stream(modelMessages(s), (d) => {
      raw += d;
      frame ||= requestAnimationFrame(paint);
    }, controller.signal);
  } catch (e) {
    // Seul le bouton Stop est un arrêt voulu : toute autre erreur est affichée.
    if (!(e.name === "AbortError" && controller.signal.aborted)) failure = e;
  }
  cancelAnimationFrame(frame);
  controller = null;

  const content = clean(raw);
  if (content) {
    const { added } = remember(raw);
    const msg = { role: "assistant", content, raw, newWords: added };
    s.messages.push(msg);
    el.replaceWith(messageEl(msg));
  } else {
    // Rien reçu : on retire le message pour pouvoir le renvoyer.
    el.remove();
    s.messages.splice(s.messages.indexOf(userMsg), 1);
    userEl?.remove();
    if (!hidden) $("#input").value = text;
  }
  save();
  setBusy(false);
  if (failure) {
    console.error(failure);
    engineReady = false;
    updateStatus();
    let msg = failure.message || String(failure);
    if (data.settings.engine === "api" && /fetch|network|load failed/i.test(msg)) {
      msg = `Impossible de joindre le serveur local (${data.settings.apiBase}). Vérifiez qu'il est lancé et qu'il accepte cette origine (pour Ollama : OLLAMA_ORIGINS).`;
    }
    showError(msg, content ? null : () => send(text, { hidden }));
  }
  scrollDown();
}

function createSession() {
  const s = { id: uid(), title: NEW_TITLE, created: Date.now(), messages: [] };
  data.sessions.unshift(s);
  data.currentId = s.id;
  save();
  return s;
}

function greet() {
  send(SESSION_START, { hidden: true });
}

function newSession() {
  if (busy) return;
  const s = current();
  if (s && !s.messages.some((m) => !m.hidden)) {
    data.sessions = data.sessions.filter((x) => x !== s);
  }
  createSession();
  renderSessions();
  renderMessages();
  closeNav();
  greet();
}

// ---------- Saisie ----------

const input = $("#input");
function autosize() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 180) + "px";
}
input.addEventListener("input", autosize);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $("#form").requestSubmit();
  }
});
$("#form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value;
  if (!text.trim() || busy) return;
  input.value = "";
  autosize();
  send(text);
});
$("#stop").onclick = () => controller?.abort();
$("#endSession").onclick = () => send(SESSION_END);
$("#newSession").onclick = newSession;

for (const a of QUICK_ACTIONS) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = a.label;
  b.onclick = () => {
    if (a.fill) {
      input.value = a.text;
      autosize();
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    } else {
      send(a.text);
    }
  };
  $("#actions").append(b);
}

// Navigation mobile
const closeNav = () => document.querySelector(".app").classList.remove("nav-open");
$("#menu").onclick = () => document.querySelector(".app").classList.add("nav-open");
$("#scrim").onclick = closeNav;

// ---------- Réglages ----------

const settingsDlg = $("#settingsDlg");
const form = settingsDlg.querySelector("form");

for (const m of CLAUDE_MODELS) form.claudeModel.add(new Option(m.label, m.id));

function syncEngineFields() {
  const api = form.engine.value === "api";
  $("#claudeFields").hidden = api;
  $("#apiFields").hidden = !api;
}

function openSettings() {
  const st = data.settings;
  for (const k of ["language", "level", "goals", "native", "claudeKey", "claudeModel", "apiBase", "apiModel"]) {
    form[k].value = st[k];
  }
  form.engine.value = st.engine;
  syncEngineFields();
  closeNav();
  settingsDlg.showModal();
}

form.engine.forEach((r) => r.addEventListener("change", syncEngineFields));
$("#toggleKey").onclick = () => {
  form.claudeKey.type = form.claudeKey.type === "password" ? "text" : "password";
};

$("#detectModels").onclick = async () => {
  const info = $("#apiInfo");
  info.textContent = "Recherche…";
  try {
    const models = await listApiModels(form.apiBase.value);
    $("#apiModels").innerHTML = "";
    for (const m of models) $("#apiModels").append(new Option(m));
    if (!form.apiModel.value && models[0]) form.apiModel.value = models[0];
    info.textContent = models.length ? `${models.length} modèle(s) trouvé(s) : ${models.join(", ")}` : "Aucun modèle installé sur ce serveur.";
  } catch (e) {
    info.textContent = `Serveur injoignable (${e.message}). Est-il lancé ? Pour Ollama, autorisez cette page avec OLLAMA_ORIGINS.`;
  }
};

settingsDlg.addEventListener("close", () => {
  if (settingsDlg.returnValue === "save") {
    const before = JSON.stringify(data.settings);
    const fd = new FormData(form);
    for (const [k, v] of fd) if (k in DEFAULTS) data.settings[k] = String(v).trim();
    if (JSON.stringify(data.settings) !== before) {
      engineReady = false;
      if (current()) delete current().system;
    }
    save();
    updateStatus();
  }
  if (firstRun && !data.sessions.length) newSession();
});

$("#openSettings").onclick = openSettings;

$("#exportData").onclick = () => {
  // La clé API n'est jamais exportée : le fichier peut être partagé ou perdu.
  const exported = { ...data, settings: { ...data.settings, claudeKey: "" } };
  const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `tuteur-langues-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};

$("#importData").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (!imported.settings || !Array.isArray(imported.sessions)) throw new Error("format inconnu");
    if (!confirm("Remplacer toutes les données actuelles par celles du fichier ?")) return;
    // Le fichier exporté ne contient pas la clé API : on garde celle déjà saisie.
    imported.settings.claudeKey ||= data.settings.claudeKey;
    localStorage.setItem(KEY, JSON.stringify(imported));
    location.reload();
  } catch (err) {
    alert(`Import impossible : ${err.message}`);
  }
};

$("#wipeData").onclick = () => {
  if (!confirm("Effacer toutes les séances, le vocabulaire et les réglages ? (Les modèles téléchargés restent en cache.)")) return;
  localStorage.removeItem(KEY);
  location.reload();
};

// ---------- Vocabulaire ----------

const vocabDlg = $("#vocabDlg");

function renderVocab() {
  const q = $("#vocabFilter").value.trim().toLowerCase();
  const ul = $("#vocabList");
  ul.innerHTML = "";
  const list = data.vocab
    .filter((v) => !q || `${v.word} ${v.meaning}`.toLowerCase().includes(q))
    .slice()
    .reverse();
  if (!list.length) ul.innerHTML = `<li class="hint">Aucun mot pour l'instant.</li>`;
  for (const v of list) {
    const li = document.createElement("li");
    const w = document.createElement("div");
    w.className = "w";
    w.innerHTML = "<strong></strong> <span class='p'></span><br><span></span>";
    w.children[0].textContent = v.word;
    w.children[1].textContent = v.pron ? `(${v.pron})` : "";
    w.children[3].textContent = v.meaning;
    const listen = document.createElement("button");
    listen.className = "mini";
    listen.type = "button";
    listen.textContent = "🔊";
    listen.onclick = () => speak(v.word);
    const del = document.createElement("button");
    del.className = "mini";
    del.type = "button";
    del.textContent = "✕";
    del.onclick = () => {
      data.vocab = data.vocab.filter((x) => x !== v);
      save();
      updateVocabCount();
      renderVocab();
    };
    li.append(w, listen, del);
    ul.append(li);
  }

  const fl = $("#fixList");
  fl.innerHTML = "";
  if (!data.fixes.length) fl.innerHTML = `<li class="hint">Aucune erreur enregistrée.</li>`;
  for (const f of data.fixes.slice().reverse()) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = f.text;
    const del = document.createElement("button");
    del.className = "mini";
    del.type = "button";
    del.textContent = "✓";
    del.title = "Maîtrisé : retirer de la liste";
    del.onclick = () => {
      data.fixes = data.fixes.filter((x) => x !== f);
      save();
      renderVocab();
    };
    li.append(span, del);
    fl.append(li);
  }
}

$("#openVocab").onclick = () => {
  closeNav();
  renderVocab();
  vocabDlg.showModal();
};
$("#vocabFilter").oninput = renderVocab;
$("#addWord").onclick = () => {
  const word = $("#newWord").value.trim();
  if (!word) return;
  if (!data.vocab.some((v) => v.word.toLowerCase() === word.toLowerCase())) {
    data.vocab.push({ word, pron: $("#newPron").value.trim(), meaning: $("#newMeaning").value.trim(), added: Date.now() });
  }
  $("#newWord").value = $("#newPron").value = $("#newMeaning").value = "";
  save();
  updateVocabCount();
  renderVocab();
};

// ---------- Démarrage ----------

addEventListener("online", updateStatus);
addEventListener("offline", updateStatus);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(console.warn);
// Demande au navigateur de ne pas évincer le modèle téléchargé.
navigator.storage?.persist?.();
window.speechSynthesis?.getVoices();

updateStatus();
updateVocabCount();
renderSessions();
renderMessages();
if (firstRun || (data.settings.engine === "claude" && !data.settings.claudeKey)) openSettings();
