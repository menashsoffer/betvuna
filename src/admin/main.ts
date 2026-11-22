import '../shared/base.css';
import './style.css';
import type { Session } from '@supabase/supabase-js';
import { normalizePhone } from '../shared/phone';
import { fileToJpeg } from '../join/image';
import { loadCities } from '../join/cities';
import * as api from './api';
import { csvFileName, toCsv } from './csv';
import {
  FILTER_LABELS, displayPhone, fmtTime, initials, matches, onWall, stats, view,
  type Filter, type Participant,
} from './model';

const BASE = import.meta.env.BASE_URL;
const app = document.getElementById('app')!;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

// ---------- state ----------

const state = {
  session: null as Session | null,
  people: [] as Participant[],
  joinOpen: true,
  filter: 'all' as Filter,
  q: '',
  showSimulated: false,
  selected: null as string | null, // participant id, or 'new' for manual registration
  screen: false,
  link: false,
  sim: null as { done: number; total: number; stop: boolean } | null,
};

let toastTimer = 0;
function toast(text: string, isErr = false) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = text;
  t.className = isErr ? 'toast err' : 'toast';
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), isErr ? 6000 : 3000);
}

// ---------- login ----------

function renderLogin(note = '') {
  app.innerHTML = `
    <div class="login"><form class="box" id="login">
      <img src="${BASE}brand/logo_beit_midrash_gold.png" alt="">
      <h1>נבחרת השגרירים · ניהול</h1>
      <p class="hint">לכתובות המורשות בלבד.</p>
      <button class="b google" type="button" id="google">
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
        כניסה עם Google</button>
      <div class="or"><span>או קישור למייל</span></div>
      <div class="fld"><label for="em">דוא"ל</label><input id="em" type="email" class="ltr" required autocomplete="email"></div>
      <button class="b" type="submit">שלחו לי קישור כניסה</button>
      <div class="msg" id="lmsg">${esc(note)}</div>
    </form></div>`;
  const form = $<HTMLFormElement>('#login');
  $<HTMLButtonElement>('#google').onclick = async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    try { await api.signInWithGoogle(); } catch (err) {
      const msg = $('#lmsg');
      msg.className = 'msg err';
      msg.textContent = api.errText(err);
      btn.disabled = false;
    }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const email = $<HTMLInputElement>('#em').value.trim().toLowerCase();
    const msg = $('#lmsg');
    const btn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    btn.disabled = true;
    msg.className = 'msg';
    msg.textContent = 'שולח…';
    try {
      await api.sendMagicLink(email);
      msg.className = 'msg ok';
      msg.textContent = `נשלח קישור ל-${email}. פתחו אותו מהמחשב הזה.`;
    } catch (err) {
      msg.className = 'msg err';
      const m = (err as Error).message ?? '';
      msg.textContent = /rate|seconds/i.test(m) ? 'נשלחו יותר מדי קישורים. נסו שוב בעוד כמה דקות.' : api.errText(err);
      btn.disabled = false;
    }
  };
}

async function onSession(s: Session | null) {
  const same = s?.user.id === state.session?.user.id;
  state.session = s;
  if (same && s && $('#tb')) return; // token refresh: keep the panel as it is
  if (!s) { stopLive(); renderLogin(linkError()); return; }
  try {
    if (!(await api.isAdmin())) {
      const email = s.user.email ?? '';
      await api.signOut();
      renderLogin(`לכתובת ${email} אין הרשאת ניהול.`);
      return;
    }
  } catch (err) {
    renderLogin(api.errText(err));
    return;
  }
  renderShell();
  startLive();
}

// ---------- shell ----------

function renderShell() {
  app.innerHTML = `
    <header class="top">
      <img src="${BASE}brand/logo_beit_midrash_gold.png" alt="">
      <span class="ttl">נבחרת השגרירים · ניהול</span>
      <div class="who">
        <span id="screen"><span class="dot"></span>מסך האולם לא מחובר</span><span>·</span>
        <a class="b sm" href="${BASE}screen/" target="_blank" rel="noopener">פתח מסך</a>
        <span class="ltr">${esc(state.session?.user.email ?? '')}</span>
        <button class="b sm" id="out">יציאה</button>
      </div>
    </header>
    <section class="ctl">
      <div class="card"><h3>כפתור ההצטרפות בטלפונים</h3>
        <div class="tog" id="tog"><button data-open="1">פתוח</button><button data-open="0">נעול עד אות מהבמה</button></div>
        <div class="hint">במצב נעול הטלפונים מציגים "המתן לאות מהבמה" ונפתחים לבד כשמשנים לפתוח.</div></div>
      <div class="card"><h3>בדיקות לפני האירוע</h3>
        <div class="row"><button class="b" id="sim">הרץ סימולציה · 40 שגרירים</button></div>
        <div class="hint" id="simhint">שגרירים מדומים נכנסים בקצב משתנה, מסומנים, ולא נכנסים לייצוא.</div></div>
      <div class="card"><h3>איפוס</h3>
        <div class="row"><button class="b red" id="reset">איפוס מסך</button></div>
        <div class="hint">מנקה את הקיר ואת סימוני ההצטרפות ומוחק את המדומים. הנרשמים נשארים. דורש הקלדת "אפס".</div></div>
      <div class="card"><h3>ייצוא לאקסל</h3>
        <div class="row"><button class="b gold" data-csv="joined">שגרירים שהצטרפו</button><button class="b" data-csv="all">כל הנרשמים</button></div>
        <div class="hint">קובץ CSV שנפתח תקין באקסל בעברית. בלי שגרירים מדומים.</div></div>
    </section>
    <section class="stats" id="stats"></section>
    <section class="main" id="main">
      <div class="tbl">
        <div class="bar">
          <input class="search" id="q" type="search" placeholder="חיפוש לפי שם, טלפון או יישוב">
          <span id="chips" class="row"></span>
          <label class="chk"><input type="checkbox" id="showsim"> הצג מדומים</label>
          <button class="b sm gold" id="add" style="margin-inline-start:auto">+ רישום ידני</button>
        </div>
        <div class="scroll"><table>
          <thead><tr><th></th><th>שם</th><th>טלפון</th><th>דוא"ל</th><th>יישוב</th><th>נרשם</th><th>מצב</th><th></th></tr></thead>
          <tbody id="tb"></tbody>
        </table><div class="empty" id="empty" hidden>אין נרשמים להצגה</div></div>
      </div>
      <aside class="drawer" id="drawer" hidden></aside>
    </section>
    <div class="toast" id="toast" hidden></div>
    <div id="modal"></div>`;

  $('#out').onclick = () => api.signOut();
  $('#tog').onclick = (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (b) setJoinOpen(b.dataset.open === '1');
  };
  $('#sim').onclick = () => (state.sim ? (state.sim.stop = true) : runSimulation(40));
  $('#reset').onclick = openReset;
  app.querySelectorAll<HTMLButtonElement>('[data-csv]').forEach((b) => (b.onclick = () => exportCsv(b.dataset.csv as 'joined' | 'all')));
  $<HTMLInputElement>('#q').oninput = (e) => { state.q = (e.target as HTMLInputElement).value; renderTable(); };
  $<HTMLInputElement>('#showsim').onchange = (e) => { state.showSimulated = (e.target as HTMLInputElement).checked; renderTable(); };
  $('#chips').onclick = (e) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>('[data-f]');
    if (c) { state.filter = c.dataset.f as Filter; renderTable(); }
  };
  $('#add').onclick = () => select('new');
  $('#tb').onclick = (e) => {
    const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-id]');
    if (!tr) return;
    const join = (e.target as HTMLElement).closest('[data-join]');
    if (join) { e.stopPropagation(); joinById(tr.dataset.id!); return; }
    select(tr.dataset.id!);
  };
  renderAll();
}

function renderAll() {
  renderStatus();
  renderToggle();
  renderStats();
  renderTable();
  renderDrawer();
}

function renderStatus() {
  const el = $('#screen');
  if (!el) return;
  const cls = state.screen ? 'dot on' : state.link ? 'dot' : 'dot wait';
  const text = state.screen ? 'מסך האולם מחובר' : state.link ? 'מסך האולם לא מחובר' : 'הפאנל מתחבר לשרת…';
  el.innerHTML = `<span class="${cls}"></span>${text}`;
}

function renderToggle() {
  const tog = $('#tog');
  if (!tog) return;
  tog.classList.toggle('locked', !state.joinOpen);
  tog.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', (b.dataset.open === '1') === state.joinOpen));
}

function renderStats() {
  const s = stats(state.people);
  const items: [number, string][] = [
    [s.registered, 'נרשמו'], [s.joined, 'הצטרפו לנבחרת'], [s.onWall, 'על המסך עכשיו'],
    [s.cities, 'יישובים על המסך'], [s.noPhoto, 'בלי תמונה'], [s.hiddenPhotos, 'תמונות מוסתרות'],
  ];
  $('#stats').innerHTML = items.map(([n, l]) => `<div class="st"><b>${n}</b><span>${l}</span></div>`).join('');
}

function avatar(p: Participant, cls = 'av'): string {
  const url = api.photoPublicUrl(p.photo_path);
  const hid = p.photo_hidden ? ' hid' : '';
  return url
    ? `<span class="${cls}${hid}"><img src="${esc(url)}" alt="" loading="lazy"></span>`
    : `<span class="${cls}">${esc(initials(p.full_name))}</span>`;
}

function statusPill(p: Participant): string {
  const tags: string[] = [];
  if (p.is_simulated) tags.push('<span class="pill p-sim">מדומה</span>');
  if (p.wall_hidden) tags.push('<span class="pill p-hide">הוסר מהמסך</span>');
  else if (p.photo_hidden) tags.push('<span class="pill p-hide">תמונה מוסתרת</span>');
  tags.push(p.join_seq !== null
    ? `<span class="pill p-ok">הצטרף ${fmtTime(p.joined_at)} · #${p.join_seq}</span>`
    : '<span class="pill p-wait">עוד לא</span>');
  return tags.join(' ');
}

function renderTable() {
  const base = state.people.filter((p) => state.showSimulated || !p.is_simulated);
  $('#chips').innerHTML = (Object.keys(FILTER_LABELS) as Filter[]).map((f) =>
    `<button class="chip${f === state.filter ? ' on' : ''}" data-f="${f}">${FILTER_LABELS[f]} · ${base.filter((p) => matches(p, f)).length}</button>`).join('');
  const rows = view(state.people, state);
  $('#tb').innerHTML = rows.map((p) => `
    <tr data-id="${p.id}"${p.id === state.selected ? ' class="sel"' : ''}>
      <td>${avatar(p)}</td><td><b>${esc(p.full_name)}</b></td>
      <td class="ltr num">${esc(displayPhone(p.phone))}</td><td class="ltr">${esc(p.email)}</td>
      <td>${esc(p.city)}</td><td class="ltr num">${fmtTime(p.created_at)}</td><td>${statusPill(p)}</td>
      <td>${p.join_seq === null ? '<button class="b sm gold" data-join>צרף לנבחרת</button>' : '<button class="b sm">עריכה</button>'}</td>
    </tr>`).join('');
  $('#empty').hidden = rows.length > 0;
}

// ---------- drawer ----------

let cityList: string[] | null = null;
async function ensureCities() {
  if (cityList) return;
  try {
    cityList = (await loadCities()).map((c) => c.n);
    const dl = document.createElement('datalist');
    dl.id = 'cities';
    dl.innerHTML = cityList.map((c) => `<option value="${esc(c)}">`).join('');
    document.body.append(dl);
  } catch { cityList = []; }
}

function select(id: string | null) {
  state.selected = id;
  renderTable();
  renderDrawer();
  if (id) ensureCities();
}

let pendingPhoto: { blob: Blob; url: string } | null = null;

function renderDrawer() {
  const d = $('#drawer');
  if (!d) return;
  const id = state.selected;
  const p = id && id !== 'new' ? state.people.find((x) => x.id === id) : undefined;
  if (!id || (id !== 'new' && !p)) {
    d.hidden = true;
    $('#main').classList.add('nodrawer');
    return;
  }
  // Do not wipe a form the admin is typing into because of a background refresh.
  if (d.dataset.for === id && d.contains(document.activeElement) && document.activeElement?.tagName === 'INPUT') return;
  d.dataset.for = id;
  d.hidden = false;
  $('#main').classList.remove('nodrawer');
  if (pendingPhoto) { URL.revokeObjectURL(pendingPhoto.url); pendingPhoto = null; }

  const isNew = id === 'new';
  const val = (v: string) => `value="${esc(v)}"`;
  d.innerHTML = `
    <h2>${isNew ? 'רישום ידני' : esc(p!.full_name)}<button class="x" id="close" aria-label="סגור">×</button></h2>
    <div id="big">${p ? avatar(p, 'big') : '<span class="big">+</span>'}</div>
    <div class="row2">
      <button class="b sm" id="pick">${isNew ? 'העלה תמונה' : 'החלף תמונה'}</button>
      ${isNew ? '<span></span>' : `<button class="b sm ${p!.photo_hidden ? '' : 'red'}" id="hidephoto" ${p!.photo_path ? '' : 'disabled'}>${p!.photo_hidden ? 'החזר תמונה' : 'הסתר תמונה'}</button>`}
    </div>
    <input type="file" accept="image/*" id="file" hidden>
    <form id="edit" class="fld" style="gap:8px">
      <div class="fld"><label for="f-name">שם</label><input id="f-name" required minlength="2" maxlength="60" ${val(p?.full_name ?? '')}></div>
      <div class="fld"><label for="f-phone">טלפון</label><input id="f-phone" class="ltr" required inputmode="tel" ${val(p ? displayPhone(p.phone) : '')}></div>
      <div class="fld"><label for="f-email">דוא"ל</label><input id="f-email" type="email" class="ltr" required maxlength="120" ${val(p?.email ?? '')}></div>
      <div class="fld"><label for="f-city">יישוב</label><input id="f-city" list="cities" required minlength="2" maxlength="40" ${val(p?.city ?? '')}></div>
      ${p ? `<div class="hint">נרשם ${fmtTime(p.created_at)}${p.join_seq !== null ? ` · הצטרף ${fmtTime(p.joined_at)} · השגריר ה-${p.join_seq}` : ' · עוד לא הצטרף'}${p.is_simulated ? ' · מדומה' : ''}</div>` : '<div class="hint">ההסכמה נמסרת בעל פה לצוות.</div>'}
      <div class="row2">
        <button class="b sm gold" type="submit">${isNew ? 'רשום' : 'שמור'}</button>
        ${isNew ? '<button class="b sm" type="button" id="savejoin">רשום וצרף לנבחרת</button>'
          : p!.join_seq === null ? '<button class="b sm" type="button" id="join">צרף לנבחרת</button>'
          : `<button class="b sm ${p!.wall_hidden ? '' : 'red'}" type="button" id="wall">${p!.wall_hidden ? 'החזר למסך' : 'הסר מהמסך'}</button>`}
      </div>
      ${isNew ? '' : '<button class="b sm red" type="button" id="del">מחק פרופיל</button>'}
      <div class="msg" id="dmsg"></div>
    </form>`;

  $('#close').onclick = () => select(null);
  const file = $<HTMLInputElement>('#file');
  $('#pick').onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    try {
      const blob = await fileToJpeg(f);
      if (isNew) {
        if (pendingPhoto) URL.revokeObjectURL(pendingPhoto.url);
        pendingPhoto = { blob, url: URL.createObjectURL(blob) };
        $('#big').innerHTML = `<span class="big"><img src="${pendingPhoto.url}" alt=""></span>`;
      } else {
        await busy(async () => {
          const path = await api.uploadPhoto(blob);
          await api.updateParticipant(p!.id, { photo_path: path, photo_hidden: false });
        }, 'התמונה הוחלפה');
      }
    } catch (err) { toast(api.errText(err), true); }
  };
  $('#hidephoto')?.addEventListener('click', () =>
    busy(() => api.updateParticipant(p!.id, { photo_hidden: !p!.photo_hidden }), p!.photo_hidden ? 'התמונה הוחזרה' : 'התמונה הוסתרה'));
  $('#del')?.addEventListener('click', () => openDelete(p!));
  $('#wall')?.addEventListener('click', () =>
    busy(() => api.updateParticipant(p!.id, { wall_hidden: !p!.wall_hidden }), p!.wall_hidden ? 'הוחזר למסך' : 'הוסר מהמסך'));
  $('#join')?.addEventListener('click', () => joinById(p!.id));

  const form = $<HTMLFormElement>('#edit');
  const read = () => {
    const name = $<HTMLInputElement>('#f-name').value.trim();
    const phone = normalizePhone($<HTMLInputElement>('#f-phone').value);
    const email = $<HTMLInputElement>('#f-email').value.trim().toLowerCase();
    const city = $<HTMLInputElement>('#f-city').value.trim();
    if (!phone) throw new Error('invalid_phone');
    return { name, phone, email, city };
  };
  const save = async (andJoin: boolean) => {
    if (!form.reportValidity()) return;
    let v: ReturnType<typeof read>;
    try { v = read(); } catch (err) { showMsg(api.errText(err), true); return; }
    if (isNew) {
      await busy(async () => {
        const photoPath = pendingPhoto ? await api.uploadPhoto(pendingPhoto.blob) : null;
        const { id: newId } = await api.registerManual({ ...v, photoPath });
        if (andJoin) await api.rpc('admin_join', { p_id: newId });
        await refresh();
        select(newId);
      }, andJoin ? 'נרשם וצורף לנבחרת' : 'נרשם');
    } else {
      await busy(() => api.updateParticipant(p!.id, { full_name: v.name, phone: v.phone, email: v.email, city: v.city }), 'נשמר');
    }
  };
  form.onsubmit = (e) => { e.preventDefault(); save(false); };
  $('#savejoin')?.addEventListener('click', () => save(true));
}

function showMsg(text: string, isErr = false) {
  const m = $('#dmsg');
  if (m) { m.className = isErr ? 'msg err' : 'msg ok'; m.textContent = text; }
}

async function busy(fn: () => Promise<unknown>, ok: string) {
  const d = $('#drawer');
  d?.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.disabled = true));
  try {
    await fn();
    toast(ok);
    (document.activeElement as HTMLElement | null)?.blur();
    await refresh();
  } catch (err) {
    showMsg(api.errText(err), true);
    toast(api.errText(err), true);
  } finally {
    if (d) { delete d.dataset.for; renderDrawer(); }
  }
}

async function joinById(id: string) {
  const p = state.people.find((x) => x.id === id);
  try {
    const seq = await api.rpc<number>('admin_join', { p_id: id });
    toast(`${p?.full_name ?? ''} צורף לנבחרת · השגריר ה-${seq}`);
    await refresh();
  } catch (err) { toast(api.errText(err), true); }
}

// ---------- controls ----------

async function setJoinOpen(open: boolean) {
  if (open === state.joinOpen) return;
  const prev = state.joinOpen;
  state.joinOpen = open;
  renderToggle();
  try {
    await api.rpc('admin_set_join_open', { p_open: open });
    toast(open ? 'ההצטרפות פתוחה בכל הטלפונים' : 'ההצטרפות נעולה עד אות מהבמה');
  } catch (err) {
    state.joinOpen = prev;
    renderToggle();
    toast(api.errText(err), true);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runSimulation(total: number) {
  state.sim = { done: 0, total, stop: false };
  const btn = $<HTMLButtonElement>('#sim');
  const hint = $('#simhint');
  btn.textContent = 'עצור סימולציה';
  try {
    while (state.sim.done < total && !state.sim.stop) {
      // Bursts and pauses, like a real hall: mostly quick, sometimes a few seconds' gap.
      const burst = Math.random() < 0.25 ? 1 + Math.floor(Math.random() * 4) : 1;
      for (let i = 0; i < burst && state.sim.done < total; i++) {
        await api.rpc('admin_simulate', { p_count: 1 });
        state.sim.done++;
      }
      hint.textContent = `נוספו ${state.sim.done} מתוך ${total}…`;
      scheduleRefresh();
      await sleep(Math.random() < 0.15 ? 2500 + Math.random() * 2500 : 300 + Math.random() * 1200);
    }
    hint.textContent = `הסימולציה ${state.sim.stop ? 'נעצרה' : 'הסתיימה'}: נוספו ${state.sim.done} שגרירים מדומים. "איפוס מסך" מוחק אותם.`;
  } catch (err) {
    hint.textContent = `הסימולציה נעצרה: ${api.errText(err)}`;
  } finally {
    state.sim = null;
    btn.textContent = 'הרץ סימולציה · 40 שגרירים';
    refresh();
  }
}

function openDelete(p: Participant) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal"><div class="box">
    <h2>מחיקת פרופיל</h2>
    <p class="hint" style="font-size:13px">הפרופיל של <b>${esc(p.full_name)}</b> (${esc(displayPhone(p.phone))}) יימחק לגמרי, כולל התמונה${p.join_seq !== null ? ', והוא יורד מהמסך' : ''}. אי אפשר לשחזר. אם ירצה, יוכל להירשם מחדש מהטלפון.</p>
    <div class="row"><button class="b red" id="dgo">מחק לצמיתות</button><button class="b" id="dno">ביטול</button></div>
    <div class="msg" id="dmsg2"></div>
  </div></div>`;
  const close = () => (m.innerHTML = '');
  $('#dno').onclick = close;
  $('.modal', m).onclick = (e) => { if (e.target === e.currentTarget) close(); };
  const go = $<HTMLButtonElement>('#dgo');
  go.focus();
  go.onclick = async () => {
    go.disabled = true;
    try {
      await api.deleteParticipant(p.id, p.photo_path);
      close();
      toast(`הפרופיל של ${p.full_name} נמחק`);
      select(null);
      refresh();
    } catch (err) {
      $('#dmsg2').className = 'msg err';
      $('#dmsg2').textContent = api.errText(err);
      go.disabled = false;
    }
  };
}

function openReset() {
  const n = state.people.filter(onWall).length;
  const m = $('#modal');
  m.innerHTML = `<div class="modal"><form class="box" id="rf">
    <h2>איפוס מסך</h2>
    <p class="hint" style="font-size:13px">הקיר יתנקה (${n} על המסך עכשיו), סימוני ההצטרפות יימחקו וכל השגרירים המדומים יימחקו. הנרשמים נשארים, ויוכלו ללחוץ שוב על הכפתור.</p>
    <div class="fld"><label for="rw">כדי לאשר, הקלידו: אפס</label><input id="rw" autocomplete="off"></div>
    <div class="row"><button class="b red" type="submit" id="rgo" disabled>אפס את המסך</button><button class="b" type="button" id="rno">ביטול</button></div>
    <div class="msg" id="rmsg"></div>
  </form></div>`;
  const input = $<HTMLInputElement>('#rw');
  const go = $<HTMLButtonElement>('#rgo');
  input.focus();
  input.oninput = () => (go.disabled = input.value.trim() !== 'אפס');
  const close = () => (m.innerHTML = '');
  $('#rno').onclick = close;
  $('.modal', m).onclick = (e) => { if (e.target === e.currentTarget) close(); };
  $<HTMLFormElement>('#rf').onsubmit = async (e) => {
    e.preventDefault();
    if (input.value.trim() !== 'אפס') return;
    go.disabled = true;
    try {
      if (state.sim) state.sim.stop = true;
      await api.rpc('admin_reset_wall');
      close();
      toast('המסך אופס');
      refresh();
    } catch (err) {
      $('#rmsg').className = 'msg err';
      $('#rmsg').textContent = api.errText(err);
      go.disabled = false;
    }
  };
}

function exportCsv(scope: 'joined' | 'all') {
  const csv = toCsv(state.people, scope, api.photoPublicUrl);
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: csvFileName(scope) });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- live data ----------

let channel: ReturnType<typeof api.watchWall> | null = null;
let poll = 0;
let refreshTimer = 0;
let refreshing: Promise<void> | null = null;

async function refresh(): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const [people, settings] = await Promise.all([api.loadParticipants(), api.loadSettings()]);
      state.people = people;
      state.joinOpen = settings.join_open;
      if (state.selected && state.selected !== 'new' && !people.some((p) => p.id === state.selected)) state.selected = null;
      if ($('#tb')) renderAll();
    } catch (err) {
      toast(`רענון נכשל: ${api.errText(err)}`, true);
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(refresh, 400);
}

function startLive() {
  refresh();
  channel ??= api.watchWall(
    scheduleRefresh,
    (on) => { state.screen = on; renderStatus(); },
    (ok) => { state.link = ok; renderStatus(); },
  );
  // Registrations that have not joined yet are not broadcast, so poll as well.
  clearInterval(poll);
  poll = window.setInterval(() => { if (!document.hidden) refresh(); }, 8000);
}

function stopLive() {
  clearInterval(poll);
  if (channel) { channel.unsubscribe(); channel = null; }
  state.people = [];
  state.selected = null;
}

// ---------- boot ----------

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if ($('#modal')?.innerHTML) $('#modal').innerHTML = ''; else if (state.selected) select(null); }
});

function linkError(): string {
  const p = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
  if (!p.get('error') && !p.get('error_description')) return '';
  if (p.get('error_code') === 'otp_expired') return 'הקישור פג תוקף או כבר נוצל. שלחו קישור חדש.';
  return `הכניסה נכשלה: ${p.get('error_description') ?? p.get('error')}`;
}

// Fires once on load (INITIAL_SESSION, after reading a magic-link token from the URL) and on every sign-in/out.
api.onAuth((s) => { setTimeout(() => onSession(s), 0); }); // never await Supabase calls inside the auth callback
