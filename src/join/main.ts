import './style.css';
import { normalizePhone } from '../shared/phone';
import { ApiError, MESSAGES, joinOpen, joinWall, me, onSettings, recover, register, setPhoto, uploadPhoto, type Me } from './api';
import { openCamera, type Camera } from './camera';
import { findCity, loadCities, searchCities, type City } from './cities';
import { fileToJpeg } from './image';
import { loadPeople, savePerson } from './store';

const app = document.getElementById('app')!;
const BASE = import.meta.env.BASE_URL;
const LOGOS = `<div class="logos"><img src="${BASE}brand/logo_beit_midrash_gold.png" alt="בית המדרש תורה והלכה"><img class="bt" src="${BASE}brand/logo_batvuna_gold.png" alt="בתבונה"></div>`;

let camera: Camera | null = null;
let current: string | null = null; // id of the person shown on the join screen
let isOpen = true;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join(' ');
const avatar = (p: Pick<Me, 'full_name' | 'photo'>, cls = '') =>
  `<div class="av ${cls}">${p.photo ? `<img src="${esc(p.photo)}" alt="">` : `<span>${esc(initials(p.full_name))}</span>`}</div>`;
const message = (e: unknown) => MESSAGES[e instanceof ApiError ? e.message : 'network'] ?? MESSAGES.network;
const tokenOf = (id: string) => loadPeople().find((p) => p.id === id)?.token ?? null;

function show(html: string): HTMLElement {
  camera?.stop();
  camera = null;
  app.innerHTML = `<section class="screen">${html}</section>`;
  window.scrollTo(0, 0);
  return app.firstElementChild as HTMLElement;
}

/* 1. פתיחה */
function welcome(): void {
  const el = show(`
    ${LOGOS}
    <h1 class="t xl">נבחרת<br>השגרירים</h1>
    <p class="sub">מאירים את הארץ<br>בנקודות של תורה</p>
    <div class="glow"><i></i></div>
    <p class="muted">הרשמה של דקה, ותמונה שתופיע על המסך הגדול</p>
    <button class="btn gold" data-go="details">להרשמה</button>
    <button class="link" data-go="recover">כבר נרשמתי</button>`);
  el.querySelector('[data-go="details"]')!.addEventListener('click', () => details());
  el.querySelector('[data-go="recover"]')!.addEventListener('click', () => recoverScreen());
}

/* 2. פרטים */
function details(registeredByToken: string | null = null): void {
  const el = show(`
    <div class="steps"><i class="on"></i><i></i><i></i></div>
    <h1 class="t md">${registeredByToken ? 'משתתף נוסף' : 'הפרטים שלך'}</h1>
    <form novalidate>
      <div class="f"><label for="name">שם פרטי ומשפחה</label><input id="name" autocomplete="name" required maxlength="60"></div>
      <div class="f"><label for="phone">טלפון נייד</label><input id="phone" class="ltr" type="tel" inputmode="tel" autocomplete="tel" required placeholder="050-1234567"></div>
      <div class="f"><label for="email">דוא"ל</label><input id="email" class="ltr" type="email" inputmode="email" autocomplete="email" required></div>
      <div class="f"><label for="city">יישוב מגורים</label><input id="city" autocomplete="off" required role="combobox" aria-autocomplete="list" aria-expanded="false"><div class="ac" hidden></div></div>
      <label class="chk"><input id="consent" type="checkbox"><span>אני מסכים/ה שהשם, היישוב והתמונה יוצגו על המסך באירוע, ושהפרטים יישמרו אצל בית המדרש ליצירת קשר.</span></label>
      <p class="err" aria-live="polite"></p>
      <button class="btn gold" type="submit">המשך</button>
    </form>
    <button class="link" data-back>חזרה</button>`);
  const $ = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
  const form = $<HTMLFormElement>('form');
  const city = $<HTMLInputElement>('#city');
  const list = $<HTMLDivElement>('.ac');
  const err = $<HTMLParagraphElement>('.err');
  let cities: City[] = [];
  loadCities().then((c) => { cities = c; }).catch(() => {});

  const closeList = () => { list.hidden = true; city.setAttribute('aria-expanded', 'false'); };
  city.addEventListener('input', () => {
    const hits = searchCities(cities, city.value);
    list.innerHTML = hits.map((c) => `<button type="button">${esc(c.n)}</button>`).join('');
    list.hidden = hits.length === 0;
    city.setAttribute('aria-expanded', String(!list.hidden));
  });
  list.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    city.value = b.textContent ?? '';
    closeList();
  });
  city.addEventListener('blur', () => setTimeout(closeList, 150));
  $('[data-back]').addEventListener('click', () => (registeredByToken ? joinScreen() : welcome()));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $<HTMLInputElement>('#name').value.trim();
    const phone = $<HTMLInputElement>('#phone').value;
    const email = $<HTMLInputElement>('#email').value.trim();
    const consent = $<HTMLInputElement>('#consent').checked;
    const match = findCity(cities, city.value);
    const problems: [string, string][] = [];
    if (name.length < 2) problems.push(['#name', 'צריך שם מלא.']);
    if (!normalizePhone(phone)) problems.push(['#phone', MESSAGES.invalid_phone]);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) problems.push(['#email', 'כתובת הדוא"ל לא נראית תקינה.']);
    if (!match && cities.length) problems.push(['#city', 'בחר יישוב מהרשימה.']);
    if (!consent) problems.push(['#consent', MESSAGES.consent_required]);
    el.querySelectorAll('input').forEach((i) => i.removeAttribute('aria-invalid'));
    problems.forEach(([s]) => $(s).setAttribute('aria-invalid', 'true'));
    if (problems.length) { err.textContent = problems[0][1]; $(problems[0][0]).focus(); return; }

    const btn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    btn.disabled = true; btn.textContent = 'שומר…'; err.textContent = '';
    try {
      const person = await register({ name, phone, email, city: match?.n ?? city.value.trim(), registeredByToken });
      savePerson(person);
      current = person.id;
      selfie(person.id);
    } catch (ex) {
      err.textContent = message(ex);
      btn.disabled = false; btn.textContent = 'המשך';
    }
  });
}

/* 3. סלפי */
function selfie(id: string, fromJoin = false): void {
  const el = show(`
    <div class="steps"><i class="on"></i><i class="on"></i><i></i></div>
    <h1 class="t md">תמונה למסך הגדול</h1>
    <div class="cam"><video hidden></video><img hidden alt=""><div class="ring"></div><div class="hint">מכניסים את הפנים לעיגול</div></div>
    <p class="err" aria-live="polite"></p>
    <div class="shot">
      <button class="side" data-gallery>מהגלריה</button>
      <button class="s" data-shoot aria-label="צילום"></button>
      <button class="side" data-skip>${fromJoin ? 'ביטול' : 'דלג'}</button>
    </div>
    <div class="shot" data-review hidden>
      <button class="btn ghost" data-retake style="width:auto;padding-inline:22px">צלם שוב</button>
      <button class="btn gold" data-ok style="width:auto;padding-inline:30px">אישור</button>
    </div>
    <input type="file" accept="image/*" capture="user" hidden>`);
  const $ = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
  const video = $<HTMLVideoElement>('video');
  const img = $<HTMLImageElement>('img');
  const file = $<HTMLInputElement>('input[type=file]');
  const err = $<HTMLParagraphElement>('.err');
  const shootRow = el.querySelector('.shot') as HTMLElement;
  const reviewRow = $<HTMLElement>('[data-review]');
  let shot: Blob | null = null;

  const startCamera = async () => {
    try {
      const cam = await openCamera(video);
      if (!el.isConnected) { cam.stop(); return; }
      camera = cam;
      video.hidden = false;
    } catch {
      // No camera or no permission (also in WhatsApp/Instagram browsers): the shutter opens the native picker.
      $('.hint').textContent = 'לחץ על העיגול הלבן כדי לצלם';
    }
  };
  const review = (blob: Blob) => {
    shot = blob;
    img.src = URL.createObjectURL(blob);
    img.hidden = false; video.hidden = true;
    camera?.stop(); camera = null;
    shootRow.hidden = true; reviewRow.hidden = false;
    $('.hint').hidden = true;
  };

  $('[data-shoot]').addEventListener('click', async () => {
    if (!camera) { file.click(); return; }
    try { review(await camera.capture()); } catch (e) { err.textContent = message(e); }
  });
  $('[data-gallery]').addEventListener('click', () => { file.removeAttribute('capture'); file.click(); });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.setAttribute('capture', 'user');
    if (!f) return;
    try { review(await fileToJpeg(f)); } catch { err.textContent = 'לא הצלחנו לקרוא את התמונה. נסה תמונה אחרת.'; }
  });
  $('[data-retake]').addEventListener('click', () => {
    shot = null; img.hidden = true; shootRow.hidden = false; reviewRow.hidden = true;
    $('.hint').hidden = false; startCamera();
  });
  $('[data-skip]').addEventListener('click', () => joinScreen());
  $('[data-ok]').addEventListener('click', async () => {
    const token = tokenOf(id);
    if (!shot || !token) return;
    const ok = $<HTMLButtonElement>('[data-ok]');
    ok.disabled = true; ok.textContent = 'מעלה…'; err.textContent = '';
    try {
      await setPhoto(token, await uploadPhoto(shot));
      joinScreen();
    } catch (e) {
      err.textContent = message(e);
      ok.disabled = false; ok.textContent = 'אישור';
    }
  });
  startCamera();
}

/* 4. כפתור ההצטרפות */
async function joinScreen(): Promise<void> {
  const people = loadPeople();
  let list: Me[] = [];
  try {
    [list, isOpen] = await Promise.all([me(people.map((p) => p.token)), joinOpen()]);
  } catch (e) {
    show(`${LOGOS}<div class="spacer"></div><p class="err">${message(e)}</p><button class="btn gold" data-retry>נסה שוב</button><div class="spacer"></div>`)
      .querySelector('[data-retry]')!.addEventListener('click', () => joinScreen());
    return;
  }
  if (!list.length) { welcome(); return; }
  const main = list.find((p) => p.id === current) ?? list.find((p) => !p.joined) ?? list[list.length - 1];
  current = main.id;
  const others = list.filter((p) => p.id !== main.id);

  const action = main.joined
    ? `<div class="locked">כבר בנבחרת השגרירים · השגריר ה-${main.join_seq}</div>`
    : isOpen
      ? `<button class="join" data-join>אני מצטרף להיות שגריר של תורה והלכה<small>השם והתמונה יופיעו עכשיו על המסך הגדול</small></button>`
      : `<div class="locked">${MESSAGES.join_closed}</div>`;

  const el = show(`
    <div class="steps"><i class="on"></i><i class="on"></i><i class="on"></i></div>
    ${avatar(main, 'big')}
    <p class="name">${esc(main.full_name)}</p>
    <p class="muted">${esc(main.city)} · <button class="link" data-photo style="display:inline;padding:0">${main.photo ? 'החלף תמונה' : 'הוסף תמונה'}</button></p>
    <p class="err" aria-live="polite"></p>
    ${action}
    <div class="who">
      ${others.length ? '<h3>נרשמו גם מהטלפון הזה</h3>' : ''}
      ${others.map((p) => `<div class="row">${avatar(p)}<div><b>${esc(p.full_name)}</b><small>${esc(p.city)}</small></div>${
        p.joined ? `<span class="done">בנבחרת ✓</span>` : `<button data-pick="${p.id}">${isOpen ? 'צרף' : 'פתח'}</button>`}</div>`).join('')}
      <button class="link" data-another>רשום משתתף נוסף מהטלפון הזה</button>
    </div>`);
  const err = el.querySelector('.err') as HTMLElement;

  el.querySelector('[data-photo]')!.addEventListener('click', () => selfie(main.id, true));
  el.querySelector('[data-another]')!.addEventListener('click', () => details(tokenOf(main.id)));
  el.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) =>
    b.addEventListener('click', () => { current = b.dataset.pick!; joinScreen(); }));
  el.querySelector<HTMLButtonElement>('[data-join]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const token = tokenOf(main.id);
    if (!token) return;
    btn.disabled = true;
    try {
      const seq = await joinWall(token);
      joined({ ...main, joined: true, join_seq: seq });
    } catch (ex) {
      if (ex instanceof ApiError && ex.message === 'join_closed') { isOpen = false; joinScreen(); return; }
      err.textContent = message(ex);
      btn.disabled = false;
    }
  });
}

/* 5. ברוך הבא לנבחרת */
function joined(p: Me): void {
  const el = show(`
    <div class="rays"></div>
    <div style="height:30px"></div>
    ${avatar(p, 'big')}
    <p class="ok">ברוך הבא לנבחרת<br>השגרירים!</p>
    <span class="tag">השגריר ה-${p.join_seq} · ${esc(p.city)}</span>
    <p class="sub">הסתכל למסך הגדול:<br>התמונה שלך מופיעה עכשיו</p>
    <div class="spacer"></div>
    <button class="link" data-back>חזרה</button>`);
  navigator.vibrate?.([80, 60, 160]);
  el.querySelector('[data-back]')!.addEventListener('click', () => joinScreen());
}

/* 6. כבר נרשמתי */
function recoverScreen(): void {
  const el = show(`
    ${LOGOS}
    <h1 class="t md" style="margin-top:20px">כבר נרשמתי</h1>
    <p class="muted">הקלד את מספר הטלפון שאיתו נרשמת</p>
    <form novalidate>
      <div class="f"><label for="phone">טלפון נייד</label><input id="phone" class="ltr" type="tel" inputmode="tel" autocomplete="tel" placeholder="050-1234567"></div>
      <p class="err" aria-live="polite"></p>
      <button class="btn gold" type="submit">המשך</button>
    </form>
    <div class="spacer"></div>
    <button class="link" data-back>חזרה</button>`);
  const form = el.querySelector('form')!;
  const input = el.querySelector('#phone') as HTMLInputElement;
  const err = el.querySelector('.err') as HTMLElement;
  el.querySelector('[data-back]')!.addEventListener('click', () => welcome());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!normalizePhone(input.value)) { err.textContent = MESSAGES.invalid_phone; return; }
    const btn = form.querySelector('button') as HTMLButtonElement;
    btn.disabled = true; err.textContent = '';
    try {
      const found = await recover(input.value);
      if (!found) { err.textContent = 'לא מוצא? פנה לצוות בכניסה לאולם.'; btn.disabled = false; return; }
      savePerson(found);
      current = found.id;
      joinScreen();
    } catch (ex) {
      err.textContent = message(ex);
      btn.disabled = false;
    }
  });
}

// When the admin opens or locks the button, refresh the join screen without a reload.
onSettings((open) => {
  if (open === isOpen) return;
  isOpen = open;
  if (app.querySelector('.join, .locked')) joinScreen();
});

if (loadPeople().length) joinScreen(); else welcome();
