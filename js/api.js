// Conexión con Supabase: sesión (Supabase Auth por /auth/v1) y tablas (PostgREST por
// /rest/v1). La sesión se guarda en localStorage y el token se renueva solo; las tablas
// tienen RLS y solo responden a usuarios autenticados de usuarios_permitidos.

import { SUPABASE_URL, SUPABASE_KEY, SESSION_KEY } from './config.js';
import { storage } from './util.js';

let session = null;        // {access_token, refresh_token, expires_at, email}
let refreshPromise = null; // renovación en curso (para no pedirla dos veces a la vez)
let onExpired = () => {};

export function onSessionExpired(fn) {
    onExpired = fn;
}

export function currentSession() {
    return session;
}

export function loadStoredSession() {
    session = storage.getJson(SESSION_KEY);
    return session;
}

function writeSession(value) {
    session = value;
    storage.setJson(SESSION_KEY, value);
}

function sessionFromAuth(data) {
    return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
        email: data.user?.email || session?.email || ''
    };
}

async function authRequest(path, body, token) {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
        method: 'POST',
        headers: {
            apikey: SUPABASE_KEY,
            'Content-Type': 'application/json',
            ...(token ? { Authorization: 'Bearer ' + token } : {})
        },
        body: JSON.stringify(body || {})
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* respuesta vacía o no JSON */ }
    if (!response.ok) {
        const err = new Error(data?.msg || data?.error_description || data?.message || `Error ${response.status}`);
        err.status = response.status;
        err.code = data?.error_code || data?.error;
        throw err;
    }
    return data;
}

export async function signIn(email, password) {
    const data = await authRequest('token?grant_type=password', { email, password });
    writeSession(sessionFromAuth(data));
}

export async function signOut() {
    const token = session?.access_token;
    writeSession(null);
    if (token) await authRequest('logout', {}, token).catch(() => {});
}

function expire() {
    writeSession(null);
    onExpired();
}

function refreshSession() {
    if (!refreshPromise) {
        refreshPromise = authRequest('token?grant_type=refresh_token', { refresh_token: session.refresh_token })
            .then(data => writeSession(sessionFromAuth(data)))
            .catch(err => {
                // Con status es que Supabase ha rechazado el token; sin él, fallo de red (no cerrar sesión).
                if (err.status) expire();
                throw err;
            })
            .finally(() => { refreshPromise = null; });
    }
    return refreshPromise;
}

export async function getAccessToken() {
    const stored = storage.getJson(SESSION_KEY);
    if (stored) session = stored; // por si otra pestaña ya renovó el token
    if (!session) {
        onExpired();
        throw new Error('Sesión no iniciada');
    }
    if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
    await refreshSession();
    return session.access_token;
}

// fetch con el token de la sesión; si caduca a mitad (401) renueva y reintenta una vez.
async function authorizedFetch(url, options = {}, retry = true) {
    const token = await getAccessToken();
    const response = await fetch(url, {
        ...options,
        headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token, ...(options.headers || {}) }
    });
    if (response.status === 401 && retry) {
        await refreshSession();
        return authorizedFetch(url, options, false);
    }
    return response;
}

// db('tabla', '?select=...', {method, body, headers}) -> filas (o null si no hay cuerpo)
export async function db(table, query = '', options = {}) {
    const response = await authorizedFetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation', ...(options.headers || {}) }
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Supabase (${table}) respondió con ${response.status}: ${text}`);
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
}

// Atajos para no repetir method/body en cada llamada.
export const dbInsert = (table, rows, query = '') =>
    db(table, query, { method: 'POST', body: JSON.stringify(Array.isArray(rows) ? rows : [rows]) });
export const dbUpdate = (table, filter, values) =>
    db(table, filter, { method: 'PATCH', body: JSON.stringify(values) });
export const dbDelete = (table, filter) =>
    db(table, filter, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });

// Filas + total (cabecera Content-Range) para paginar.
export async function dbCount(table, params) {
    const response = await authorizedFetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
        headers: { Prefer: 'count=exact' }
    });
    if (!response.ok) throw new Error(`Supabase (${table}) respondió con ${response.status}`);
    const rows = await response.json();
    const range = response.headers.get('Content-Range');
    return { rows, total: range ? Number(range.split('/')[1]) : rows.length };
}

// Edge Function (p. ej. importar-receta). Devuelve {status, ok, data}.
export async function callFunction(name, body) {
    const response = await authorizedFetch(`${SUPABASE_URL}/functions/v1/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, ok: response.ok, data };
}
