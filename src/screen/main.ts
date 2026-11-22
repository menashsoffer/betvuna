import '../shared/base.css';
import { IS_CONFIGURED } from '../shared/config';

const app = document.getElementById('app')!;
app.innerHTML = `<div class="placeholder"><h1>נבחרת השגרירים</h1><p>screen: בבנייה</p><small>${IS_CONFIGURED ? 'מחובר לשרת' : 'השרת עוד לא הוגדר'}</small></div>`;
