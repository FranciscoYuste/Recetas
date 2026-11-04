// Utilidades sin estado ni DOM (salvo $). Se pueden probar en Node.

import { DIAS } from './config.js';

export const $ = (id) => document.getElementById(id);

export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function normalizeText(text) {
    return String(text ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// "calabacin atun" -> "calabac[ií]n.*[aá]t[uúü]n" para buscar sin importar tildes (imatch de PostgREST).
export function accentInsensitivePattern(text) {
    const map = { a: '[aáà]', e: '[eéè]', i: '[iíï]', o: '[oó]', u: '[uúü]', n: '[nñ]' };
    return normalizeText(text)
        .replace(/[^a-z0-9 ]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(word => word.split('').map(ch => map[ch] || ch).join(''))
        .join('.*');
}

export function matchesSearch(text, query) {
    const pattern = accentInsensitivePattern(query);
    if (!pattern) return true;
    return new RegExp(pattern, 'i').test(String(text ?? ''));
}

export function shuffle(list) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

export function plural(n, singular, pluralForm) {
    return `${n} ${n === 1 ? singular : pluralForm}`;
}

export function todayDiaId(date = new Date()) {
    const d = date.getDay();
    return d === 0 ? 7 : d;
}

export function diaNombre(id) {
    const d = DIAS.find(x => x.id === Number(id));
    return d ? d.nombre : '';
}

// localStorage puede no estar (modo privado, bloqueado): nunca debe romper la app.
export const storage = {
    get(key) {
        try { return localStorage.getItem(key); } catch { return null; }
    },
    set(key, value) {
        try {
            if (value == null) localStorage.removeItem(key);
            else localStorage.setItem(key, value);
        } catch { /* solo dura esta visita */ }
    },
    getJson(key) {
        try { return JSON.parse(localStorage.getItem(key)) ?? null; } catch { return null; }
    },
    setJson(key, value) {
        this.set(key, value == null ? null : JSON.stringify(value));
    },
    getFlag(key) { return this.get(key) === '1'; },
    setFlag(key, value) { this.set(key, value ? '1' : '0'); }
};
