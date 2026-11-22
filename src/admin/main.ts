import '../shared/base.css';
import { SUPABASE_URL } from '../shared/config';

const app = document.getElementById('app')!;
app.innerHTML = `<div class="placeholder"><h1>נבחרת השגרירים</h1><p>admin: בבנייה</p><small>${SUPABASE_URL ? 'מחובר לשרת' : 'השרת עוד לא הוגדר'}</small></div>`;
