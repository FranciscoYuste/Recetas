// Arranque de la app: navegación entre pestañas, login, carga inicial y sincronización
// al volver a la app. Cada pantalla vive en su módulo (semana, recetas, compra...).

import { VIEWS, ESQUEMA_REQUERIDO } from './config.js';
import { db, signIn, loadStoredSession, currentSession, onSessionExpired } from './api.js';
import { state, emit } from './state.js';
import { $ } from './util.js';
import { registerActions, setupActions, showToast } from './ui.js';
import { loadCategories, loadFavorites } from './catalogo.js';
import { setupWeek, loadWeek } from './semana.js';
import { setupRecipes, renderScopeFilters, renderCategoryFilters, renderCategorySelects, refreshRecipes } from './recetas.js';
import { setupFridge } from './nevera.js';
import { setupShopping, loadProducts, loadShoppingList, loadHabituales } from './compra.js';
import { setupSettings } from './ajustes.js';

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(e => console.warn('Service worker no registrado:', e));
}

// ---------------------------------------------------------------- navegación

function currentViewFromHash() {
    const name = location.hash.replace('#', '');
    return VIEWS.includes(name) ? name : 'semana';
}

function showView(name) {
    VIEWS.forEach(v => { $('view-' + v).hidden = v !== name; });
    document.querySelectorAll('.tab').forEach(t => {
        const active = t.dataset.view === name;
        t.classList.toggle('active', active);
        if (active) t.setAttribute('aria-current', 'page');
        else t.removeAttribute('aria-current');
    });
    window.scrollTo({ top: 0 });
}

registerActions({
    'go-view': (el) => {
        if (location.hash === '#' + el.dataset.view) showView(el.dataset.view);
        else location.hash = el.dataset.view;
    },
    'back-to-top': () => window.scrollTo({ top: 0, behavior: 'smooth' })
});

// ---------------------------------------------------------------- login

function showLogin(message) {
    const error = $('loginError');
    error.hidden = !message;
    error.textContent = message || '';
    const email = currentSession()?.email;
    if (email) $('loginEmail').value = email;
    $('loginScreen').hidden = false;
    $($('loginEmail').value ? 'loginPassword' : 'loginEmail').focus();
}

function setupLogin() {
    onSessionExpired(() => showLogin('Tu sesión ha caducado. Vuelve a entrar.'));
    $('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = $('loginSubmit');
        $('loginError').hidden = true;
        btn.disabled = true;
        btn.textContent = 'Entrando…';
        try {
            await signIn($('loginEmail').value.trim(), $('loginPassword').value);
            $('loginPassword').value = '';
            // Si la sesión caducó con la app ya cargada, se recarga para traer todo de nuevo.
            if (state.appStarted) return location.reload();
            $('loginScreen').hidden = true;
            startApp();
        } catch (err) {
            $('loginError').textContent = err.code === 'invalid_credentials' || err.status === 400
                ? 'Email o contraseña incorrectos.'
                : 'No se pudo iniciar sesión: ' + err.message;
            $('loginError').hidden = false;
        } finally {
            btn.disabled = false;
            btn.textContent = 'Entrar';
        }
    });
}

// ---------------------------------------------------------------- carga

// Avisa si falta alguna migración de supabase/ (la app las necesita todas).
async function checkSchema() {
    const missing = new Set();
    await Promise.all(ESQUEMA_REQUERIDO.map(({ tabla, columnas, sql }) =>
        db(tabla, `?select=${columnas}&limit=1`).catch(() => missing.add(sql))));
    const hint = $('schemaHint');
    hint.hidden = missing.size === 0;
    if (missing.size) {
        hint.textContent = `⚠️ Falta preparar la base de datos: ejecuta ${[...missing].map(f => `supabase/${f}`).join(' y ')} en el SQL Editor de Supabase.`;
    }
}

async function startApp() {
    if (state.appStarted) return;
    state.appStarted = true;
    $('weeklyGrid').innerHTML = '<p class="hint">Cargando…</p>';
    checkSchema();
    try {
        await Promise.all([loadCategories(), loadFavorites(), loadProducts(), loadHabituales()]);
    } catch (e) {
        console.error('Error cargando datos iniciales:', e);
        showToast('No se pudieron cargar los datos. Revisa la conexión.', true);
    }

    state.currentScope = state.favorites.length > 0 ? 'favoritas' : 'todas';
    renderScopeFilters();
    renderCategoryFilters();
    renderCategorySelects();
    refreshRecipes();

    await Promise.all([
        loadWeek(),
        loadShoppingList().catch(e => console.error('Error cargando la lista:', e))
    ]);
}

// Si uno añade algo desde su móvil, el otro lo ve al volver a la app (sin recargar).
// Como mucho una vez cada 15 s. También recupera categorías y favoritas por si la app se
// abrió sin conexión o sin acceso.
let lastSync = 0;
function syncOnReturn() {
    if (document.visibilityState !== 'visible' || !state.appStarted || !currentSession()) return;
    if (Date.now() - lastSync < 15000) return;
    lastSync = Date.now();
    emit('compra');
    loadWeek({ keepOnError: true });
    loadCategories().catch(e => console.warn('No se pudieron actualizar las categorías:', e));
    loadFavorites();
    loadHabituales();
}

// ---------------------------------------------------------------- arranque

function setupBackToTop() {
    const btn = $('backToTopBtn');
    window.addEventListener('scroll', () => { btn.hidden = window.scrollY < 600; }, { passive: true });
}

setupActions();
setupLogin();
setupWeek();
setupRecipes();
setupFridge();
setupShopping();
setupSettings();
setupBackToTop();

window.addEventListener('hashchange', () => showView(currentViewFromHash()));
showView(currentViewFromHash());
document.addEventListener('visibilitychange', syncOnReturn);

if (loadStoredSession()) startApp();
else showLogin();
