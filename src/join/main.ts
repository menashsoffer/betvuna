import '../shared/base.css';
import { supabase } from '../shared/supabase';

const app = document.getElementById('app')!;
app.innerHTML = `<div class="placeholder"><h1>נבחרת השגרירים</h1><p>join: בבנייה</p><small id="status">בודק חיבור לשרת…</small></div>`;

const status = document.getElementById('status')!;
supabase().rpc('wall_state').then(({ data, error }) => {
  status.textContent = error ? 'אין חיבור לשרת' : `מחובר לשרת · הכפתור ${data?.join_open ? 'פתוח' : 'נעול'}`;
});
