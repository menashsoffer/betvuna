// Hall projection screen (/screen). Live from Supabase, or ?demo=1 for a local rehearsal.
import './style.css';
import { connectLive, type NetStatus } from './connection';
import { startDemo } from './demo';
import { loadGeo } from './geo';
import { Wall } from './wall';

const params = new URLSearchParams(location.search);
const demo = params.has('demo');
const brand = `${import.meta.env.BASE_URL}brand/`;

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="stage" id="stage">
    <div class="hdr">
      <img src="${brand}logo_beit_midrash_gold.png" alt="בית המדרש תורה והלכה">
      <div class="t"><b>נבחרת השגרירים</b><span>מאירים את הארץ בנקודות של תורה</span></div>
      <img class="bt" src="${brand}logo_batvuna_gold.png" alt="בתבונה">
    </div>
    <div class="light r" id="lr"><div class="beam"></div><div class="dust"></div><div class="lamp"></div><div class="pool"></div>
      <div class="val"><b id="num">0</b><span>שגרירים</span></div></div>
    <div class="light l" id="ll"><div class="beam"></div><div class="dust"></div><div class="lamp"></div><div class="pool"></div>
      <div class="val"><b id="nc">0</b><span>יישובים</span></div></div>
    <div class="dim"></div>
    <div class="net wait" id="net" role="status"><i></i><span></span></div>
  </div>
  <div class="start" id="start">
    <button type="button" id="go">התחל הקרנה</button>
    <p>מסך מלא, המסך לא ייכבה והסמן יוסתר.<br>${demo ? 'מצב חזרה: הדמיה מקומית בלי שרת.' : 'Esc כדי להמשיך בלי מסך מלא.'}</p>
  </div>`;

const stage = document.getElementById('stage')!;
const net = document.getElementById('net')!;
const setNet = (s: NetStatus | 'demo') => {
  net.className = `net ${s === 'online' ? '' : s === 'offline' ? 'off' : s === 'demo' ? '' : 'wait'}`;
  net.querySelector('span')!.textContent = s === 'demo' ? 'חזרה' : s === 'offline' ? 'מתחבר מחדש…' : '';
  net.title = { online: 'מחובר', offline: 'אין חיבור', connecting: 'מתחבר', demo: 'מצב חזרה' }[s];
};

// ---------- start: fullscreen, wake lock, hidden cursor ----------

let lock: WakeLockSentinel | null = null;
async function keepAwake() {
  try { lock = await navigator.wakeLock?.request('screen'); } catch { /* not supported or denied */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (!lock || lock.released)) void keepAwake();
});

const start = document.getElementById('start')!;
const go = async (full: boolean) => {
  start.classList.add('gone');
  if (full) await document.documentElement.requestFullscreen?.().catch(() => undefined);
  void keepAwake();
};
document.getElementById('go')!.addEventListener('click', () => void go(true));
window.addEventListener('keydown', (e) => {
  if (start.classList.contains('gone')) return;
  if (e.key === 'Escape') void go(false);
  if (e.key === 'Enter') void go(true);
});
if (params.has('auto')) void go(false);

let idle: ReturnType<typeof setTimeout> | undefined;
const wake = () => { document.body.classList.remove('idle'); clearTimeout(idle); idle = setTimeout(() => document.body.classList.add('idle'), 2500); };
window.addEventListener('pointermove', wake);
wake();

// ---------- the wall ----------

async function boot() {
  for (let attempt = 0; ; attempt++) {
    try {
      const { geo, cityPoint } = await loadGeo();
      const wall = new Wall(stage, geo, cityPoint, params.has('fast') ? { hold: 700 } : {});
      if (demo) { setNet('demo'); startDemo(wall, params); }
      else connectLive(wall, setNet);
      return;
    } catch (err) {
      console.warn('[screen] boot failed, retrying', err);
      setNet('offline');
      await new Promise((r) => setTimeout(r, Math.min(2000 * (attempt + 1), 10_000)));
    }
  }
}
setNet(demo ? 'demo' : 'connecting');
void boot();
