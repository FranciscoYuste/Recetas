// App.js - Recetario Digital (Supabase vía PostgREST)
// Tablas: recetas, categoria_recetas, recetas_favoritas, productos, lista_compra,
// menu_semanal_actual (borrador de la semana), semanas_guardadas (historial).
// Columnas opcionales (supabase/migracion_mejoras.sql): lista_compra.texto/comprado,
// semanas_guardadas.creado_en, recetas.propia. Se detectan al arrancar.

const SUPABASE_URL = 'https://vvhkuuuwpfbyqpthetos.supabase.co';
const SUPABASE_KEY = 'sb_publishable_KKUvsjeLk_gGNfOpdcg9aQ_4R0NTNyV';

const DIAS = [
    { id: 1, nombre: 'Lunes' },
    { id: 2, nombre: 'Martes' },
    { id: 3, nombre: 'Miércoles' },
    { id: 4, nombre: 'Jueves' },
    { id: 5, nombre: 'Viernes' },
    { id: 6, nombre: 'Sábado' },
    { id: 7, nombre: 'Domingo' }
];
const TIPOS_COMIDA = ['Comida', 'Cena'];
const VIEWS = ['semana', 'recetas', 'compra'];
const RECIPES_PAGE_SIZE = 60;
const LOCAL_CHECKED_KEY = 'recetario.comprados';
const SESSION_KEY = 'recetario.sesion';

let session = null;        // {access_token, refresh_token, expires_at, email}
let refreshPromise = null; // renovación en curso (para no pedirla dos veces a la vez)
let appStarted = false;

// datos: columnas recetas.tipo/oculta/notas (supabase/mejoras_datos.sql).
// habituales: tabla compra_habitual (supabase/compra_habitual.sql).
let schema = { shoppingExtras: false, menuFecha: false, propia: false, datos: false, habituales: false };
let habituales = [];       // {clave, nombre, veces, fijo, ultima_vez}
let habitualEditMode = false;
const THERMOMIX_KEY = 'recetario.thermomix';
let showThermomix = readFlag(THERMOMIX_KEY);
let randomPool = { key: null, total: 0 }; // nº de recetas candidatas para sugerencias aleatorias
let notesTimer = null;
let lastBackgroundSync = 0;

let recipes = [];          // página actual del catálogo {id, title, url, categoria}
let totalRecipes = 0;
let allRecipesCount = null;
let currentRecipePage = 0;
let currentScope = 'todas'; // 'favoritas' | 'propias' | 'todas'
let currentCategoryFilter = 'Todas';
let recipeSearchTimer = null;
let recipeLoadToken = 0;

let categories = [];       // {id, categoria}
let favorites = [];        // {id, receta_id}
let favoriteRecipes = [];  // {id, title, url, categoria, ingredients}
let products = [];         // {id, nombre}
let shoppingList = [];     // {id, id_producto, cantidad, nombre, comprado}

let currentWeekMenu = {};  // `${dia}_${tipo}` -> {receta_id, title, draftId}
let savedMenusGrouped = {};
let currentlyViewedSemana = null;

let currentRecipe = null;  // receta abierta en el modal
let randomMode = false;
let pickerSlot = null;     // {dia, tipo}
let pickerSearchTimer = null;
let pickerSearchToken = 0;
let confirmAction = null;
let deferredInstallPrompt = null;
let toastTimer = null;

const $ = (id) => document.getElementById(id);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(e => console.warn('Service worker no registrado:', e));
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const btn = $('installAppBtn');
    if (btn) btn.hidden = false;
});

// -------------------- ARRANQUE --------------------

document.addEventListener('DOMContentLoaded', async () => {
    setupNavigation();
    setupGlobalHandlers();
    setupWeekView();
    setupRecipesView();
    setupShoppingView();
    setupRecipeModal();
    setupPickerModal();
    setupSettingsModal();
    setupAddRecipeModal();
    setupCategoryManagerModal();
    setupProductManagerModal();
    setupConfirmModal();
    setupBackToTop();
    setupLogin();

    session = readSession();
    if (session) startApp();
    else showLogin();
});

// Carga inicial de datos. Solo se ejecuta con sesión iniciada.
async function startApp() {
    if (appStarted) return;
    appStarted = true;
    $('weeklyGrid').innerHTML = '<p class="hint">Cargando…</p>';
    try {
        await detectSchema();
        await Promise.all([loadCategories(), loadFavorites(), loadProducts(), loadHabituales()]);
    } catch (e) {
        console.error('Error cargando datos iniciales:', e);
        showToast('No se pudieron cargar los datos. Revisa la conexión.', true);
    }

    currentScope = favorites.length > 0 ? 'favoritas' : 'todas';
    renderCategoryFilters();
    renderScopeFilters();
    renderCategorySelects();
    refreshRecipes();

    await Promise.all([
        loadCurrentWeekMenuDraft().then(renderWeek),
        loadShoppingList().catch(showShoppingError)
    ]);
}

async function detectSchema() {
    const probe = (table, cols) => supabaseRequest(table, `?select=${cols}&limit=1`).then(() => true, () => false);
    const [shoppingExtras, menuFecha, propia, datos, habitualesOk] = await Promise.all([
        probe('lista_compra', 'texto,comprado'),
        probe('semanas_guardadas', 'creado_en'),
        probe('recetas', 'propia'),
        probe('recetas', 'tipo,oculta,notas'),
        probe('compra_habitual', 'clave')
    ]);
    schema = { shoppingExtras, menuFecha, propia, datos, habituales: habitualesOk };
    const hint = $('schemaHint');
    if (hint && !(shoppingExtras && menuFecha && propia)) {
        hint.hidden = false;
        hint.textContent = 'ℹ️ Para tachar productos sincronizados entre móviles, ver fechas en los menús y el filtro «Mis recetas», ejecuta supabase/migracion_mejoras.sql en Supabase.';
    }
}

// -------------------- SESIÓN (Supabase Auth) --------------------
// Login con email y contraseña contra /auth/v1. La sesión (access + refresh token)
// se guarda en localStorage para no tener que entrar cada vez. Las tablas tienen RLS
// y solo dejan pasar a usuarios autenticados (ver supabase/seguridad_rls.sql).

function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch { return null; }
}

function writeSession(value) {
    session = value;
    try {
        if (value) localStorage.setItem(SESSION_KEY, JSON.stringify(value));
        else localStorage.removeItem(SESSION_KEY);
    } catch { /* sin localStorage la sesión dura lo que la pestaña */ }
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

function refreshSession() {
    if (!refreshPromise) {
        refreshPromise = authRequest('token?grant_type=refresh_token', { refresh_token: session.refresh_token })
            .then(data => writeSession(sessionFromAuth(data)))
            .catch(err => {
                // Con status es que Supabase ha rechazado el token; sin él, fallo de red (no cerrar sesión).
                if (err.status) sessionExpired();
                throw err;
            })
            .finally(() => { refreshPromise = null; });
    }
    return refreshPromise;
}

async function getAccessToken() {
    const stored = readSession();
    if (stored) session = stored; // por si otra pestaña ya renovó el token
    if (!session) {
        showLogin();
        throw new Error('Sesión no iniciada');
    }
    if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
    await refreshSession();
    return session.access_token;
}

function sessionExpired() {
    writeSession(null);
    showLogin('Tu sesión ha caducado. Vuelve a entrar.');
}

function setupLogin() {
    $('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = $('loginSubmit');
        const error = $('loginError');
        error.hidden = true;
        btn.disabled = true;
        btn.textContent = 'Entrando…';
        try {
            const data = await authRequest('token?grant_type=password', {
                email: $('loginEmail').value.trim(),
                password: $('loginPassword').value
            });
            writeSession(sessionFromAuth(data));
            $('loginPassword').value = '';
            if (appStarted) {
                // La sesión caducó con la app ya cargada: recargar para traer todo de nuevo.
                location.reload();
                return;
            }
            $('loginScreen').hidden = true;
            startApp();
        } catch (err) {
            error.textContent = err.code === 'invalid_credentials' || err.status === 400
                ? 'Email o contraseña incorrectos.'
                : 'No se pudo iniciar sesión: ' + err.message;
            error.hidden = false;
        } finally {
            btn.disabled = false;
            btn.textContent = 'Entrar';
        }
    });

    $('logoutBtn').addEventListener('click', () => {
        askConfirm('¿Cerrar la sesión en este dispositivo?', 'Cerrar sesión', async () => {
            const token = session?.access_token;
            writeSession(null);
            if (token) await authRequest('logout', {}, token).catch(() => {});
            location.reload();
        }, { danger: false });
    });
}

function showLogin(message) {
    const screen = $('loginScreen');
    if (!screen) return;
    const error = $('loginError');
    error.hidden = !message;
    error.textContent = message || '';
    if (session?.email || readSession()?.email) $('loginEmail').value = session?.email || readSession().email;
    screen.hidden = false;
    $(($('loginEmail').value ? 'loginPassword' : 'loginEmail')).focus();
}

// -------------------- SUPABASE --------------------

// fetch a PostgREST con el token de la sesión; si caduca a mitad (401) renueva y reintenta una vez.
async function supabaseFetch(url, options = {}, retry = true) {
    const token = await getAccessToken();
    const response = await fetch(url, {
        ...options,
        headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token, ...(options.headers || {}) }
    });
    if (response.status === 401 && retry) {
        await refreshSession();
        return supabaseFetch(url, options, false);
    }
    return response;
}

async function supabaseRequest(table, query = '', options = {}) {
    const response = await supabaseFetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
            ...(options.headers || {})
        }
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Supabase (${table}) respondió con ${response.status}: ${text}`);
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
}

// Devuelve filas + total (cabecera Content-Range) para paginar.
async function supabaseCount(table, params) {
    const response = await supabaseFetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
        headers: { Prefer: 'count=exact' }
    });
    if (!response.ok) throw new Error(`Supabase (${table}) respondió con ${response.status}`);
    const rows = await response.json();
    const range = response.headers.get('Content-Range');
    return { rows, total: range ? Number(range.split('/')[1]) : rows.length };
}

// Filtros comunes de las consultas al catálogo. Sin las columnas nuevas solo se aplica
// el de Thermomix. tipos = lista blanca (p. ej. solo principales para sugerir menús);
// sinTipos = lista negra. Las recetas sin tipo (añadidas a mano) pasan siempre.
function applyCatalogFilters(params, { tipos = null, sinTipos = null, ocultas = false } = {}) {
    if (schema.datos) {
        params.append('oculta', ocultas ? 'is.true' : 'is.false');
        if (tipos) params.append('or', `(tipo.is.null,tipo.in.(${tipos.join(',')}))`);
        else if (sinTipos) params.append('or', `(tipo.is.null,tipo.not.in.(${sinTipos.join(',')}))`);
    }
    if (!showThermomix && !ocultas) params.append('title', 'not.imatch.thermomix');
    return params;
}

// ¿Sirve para proponerla como comida o cena? (para las que ya están cargadas en memoria)
function isMenuRecipe(r) {
    return (!r.tipo || r.tipo === 'principal') && !r.oculta && (showThermomix || !/thermomix/i.test(r.title || ''));
}

// -------------------- UTILIDADES --------------------

function readFlag(key) {
    try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

function writeFlag(key, value) {
    try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* solo dura esta visita */ }
}

function shuffle(list) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function normalizeText(text) {
    return String(text ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// "calabacin atun" -> "calabac[ií]n.*[aá]t[uúü]n" para buscar sin importar tildes (imatch de PostgREST).
function accentInsensitivePattern(text) {
    const map = { a: '[aáà]', e: '[eéè]', i: '[iíï]', o: '[oó]', u: '[uúü]', n: '[nñ]' };
    return normalizeText(text)
        .replace(/[^a-z0-9 ]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(word => word.split('').map(ch => map[ch] || ch).join(''))
        .join('.*');
}

function matchesSearch(text, query) {
    const pattern = accentInsensitivePattern(query);
    if (!pattern) return true;
    return new RegExp(pattern, 'i').test(String(text ?? ''));
}

function categoryName(id) {
    const c = categories.find(cat => cat.id === id);
    return c ? c.categoria : 'Sin categoría';
}

function todayDiaId() {
    const d = new Date().getDay();
    return d === 0 ? 7 : d;
}

function diaNombre(id) {
    const d = DIAS.find(x => x.id === Number(id));
    return d ? d.nombre : '';
}

function openModalEl(id) {
    $(id).style.display = 'flex';
}

function closeModalEl(id) {
    $(id).style.display = 'none';
}

function showToast(message, isError = false) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.toggle('toast-error', isError);
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, isError ? 5000 : 2600);
}

function askConfirm(message, yesLabel, onYes, { danger = true, noLabel = 'Cancelar' } = {}) {
    confirmAction = onYes;
    $('confirmMessage').innerText = message;
    $('confirmNoBtn').textContent = noLabel;
    const yes = $('confirmYesBtn');
    yes.textContent = yesLabel;
    yes.className = danger ? 'btn-clear' : 'btn btn-primary';
    openModalEl('confirmModal');
}

// Los ingredientes importados vienen pegados ("camaronesMantecaSal2 cdas."). Se separan
// por saltos de línea, comas sueltas, minúscula+Mayúscula y antes de "200 gramos de...".
// -------------------- INGREDIENTES --------------------
// Los ingredientes importados vienen en una sola cadena con formatos muy distintos:
//   "6 piezas de Pollo 500 gramos de Jitomate 2 piezas de Chile ancho"
//   "1 cubo de CALDO MAGGI® (10 g)      3 tazas de agua (750 ml)"
//   "5 frutillas1/2 bananaTrozos de ananáJugo de 1 naranja"
//   "Mejillones Ajo Cebolla fresca Pimiento verde Guindilla (opcional)"
// Se trocean por saltos de línea y espacios múltiples, por palabras pegadas
// ("frutillas1/2") y, palabra a palabra, antes de una cantidad o de una palabra en
// Mayúscula, salvo que vengan detrás de un enlace ("de", "con", "y"...).

const UNIDADES = 'unidad(?:es)?|tazas?|cucharadas?(?:\\s+soperas?|\\s+postre)?|cucharaditas?|cdas?\\.?|cditas?\\.?|cdtas?\\.?|' +
    'pocillos?|ud\\.?|uds\\.?|' +
    'manojos?|gr\\.?|grs\\.?|gramos?|g|kg\\.?|kilos?|ml|mililitros?|cl|l|litros?|pizcas?|dientes?|latas?|vasos?|' +
    'chorritos?|chorros?|ramitas?|ramas?|hojas?|rebanadas?|lonchas?|piezas?|sobres?|paquetes?|botes?|tarros?|' +
    'cubos?|cubitos?|pastillas?|rodajas?|puñados?|copas?|onzas?|oz|lb|libras?|trozos?|tiras?|vainas?|cabezas?|' +
    'pellizcos?|hebras?|bolsas?|potes?|envases?|tabletas?|barras?|vasitos?|tacitas?|cucharones?';
const ENLACES = new Set(['de', 'del', 'con', 'y', 'e', 'o', 'u', 'a', 'al', 'en', 'para', 'la', 'el', 'las', 'los',
    'por', 'sin', 'tipo', 'estilo', 'muy', 'bien', 'más', 'mas', 'un', 'una', 'unos', 'unas', 'cada', 'aprox.', 'aprox']);
const RX_CANTIDAD = /^(\d+([.,/]\d+)?|½|¼|¾|⅓|⅔)/;
const RX_MAYUSCULA = /^[A-ZÁÉÍÓÚÑ¿¡]/;

function splitIngredientChunk(chunk) {
    const words = chunk.split(/\s+/).filter(Boolean);
    const items = [];
    let current = [];
    const isUpperWord = w => w.length > 1 && w === w.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(w);
    words.forEach((w, i) => {
        const prev = words[i - 1];
        const prevLower = prev ? prev.toLowerCase() : '';
        const startsQty = RX_CANTIDAD.test(w);
        const startsUpper = RX_MAYUSCULA.test(w);
        const afterLink = ENLACES.has(prevLower) || /[(:]$/.test(prev || '');
        const prevIsQty = prev && (RX_CANTIDAD.test(prev) || /^(un|una|media|medio)$/i.test(prev));
        const insideCaps = isUpperWord(w) && prev && isUpperWord(prev.replace(/[®™]/g, ''));
        const prevIsUnit = prev && new RegExp(`^(${UNIDADES})$`, 'i').test(prev);
        const split = current.length > 0 && !afterLink && !prevIsQty && !prevIsUnit && !insideCaps &&
            (startsQty || startsUpper) && !/^\(/.test(w);
        if (split) {
            items.push(current.join(' '));
            current = [];
        }
        current.push(w);
    });
    if (current.length) items.push(current.join(' '));
    return items;
}

function parseIngredients(raw) {
    const seen = new Set();
    const result = [];
    String(raw ?? '')
        .replace(/[®™]/g, '')
        .replace(/^\s*ingredientes:?\s*/i, '')
        // palabras pegadas: "frutillas1/2", "lenguado1 puñado", "bananaTrozos", "azúcar1 cda."
        .replace(/([a-záéíóúüñ]\.?|\))(?=[A-ZÁÉÍÓÚÑ]|\d)/g, '$1\n')
        .split(/\n+|\s{3,}|\t+|\s+,\s+|;\s*|•/)
        .flatMap(splitIngredientChunk)
        .map(s => s.trim().replace(/^[-–*·)\],.:]+\s*/, '').replace(/[,.;]+$/, '').trim())
        .filter(s => s.length > 2 && !/^ingredientes:?$/i.test(s) && !ENLACES.has(s.toLowerCase()))
        .filter(s => ingredientParts(s).nombre.length > 1)   // fuera restos sueltos como "175 g"
        .forEach(s => {
            const key = normalizeText(s);
            if (seen.has(key)) return;
            seen.add(key);
            result.push(s);
        });
    return result;
}

// "200 gr. de pechuga de pollo (en filetes)" -> { cantidad: "200 gr.", nombre: "Pechuga de pollo" }
// "Sal y pimienta a gusto" -> { cantidad: "", nombre: "Sal y pimienta" }
function ingredientParts(line) {
    let s = String(line || '').trim().replace(/\(s\)/gi, 's');  // "cebolla(s)" -> "cebollas"
    let cantidad = '';
    const qty = s.match(new RegExp(
        `^((?:\\d+(?:[.,/]\\d+)?(?:\\s*[½¼¾⅓⅔])?|[½¼¾⅓⅔])(?:\\s+(?:\\d+/\\d+|y\\s+medi[oa]|o\\s+\\d+))?|un[oa]?|medi[oa])\\s*` +
        `((?:${UNIDADES})\\b\\.?)?\\s*(?:de\\s+|del\\s+)?`, 'i'));
    if (qty && qty[0].trim()) {
        cantidad = (qty[1] + (qty[2] ? ' ' + qty[2] : '')).trim();
        s = s.slice(qty[0].length);
    }
    const nombre = s
        .replace(/\s*\([^)]*\)\s*/g, ' ')                     // "(250 g)", "(opcional)"
        .replace(/\s*,.*$/, '')                               // ", picada finamente"
        .replace(/\s+(a gusto|al gusto|c\/n|cantidad necesaria|opcional|para decorar|para servir)\b.*$/i, '')
        // preparación: "finamente picada", "pelada y cortada en dados", "sin piel"
        .replace(/\s+(y\s+)?(pelad|picad|cortad|troce|lavad|limpi|cocid|escurrid|desmenuzad|batid|derretid|tamizad|machacad|triturad|laminad|filetead|deshuesad|finamente|sin piel|sin hueso|en (tiras|dados|rodajas|trozos|tajadas|juliana|cubos|cubitos|láminas|laminas|polvo para))\S*.*$/i, '')
        .replace(/\s+(mediano|mediana|medianos|medianas|grande|grandes|pequeño|pequeña|pequeños|pequeñas|maduro|madura|maduros|maduras)\b/gi, '')
        .replace(/\s+v\.?\s*e\.?$/i, ' virgen extra')
        .replace(/(\s+(de|del|en|y|o|con|a|al|para))+$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    const bonito = nombre === nombre.toUpperCase() ? nombre.toLowerCase() : nombre; // "CALDO DE POLLO" -> "caldo de pollo"
    return { cantidad, nombre: bonito ? bonito.charAt(0).toUpperCase() + bonito.slice(1) : '' };
}

// Texto para la lista de la compra: "Pechuga de pollo (200 gr.)"
function ingredientListName(line) {
    const { cantidad, nombre } = ingredientParts(line);
    if (!nombre) return String(line || '').trim();
    return cantidad && !/^(un[oa]?|1)$/i.test(cantidad) ? `${nombre} (${cantidad})` : nombre;
}

// Clave para comparar productos: sin cantidades, sin tildes y en singular.
// "2 Tomates", "tomate" y "Tomates (500 g)" -> "tomate"
function singularWord(w) {
    // palabras acabadas en l, n, r hacen el plural en -es: limones, tallarines, cereales, panes
    if (w.length > 4 && /[aeiou][lnr]es$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && /[aeiou]s$/.test(w)) return w.slice(0, -1);         // tomates -> tomate
    return w;
}

function shoppingKey(text) {
    const { nombre } = ingredientParts(text);
    return normalizeText(nombre || text)
        .replace(/[^a-z0-9 ]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .map(singularWord)
        .join(' ');
}

function formatSteps(steps, title) {
    let s = String(steps ?? '').trim();
    if (title && s.toLowerCase().startsWith(String(title).toLowerCase())) s = s.slice(title.length).trim();
    s = s.replace(/^preparaci[oó]n:?\s*/i, '');
    if (!s) return '<p>Sin pasos especificados.</p>';
    let parts = s.split(/\n+/);
    if (parts.length === 1) parts = s.split(/\s(?=\d{1,2}\s+[A-ZÁÉÍÓÚÑ¡¿])/);
    return parts.map(p => p.trim()).filter(Boolean).map(p => `<p>${escapeHtml(p)}</p>`).join('');
}

function ingredientChecklistHtml(items) {
    if (items.length === 0) return '<p class="hint">Sin ingredientes.</p>';
    return '<ul class="ingredient-checklist">' + items.map(i =>
        `<li><label><input type="checkbox" value="${escapeHtml(ingredientListName(i))}"><span>${escapeHtml(i)}</span></label></li>`
    ).join('') + '</ul>';
}

// -------------------- NAVEGACIÓN --------------------

function setupNavigation() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const view = tab.dataset.view;
            if (location.hash === '#' + view) showView(view);
            else location.hash = view;
        });
    });
    window.addEventListener('hashchange', () => showView(currentViewFromHash()));
    showView(currentViewFromHash());
}

function currentViewFromHash() {
    const name = location.hash.replace('#', '');
    return VIEWS.includes(name) ? name : 'semana';
}

function showView(name) {
    VIEWS.forEach(v => { $('view-' + v).hidden = v !== name; });
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
    window.scrollTo({ top: 0 });
}

function goToView(name) {
    location.hash = name;
}

// Clicks de elementos generados dinámicamente: <... data-action="x" data-id="..">
const ACTIONS = {
    'open-recipe': (el) => { randomMode = false; openRecipe(Number(el.dataset.id)); },
    'toggle-fav': (el) => toggleFavorite(Number(el.dataset.id)),
    'set-scope': (el) => setScope(el.dataset.scope),
    'filter-cat': (el) => setCategoryFilter(el.dataset.cat),
    'page': (el) => goToRecipePage(Number(el.dataset.page)),
    'slot-pick': (el) => openRecipePicker(Number(el.dataset.dia), el.dataset.tipo),
    'slot-remove': (el) => removeFromWeeklyMenu(el.dataset.key),
    'pick-recipe': (el) => pickRecipeForSlot({ id: Number(el.dataset.id), title: el.dataset.title }),
    'shop-toggle': (el) => toggleShoppingItem(Number(el.dataset.id)),
    'shop-inc': (el) => changeShoppingQuantity(Number(el.dataset.id), 1),
    'shop-dec': (el) => changeShoppingQuantity(Number(el.dataset.id), -1),
    'shop-remove': (el) => removeShoppingItem(Number(el.dataset.id)),
    'add-suggestion': (el) => addProductById(el.dataset.id),
    'habitual-add': (el) => addHabitual(el.dataset.clave),
    'fridge-add-missing': (el) => addFridgeMissing(Number(el.dataset.id)),
    'habitual-pin': (el) => toggleHabitualFijo(el.dataset.clave),
    'habitual-forget': (el) => forgetHabitual(el.dataset.clave),
    'saved-toggle': (el) => toggleSavedMenu(el.dataset.semana),
    'saved-repeat': (el) => repeatSavedMenu(el.dataset.semana),
    'saved-delete': (el) => askDeleteSavedMenu(el.dataset.semana),
    'cat-delete': (el) => askDeleteCategory(Number(el.dataset.id)),
    'product-delete': (el) => askDeleteProduct(el.dataset.id),
    'go-view': (el) => goToView(el.dataset.view)
};

function setupGlobalHandlers() {
    document.addEventListener('click', (e) => {
        const closer = e.target.closest('[data-close]');
        if (closer) {
            closeModalEl(closer.dataset.close);
            return;
        }
        if (e.target.classList.contains('modal')) {
            if (e.target.id !== 'confirmModal') closeModalEl(e.target.id);
            return;
        }
        const el = e.target.closest('[data-action]');
        if (el && ACTIONS[el.dataset.action]) {
            if (el.tagName !== 'INPUT') e.preventDefault();
            Promise.resolve(ACTIONS[el.dataset.action](el)).catch(err => {
                console.error(err);
                showToast('Algo ha fallado: ' + err.message, true);
            });
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const open = [...document.querySelectorAll('.modal')].filter(m => m.style.display === 'flex');
        // la receta se abre por encima de otros modales (nevera, menús guardados)
        const top = open.find(m => m.id === 'confirmModal') || open.find(m => m.id === 'recipeModal') || open[open.length - 1];
        if (top) closeModalEl(top.id);
    });
}

// -------------------- DATOS --------------------

async function loadCategories() {
    categories = await supabaseRequest('categoria_recetas', '?select=id,categoria&order=categoria.asc') || [];
}

async function loadFavorites() {
    try {
        favorites = await supabaseRequest('recetas_favoritas', '?select=id,receta_id') || [];
        const ids = [...new Set(favorites.map(f => f.receta_id))];
        favoriteRecipes = ids.length === 0 ? [] : await supabaseRequest(
            'recetas', `?select=id,title,url,categoria,ingredients${schema.datos ? ',tipo,oculta' : ''}&id=in.(${ids.join(',')})&order=title.asc`
        );
    } catch (e) {
        console.error('Error cargando favoritos:', e);
        favorites = [];
        favoriteRecipes = [];
    }
}

async function loadProducts() {
    products = await supabaseRequest('productos', '?select=id,nombre&order=nombre.asc') || [];
}

// -------------------- SEMANA --------------------

function setupWeekView() {
    $('weekIngredientsBtn').onclick = () => openWeekIngredients().catch(e => showToast(e.message, true));
    $('saveWeeklyMenuBtn').onclick = () => saveWeeklyMenu();
    $('openSavedMenusBtn').onclick = () => openSavedMenus();
    $('clearWeeklyMenuBtn').onclick = () => {
        if (Object.keys(currentWeekMenu).length === 0) return showToast('La semana ya está vacía');
        askConfirm('¿Vaciar el menú de esta semana?', 'Sí, vaciar', clearWeekMenu);
    };
    $('weekIngredientsAddBtn').onclick = () => addCheckedIngredients('ingredientsModalBody');
    $('fillWeekBtn').onclick = () => askFillWeek();
}

// -------------------- RELLENAR SEMANA --------------------
// Propone receta para los huecos vacíos: primero favoritas, completando con principales
// al azar; sin repetir lo de las últimas semanas guardadas y variando la categoría.

const CATEGORIAS_PESADAS = ['legumbres', 'arroces', 'pastas']; // mejor a mediodía
const MAX_POR_CATEGORIA = 3;

function emptyWeekSlots() {
    const slots = [];
    DIAS.forEach(d => TIPOS_COMIDA.forEach(tipo => {
        if (!currentWeekMenu[`${d.id}_${tipo}`]) slots.push({ dia: d.id, tipo });
    }));
    return slots;
}

function askFillWeek() {
    const slots = emptyWeekSlots();
    if (slots.length === 0) return showToast('La semana ya está completa');
    askConfirm(
        `¿Rellenar ${slots.length === 1 ? 'el hueco vacío' : `los ${slots.length} huecos vacíos`} con sugerencias?\n` +
        'Se eligen sobre todo entre vuestras favoritas, sin repetir las últimas semanas. Luego puedes cambiar cualquiera.',
        '✨ Rellenar', () => fillWeek(slots), { danger: false }
    );
}

async function recentMenuRecipeIds(weeks = 3) {
    try {
        const rows = await supabaseRequest('semanas_guardadas', `?select=semana,receta_id&order=semana.desc&limit=${weeks * 14}`) || [];
        if (rows.length === 0) return [];
        const minSemana = rows[0].semana - weeks + 1;
        return rows.filter(r => r.semana >= minSemana).map(r => r.receta_id);
    } catch {
        return [];
    }
}

// Elige una receta para cada hueco. Pura (sin red) para poder probarla aparte.
// plan: {`${dia}_${tipo}`: {categoria}} con lo ya planificado; candidates: en orden de preferencia.
function chooseWeekRecipes(slots, candidates, plan, catName) {
    const taken = new Set();
    const counts = {};
    Object.values(plan).forEach(e => {
        const c = catName(e.categoria);
        counts[c] = (counts[c] || 0) + 1;
    });
    const catAt = (dia, tipo) => plan[`${dia}_${tipo}`] ? catName(plan[`${dia}_${tipo}`].categoria) : null;
    const result = [];

    for (const slot of slots) {
        const otherMeal = catAt(slot.dia, slot.tipo === 'Comida' ? 'Cena' : 'Comida');
        const yesterday = catAt(slot.dia - 1, slot.tipo);
        const fits = (r, strict) => {
            const c = catName(r.categoria);
            if (r.categoria == null) return true; // sin categoría: no sabemos, no se restringe
            if (c === otherMeal || c === yesterday) return false;
            if ((counts[c] || 0) >= MAX_POR_CATEGORIA) return false;
            if (strict && slot.tipo === 'Cena' && CATEGORIAS_PESADAS.includes(c.toLowerCase())) return false;
            return true;
        };
        const pick = candidates.find(r => !taken.has(r.id) && fits(r, true))
            || candidates.find(r => !taken.has(r.id) && fits(r, false))
            || candidates.find(r => !taken.has(r.id));
        if (!pick) break;
        taken.add(pick.id);
        const c = catName(pick.categoria);
        counts[c] = (counts[c] || 0) + 1;
        plan[`${slot.dia}_${slot.tipo}`] = { categoria: pick.categoria };
        result.push({ ...slot, recipe: pick });
    }
    return result;
}

async function fillWeek(slots) {
    const btn = $('fillWeekBtn');
    btn.disabled = true;
    btn.textContent = '✨ Buscando ideas…';
    try {
        const used = new Set([
            ...Object.values(currentWeekMenu).map(e => e.receta_id),
            ...await recentMenuRecipeIds()
        ]);
        const favs = shuffle(favoriteRecipes.filter(r => isMenuRecipe(r) && !used.has(r.id)));
        const extra = (await randomServerRecipes(slots.length * 3).catch(() => []))
            .filter(r => !used.has(r.id) && !isFavorite(r.id));
        // ~60 % favoritas si hay suficientes; el resto, descubrimientos.
        const nFavs = Math.min(favs.length, Math.ceil(slots.length * 0.6));
        const candidates = [...favs.slice(0, nFavs), ...extra, ...favs.slice(nFavs)];
        const plan = {};
        Object.entries(currentWeekMenu).forEach(([k, e]) => { plan[k] = { categoria: e.categoria }; });
        const chosen = chooseWeekRecipes(slots, candidates, plan, categoryName);
        if (chosen.length === 0) return showToast('No hay recetas suficientes para sugerir. Marca algunas favoritas.', true);

        const inserted = await supabaseRequest('menu_semanal_actual', '', {
            method: 'POST',
            body: JSON.stringify(chosen.map(c => ({ dia: c.dia, tipo_comida: c.tipo, receta_id: c.recipe.id })))
        }) || [];
        chosen.forEach(c => {
            const row = inserted.find(r => r.dia === c.dia && r.tipo_comida === c.tipo);
            currentWeekMenu[`${c.dia}_${c.tipo}`] = {
                receta_id: c.recipe.id, title: c.recipe.title, categoria: c.recipe.categoria, draftId: row && row.id
            };
        });
        renderWeek();
        showToast(`✨ ${chosen.length} ${chosen.length === 1 ? 'hueco rellenado' : 'huecos rellenados'}. Toca × para cambiar alguno.`);
    } catch (e) {
        showToast('No se pudo rellenar la semana: ' + e.message, true);
        await loadCurrentWeekMenuDraft({ keepOnError: true });
        renderWeek();
    } finally {
        btn.disabled = false;
        btn.textContent = '✨ Rellenar huecos';
    }
}

// keepOnError: en las recargas en segundo plano un fallo de red no debe vaciar la semana.
async function loadCurrentWeekMenuDraft({ keepOnError = false } = {}) {
    try {
        const data = await supabaseRequest('menu_semanal_actual', '?select=id,dia,tipo_comida,receta_id,recetas(title,categoria)');
        currentWeekMenu = {};
        (data || []).forEach(row => {
            currentWeekMenu[`${row.dia}_${row.tipo_comida}`] = {
                receta_id: row.receta_id,
                title: row.recetas ? row.recetas.title : 'Receta eliminada',
                categoria: row.recetas ? row.recetas.categoria : null,
                draftId: row.id
            };
        });
    } catch (e) {
        console.error('Error cargando el menú semanal:', e);
        if (!keepOnError) currentWeekMenu = {};
    }
}

function renderWeek() {
    $('weeklyGrid').innerHTML = generateWeeklyGridHtml(currentWeekMenu, false);
    const filled = Object.keys(currentWeekMenu).length;
    const total = DIAS.length * TIPOS_COMIDA.length;
    $('weekProgress').textContent = filled === 0
        ? 'Toca «+ Elegir» en cualquier hueco para planificar la semana.'
        : `${filled} de ${total} comidas planificadas`;

    const today = todayDiaId();
    $('todayCard').innerHTML = `<h3>Hoy, ${diaNombre(today).toLowerCase()}</h3>` +
        TIPOS_COMIDA.map(tipo => slotHtml(today, tipo, currentWeekMenu, false)).join('');
}

function slotHtml(dia, tipo, menuData, readOnly) {
    const key = `${dia}_${tipo}`;
    const entry = menuData[key];
    let body;
    if (entry) {
        body = `<button class="slot-filled" type="button" data-action="open-recipe" data-id="${entry.receta_id}">${escapeHtml(entry.title)}</button>` +
            (readOnly ? '' : `<button class="slot-remove" type="button" data-action="slot-remove" data-key="${key}" aria-label="Quitar ${escapeHtml(entry.title)}">×</button>`);
    } else {
        body = readOnly
            ? '<span class="slot-empty-text">—</span>'
            : `<button class="slot-empty" type="button" data-action="slot-pick" data-dia="${dia}" data-tipo="${tipo}">+ Elegir</button>`;
    }
    return `<div class="slot"><span class="slot-label">${tipo}</span><div class="slot-body">${body}</div></div>`;
}

function generateWeeklyGridHtml(menuData, readOnly) {
    const today = todayDiaId();
    return '<div class="week-grid">' + DIAS.map(d => {
        const isToday = !readOnly && d.id === today;
        return `<div class="day-card${isToday ? ' today' : ''}"><h4>${d.nombre}${isToday ? ' <span class="today-tag">Hoy</span>' : ''}</h4>` +
            TIPOS_COMIDA.map(tipo => slotHtml(d.id, tipo, menuData, readOnly)).join('') + '</div>';
    }).join('') + '</div>';
}

async function addToCurrentWeekMenu(dia, tipo, recipe) {
    const key = `${dia}_${tipo}`;
    const existing = currentWeekMenu[key];
    if (existing && existing.draftId) {
        await supabaseRequest('menu_semanal_actual', `?id=eq.${existing.draftId}`, {
            method: 'PATCH',
            body: JSON.stringify({ receta_id: recipe.id })
        });
        currentWeekMenu[key] = { receta_id: recipe.id, title: recipe.title, categoria: recipe.categoria, draftId: existing.draftId };
    } else {
        const inserted = await supabaseRequest('menu_semanal_actual', '', {
            method: 'POST',
            body: JSON.stringify([{ dia, tipo_comida: tipo, receta_id: recipe.id }])
        });
        currentWeekMenu[key] = { receta_id: recipe.id, title: recipe.title, categoria: recipe.categoria, draftId: inserted[0].id };
    }
    renderWeek();
    showToast(`«${recipe.title}» → ${diaNombre(dia)}, ${tipo.toLowerCase()}`);
}

async function removeFromWeeklyMenu(key) {
    const entry = currentWeekMenu[key];
    if (!entry) return;
    if (entry.draftId) await supabaseRequest('menu_semanal_actual', `?id=eq.${entry.draftId}`, { method: 'DELETE' });
    delete currentWeekMenu[key];
    renderWeek();
}

async function clearWeekMenu() {
    await supabaseRequest('menu_semanal_actual', '?id=not.is.null', { method: 'DELETE' });
    currentWeekMenu = {};
    renderWeek();
}

async function saveWeeklyMenu() {
    const entries = Object.entries(currentWeekMenu);
    if (entries.length === 0) return showToast('Añade al menos una receta antes de guardar la semana');
    try {
        const last = await supabaseRequest('semanas_guardadas', '?select=semana&order=semana.desc&limit=1');
        const nextSemana = last && last.length > 0 ? last[0].semana + 1 : 1;
        const rows = entries.map(([key, val]) => {
            const [dia, tipo] = key.split('_');
            return { semana: nextSemana, dia: Number(dia), tipo_comida: tipo, receta_id: val.receta_id };
        });
        await supabaseRequest('semanas_guardadas', '', { method: 'POST', body: JSON.stringify(rows) });
        askConfirm('Menú guardado en el historial ✅\n¿Vaciar el calendario para empezar una semana nueva?',
            'Sí, empezar semana nueva', clearWeekMenu, { danger: false, noLabel: 'No, mantenerlo' });
    } catch (e) {
        showToast('No se pudo guardar el menú: ' + e.message, true);
    }
}

async function openWeekIngredients() {
    const ids = [...new Set(Object.values(currentWeekMenu).map(e => e.receta_id).filter(Boolean))];
    if (ids.length === 0) return showToast('Primero añade recetas a la semana');
    const data = await supabaseRequest('recetas', `?select=id,title,ingredients&id=in.(${ids.join(',')})&order=title.asc`) || [];
    $('ingredientsModalBody').innerHTML = data.map(r =>
        `<fieldset class="ingredient-group"><legend>${escapeHtml(r.title)}</legend>${ingredientChecklistHtml(parseIngredients(r.ingredients))}</fieldset>`
    ).join('');
    openModalEl('ingredientsModal');
}

async function addCheckedIngredients(containerId) {
    const checked = [...$(containerId).querySelectorAll('input[type="checkbox"]:checked')];
    if (checked.length === 0) return showToast('Marca primero los ingredientes que te faltan');
    try {
        await addShoppingTexts(checked.map(i => i.value));
        checked.forEach(i => { i.checked = false; });
        showToast(`🛒 ${checked.length} ${checked.length === 1 ? 'ingrediente añadido' : 'ingredientes añadidos'} a la lista`);
    } catch (e) {
        showToast('No se pudieron añadir: ' + e.message, true);
    }
}

// -------------------- ELEGIR RECETA PARA UN HUECO --------------------

function setupPickerModal() {
    $('pickerSearch').addEventListener('input', () => {
        clearTimeout(pickerSearchTimer);
        pickerSearchToken++;
        if ($('pickerSearch').value.trim()) $('pickerResults').innerHTML = '<p class="hint">Buscando…</p>';
        pickerSearchTimer = setTimeout(renderPickerResults, 250);
    });
    $('pickerRandomBtn').onclick = async () => {
        try {
            const r = await getRandomRecipe();
            if (r) await pickRecipeForSlot(r);
        } catch (e) {
            showToast(e.message, true);
        }
    };
}

function openRecipePicker(dia, tipo) {
    pickerSlot = { dia, tipo };
    $('pickerTitle').textContent = `${diaNombre(dia)} · ${tipo}`;
    $('pickerSearch').value = '';
    renderPickerResults();
    openModalEl('recipePickerModal');
    $('pickerSearch').focus();
}

function pickerItemHtml(r) {
    const fav = isFavorite(r.id) ? '⭐ ' : '';
    return `<button class="picker-item" type="button" data-action="pick-recipe" data-id="${r.id}" data-title="${escapeHtml(r.title)}">` +
        `<span>${fav}${escapeHtml(r.title)}</span><small>${escapeHtml(categoryName(r.categoria))}</small></button>`;
}

async function renderPickerResults() {
    const list = $('pickerResults');
    const query = $('pickerSearch').value.trim();
    const token = ++pickerSearchToken;
    if (!query) {
        list.innerHTML = favoriteRecipes.length
            ? '<p class="picker-section">⭐ Tus favoritas</p>' + favoriteRecipes.map(pickerItemHtml).join('')
            : '<p class="hint">Escribe para buscar entre todas las recetas, o pulsa 🎲.</p>';
        return;
    }
    list.innerHTML = '<p class="hint">Buscando…</p>';
    try {
        const params = applyCatalogFilters(new URLSearchParams({
            select: 'id,title,categoria',
            order: 'title.asc',
            limit: '40',
            title: 'imatch.' + accentInsensitivePattern(query)
        }), { sinTipos: ['bebida', 'salsa'] });
        const data = await supabaseRequest('recetas', '?' + params) || [];
        if (token !== pickerSearchToken) return;
        data.sort((a, b) => Number(isFavorite(b.id)) - Number(isFavorite(a.id)));
        list.innerHTML = data.length ? data.map(pickerItemHtml).join('') : '<p class="hint">No hay recetas con ese nombre.</p>';
    } catch (e) {
        if (token === pickerSearchToken) list.innerHTML = '<p class="hint">No se pudo buscar. Revisa la conexión.</p>';
    }
}

async function pickRecipeForSlot(recipe) {
    if (!pickerSlot) return;
    await addToCurrentWeekMenu(pickerSlot.dia, pickerSlot.tipo, recipe);
    closeModalEl('recipePickerModal');
}

// -------------------- RECETAS (catálogo) --------------------

function setupRecipesView() {
    $('searchInput').addEventListener('input', () => {
        clearTimeout(recipeSearchTimer);
        recipeSearchTimer = setTimeout(() => {
            currentRecipePage = 0;
            refreshRecipes();
        }, 300);
    });
    $('searchMode').addEventListener('change', () => {
        currentRecipePage = 0;
        if ($('searchInput').value.trim()) refreshRecipes();
    });
    $('randomRecipeBtn').onclick = () => suggestRandomRecipe();
    $('openAddRecipeBtn').onclick = () => {
        renderCategorySelects();
        $('importStatus').textContent = '';
        openModalEl('addRecipeModal');
        $('importUrl').focus();
    };
    $('openFridgeBtn').onclick = () => {
        openModalEl('fridgeModal');
        $('fridgeInput').focus();
    };
    $('fridgeForm').addEventListener('submit', (e) => {
        e.preventDefault();
        searchFridge().catch(err => {
            $('fridgeResults').innerHTML = '<p class="hint">No se pudo buscar. Revisa la conexión.</p>';
            console.error(err);
        });
    });
}

// -------------------- ¿QUÉ HAY EN LA NEVERA? --------------------
// Recetas que usan lo que tienes, ordenadas por lo poco que te falta. Lo básico de
// despensa no cuenta como "falta".

const BASICOS_DESPENSA = new RegExp('^(sal|sal gruesa|sal fina|pimienta( negra| blanca)?|aceite|agua|vinagre|azucar|ajo|' +
    'especia|oregano|comino|pimenton|perejil|laurel|tomillo|romero|canela|nuez moscada|curry|colorante|azafran|' +
    'hielo|cubito de hielo|caldo|pastilla de caldo|edulcorante|levadura|bicarbonato|harina|maicena|mantequilla|' +
    'aceite de oliva|aceite de girasol|aceite vegetal|sal y pimienta|pimienta y sal)\\b');
let fridgeMissing = {}; // id receta -> ingredientes que faltan (para "Añadir lo que falta")

function fridgeItems(text) {
    return [...new Set(text.split(/,|\s+y\s+|\n/).map(t => shoppingKey(t)).filter(k => k.length > 1))].slice(0, 6);
}

// Puntúa una receta. Pura: se puede probar sin red.
function scoreFridgeRecipe(recipe, items) {
    const lines = parseIngredients(recipe.ingredients);
    const titleKey = ' ' + shoppingKey(recipe.title) + ' ';
    const used = new Set();
    const missing = [];
    lines.forEach(line => {
        const key = ' ' + shoppingKey(line) + ' ';
        const hits = items.filter(it => key.includes(' ' + it + ' ') || key.includes(' ' + it));
        if (hits.length) hits.forEach(h => used.add(h));
        else if (!BASICOS_DESPENSA.test(key.trim()) && !/\b(opcional|a gusto|al gusto)\b/i.test(line)) missing.push(line);
    });
    items.forEach(it => { if (titleKey.includes(' ' + it)) used.add(it); });
    return {
        recipe,
        used: items.filter(it => used.has(it)),
        missing,
        inTitle: items.filter(it => titleKey.includes(' ' + it)).length,
        total: lines.length
    };
}

function rankFridge(recipes, items) {
    return recipes
        .map(r => scoreFridgeRecipe(r, items))
        .filter(s => s.total > 0 && s.used.length > 0)
        .sort((a, b) => b.used.length - a.used.length || a.missing.length - b.missing.length ||
            b.inTitle - a.inTitle || a.total - b.total);
}

async function searchFridge() {
    const items = fridgeItems($('fridgeInput').value);
    const box = $('fridgeResults');
    if (items.length === 0) {
        box.innerHTML = '<p class="hint">Escribe al menos un ingrediente.</p>';
        return;
    }
    box.innerHTML = '<p class="hint">Buscando…</p>';
    const query = (subset, limit) => {
        const p = applyCatalogFilters(new URLSearchParams({ select: 'id,title,categoria,ingredients', limit: String(limit) }),
            { tipos: ['principal'] });
        subset.forEach(it => p.append('ingredients', 'imatch.' + accentInsensitivePattern(it)));
        return supabaseRequest('recetas', '?' + p).then(d => d || []);
    };
    // Primero las que llevan todo; si salen pocas, también las que llevan alguno.
    let found = await query(items, 300);
    if (found.length < 25 && items.length > 1) {
        const extra = await Promise.all(items.map(it => query([it], 120)));
        const seen = new Set(found.map(r => r.id));
        extra.flat().forEach(r => { if (!seen.has(r.id)) { seen.add(r.id); found.push(r); } });
    }
    const ranked = rankFridge(found, items).slice(0, 30);
    fridgeMissing = {};
    if (ranked.length === 0) {
        box.innerHTML = '<p class="hint">No he encontrado recetas con eso. Prueba con menos ingredientes o con otro nombre (p. ej. «patata» en vez de «papas»).</p>';
        return;
    }
    box.innerHTML = `<p class="hint">${ranked.length} ideas, primero las que usan más de lo que tienes y piden menos compra.</p>` +
        ranked.map(s => {
            fridgeMissing[s.recipe.id] = s.missing;
            const faltan = s.missing.map(l => ingredientParts(l).nombre || l);
            return `<article class="fridge-item">` +
                `<button class="fridge-title" type="button" data-action="open-recipe" data-id="${s.recipe.id}">${isFavorite(s.recipe.id) ? '⭐ ' : ''}${escapeHtml(s.recipe.title)}</button>` +
                `<small class="badge">${escapeHtml(categoryName(s.recipe.categoria))}</small>` +
                `<p class="fridge-uses">✅ Usa: ${escapeHtml(s.used.join(', '))}</p>` +
                (faltan.length
                    ? `<p class="fridge-missing">🛒 Te falta: ${escapeHtml(faltan.join(', '))}</p>` +
                      `<button class="link-btn" type="button" data-action="fridge-add-missing" data-id="${s.recipe.id}">+ Añadir lo que falta a la lista</button>`
                    : '<p class="fridge-missing ok">🎉 ¡Tienes todo lo necesario!</p>') +
                `</article>`;
        }).join('');
}

async function addFridgeMissing(id) {
    const lines = fridgeMissing[id] || [];
    if (lines.length === 0) return;
    await addShoppingTexts(lines.map(ingredientListName));
    showToast(`🛒 ${lines.length} ${lines.length === 1 ? 'ingrediente añadido' : 'ingredientes añadidos'} a la lista`);
}

function renderScopeFilters() {
    const scopes = [
        { id: 'favoritas', label: `⭐ Favoritas (${favorites.length})` },
        ...(schema.propia ? [{ id: 'propias', label: '👤 Mis recetas' }] : []),
        { id: 'todas', label: allRecipesCount ? `📚 Todas (${allRecipesCount.toLocaleString('es-ES')})` : '📚 Todas' },
        ...(schema.datos ? [{ id: 'ocultas', label: '🙈 Ocultas' }] : [])
    ];
    $('scopeFilters').innerHTML = scopes.map(s =>
        `<button type="button" class="${s.id === currentScope ? 'active' : ''}" data-action="set-scope" data-scope="${s.id}">${s.label}</button>`
    ).join('');
}

function renderCategoryFilters() {
    const all = [{ id: 'Todas', categoria: 'Todas' }, ...categories];
    $('categoryFilters').innerHTML = all.map(c =>
        `<button type="button" class="${String(c.id) === String(currentCategoryFilter) ? 'active' : ''}" data-action="filter-cat" data-cat="${c.id}">${escapeHtml(c.categoria)}</button>`
    ).join('');
}

function renderCategorySelects() {
    const options = categories.map(c => `<option value="${c.id}">${escapeHtml(c.categoria)}</option>`).join('');
    $('newRecipeCategory').innerHTML = options;
    $('editRecipeCategory').innerHTML = '<option value="">Sin categoría</option>' + options;
}

function setScope(scope) {
    currentScope = scope;
    currentRecipePage = 0;
    renderScopeFilters();
    refreshRecipes();
}

function setCategoryFilter(cat) {
    currentCategoryFilter = cat === 'Todas' ? 'Todas' : Number(cat);
    currentRecipePage = 0;
    renderCategoryFilters();
    refreshRecipes();
}

async function refreshRecipes() {
    const token = ++recipeLoadToken;
    if (currentScope === 'favoritas') {
        renderRecipes();
        return;
    }
    $('recipesGrid').setAttribute('aria-busy', 'true');
    try {
        await loadRecipes();
        if (token !== recipeLoadToken) return;
        renderRecipes();
    } catch (e) {
        if (token !== recipeLoadToken) return;
        console.error('Error cargando recetas:', e);
        $('recipesGrid').innerHTML = '<div class="empty-state"><p>No se pudieron cargar las recetas.</p></div>';
    } finally {
        $('recipesGrid').removeAttribute('aria-busy');
    }
}

async function loadRecipes() {
    const search = $('searchInput').value.trim();
    const params = new URLSearchParams({
        select: 'id,title,url,categoria',
        order: 'title.asc',
        offset: String(currentRecipePage * RECIPES_PAGE_SIZE),
        limit: String(RECIPES_PAGE_SIZE)
    });
    if (currentCategoryFilter !== 'Todas') params.set('categoria', `eq.${currentCategoryFilter}`);
    if (currentScope === 'propias') params.set('propia', 'eq.true');
    const pattern = accentInsensitivePattern(search);
    if (pattern) params.set($('searchMode').value === 'ingredients' ? 'ingredients' : 'title', 'imatch.' + pattern);
    applyCatalogFilters(params, { ocultas: currentScope === 'ocultas' });

    const { rows, total } = await supabaseCount('recetas', params);
    recipes = rows;
    totalRecipes = total;
    if (currentScope === 'todas' && !pattern && currentCategoryFilter === 'Todas' && allRecipesCount !== total) {
        allRecipesCount = total;
        renderScopeFilters();
    }
}

function visibleRecipes() {
    if (currentScope !== 'favoritas') return recipes;
    const query = $('searchInput').value.trim();
    const byIngredients = $('searchMode').value === 'ingredients';
    return favoriteRecipes.filter(r =>
        (currentCategoryFilter === 'Todas' || r.categoria === currentCategoryFilter) &&
        matchesSearch(byIngredients ? r.ingredients : r.title, query)
    );
}

function renderRecipes() {
    const grid = $('recipesGrid');
    const list = visibleRecipes();
    const isFavScope = currentScope === 'favoritas';
    const count = isFavScope ? list.length : totalRecipes;
    $('recipesCount').textContent = count ? `${count.toLocaleString('es-ES')} ${count === 1 ? 'receta' : 'recetas'}` : '';

    if (list.length === 0) {
        if (isFavScope && favorites.length === 0) {
            grid.innerHTML = '<div class="empty-state"><p>Aún no tienes favoritas.</p>' +
                '<p>Busca en <button class="link-btn" type="button" data-action="set-scope" data-scope="todas">todas las recetas</button> y marca con ☆ las que os gusten.</p></div>';
        } else if (isFavScope) {
            grid.innerHTML = '<div class="empty-state"><p>Ninguna favorita coincide.</p>' +
                '<p><button class="link-btn" type="button" data-action="set-scope" data-scope="todas">Buscar en todas las recetas</button></p></div>';
        } else {
            grid.innerHTML = '<div class="empty-state"><p>No hay recetas que coincidan.</p></div>';
        }
    } else {
        grid.innerHTML = list.map(recipeCardHtml).join('');
    }
    renderRecipePagination(isFavScope);
}

function recipeCardHtml(r) {
    const fav = isFavorite(r.id);
    return `<article class="card" data-action="open-recipe" data-id="${r.id}" tabindex="0">` +
        `<div class="card-top"><span class="badge">${escapeHtml(categoryName(r.categoria))}</span>` +
        `<button class="favorite-btn ${fav ? 'active' : ''}" type="button" data-action="toggle-fav" data-id="${r.id}" ` +
        `aria-label="${fav ? 'Quitar de favoritas' : 'Añadir a favoritas'}">${fav ? '⭐' : '☆'}</button></div>` +
        `<h3>${escapeHtml(r.title)}</h3></article>`;
}

function renderRecipePagination(hide) {
    const pagination = $('recipePagination');
    const pageCount = Math.ceil(totalRecipes / RECIPES_PAGE_SIZE);
    if (hide || pageCount <= 1) {
        pagination.innerHTML = '';
        return;
    }
    pagination.innerHTML =
        `<button class="btn btn-secondary" type="button" data-action="page" data-page="${currentRecipePage - 1}" ${currentRecipePage === 0 ? 'disabled' : ''}>Anterior</button>` +
        `<span>Página ${currentRecipePage + 1} de ${pageCount}</span>` +
        `<button class="btn btn-secondary" type="button" data-action="page" data-page="${currentRecipePage + 1}" ${currentRecipePage >= pageCount - 1 ? 'disabled' : ''}>Siguiente</button>`;
}

async function goToRecipePage(page) {
    currentRecipePage = page;
    await refreshRecipes();
    $('view-recetas').scrollIntoView({ behavior: 'smooth' });
}

// Tarjetas accesibles con teclado
document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('card')) {
        e.preventDefault();
        e.target.click();
    }
});

// -------------------- RECETA ALEATORIA --------------------

// n platos principales al azar del servidor (sin ocultas ni Thermomix si está desactivado).
async function randomServerRecipes(n) {
    const filters = () => applyCatalogFilters(new URLSearchParams(), { tipos: ['principal'] });
    const key = filters().toString();
    if (randomPool.key !== key) {
        const p = filters();
        p.set('select', 'id');
        p.set('limit', '1');
        const { total } = await supabaseCount('recetas', p);
        randomPool = { key, total };
    }
    if (!randomPool.total) return [];
    const offsets = new Set();
    while (offsets.size < Math.min(n, randomPool.total)) offsets.add(Math.floor(Math.random() * randomPool.total));
    const rows = await Promise.all([...offsets].map(offset => {
        const p = filters();
        p.set('select', 'id,title,categoria');
        p.set('order', 'id.asc');
        p.set('offset', String(offset));
        p.set('limit', '1');
        return supabaseRequest('recetas', '?' + p).then(d => d && d[0]);
    }));
    return rows.filter(Boolean);
}

async function getRandomRecipe() {
    const favs = favoriteRecipes.filter(isMenuRecipe);
    const useFavorites = favs.length > 0 && Math.random() < (favs.length >= 5 ? 0.7 : 0.5);
    if (useFavorites) return favs[Math.floor(Math.random() * favs.length)];
    const [recipe] = await randomServerRecipes(1);
    return recipe || favs[0] || null;
}

async function suggestRandomRecipe() {
    try {
        const r = await getRandomRecipe();
        if (!r) return;
        randomMode = true;
        await openRecipe(r.id);
    } catch (e) {
        showToast('No se pudo sugerir una receta: ' + e.message, true);
    }
}

// -------------------- MODAL DE RECETA --------------------

function setupRecipeModal() {
    $('modalWeeklyDay').innerHTML = DIAS.map(d => `<option value="${d.id}">${d.nombre}</option>`).join('');

    $('modalAddToWeeklyBtn').onclick = () => {
        if (!currentRecipe) return;
        const dia = Number($('modalWeeklyDay').value);
        const tipo = $('modalWeeklyMealType').value;
        addToCurrentWeekMenu(dia, tipo, currentRecipe).catch(e => showToast('No se pudo añadir: ' + e.message, true));
    };
    $('modalAddIngredientsBtn').onclick = () => addCheckedIngredients('modalIngredients');
    $('modalFavBtn').onclick = () => currentRecipe && toggleFavorite(currentRecipe.id);
    $('modalRandomAgainBtn').onclick = () => suggestRandomRecipe();
    $('modalHideBtn').onclick = () => toggleRecipeHidden().catch(e => showToast('No se pudo cambiar: ' + e.message, true));
    $('modalNotes').addEventListener('input', () => {
        if (!currentRecipe) return;
        const id = currentRecipe.id;
        const value = $('modalNotes').value;
        currentRecipe.notas = value;
        $('modalNotesStatus').textContent = 'Guardando…';
        clearTimeout(notesTimer);
        notesTimer = setTimeout(() => saveRecipeNotes(id, value), 900);
    });

    $('saveRecipeTitleBtn').onclick = async () => {
        const title = $('editRecipeTitle').value.trim();
        if (!currentRecipe || !title) return;
        try {
            await supabaseRequest('recetas', `?id=eq.${currentRecipe.id}`, { method: 'PATCH', body: JSON.stringify({ title }) });
            currentRecipe.title = title;
            $('modalTitle').innerText = title;
            await refreshAfterRecipeChange();
            showToast('Nombre actualizado');
        } catch (e) {
            showToast('No se pudo actualizar el nombre: ' + e.message, true);
        }
    };
    $('editRecipeTitle').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') $('saveRecipeTitleBtn').click();
    });
    $('editRecipeCategory').addEventListener('change', async (e) => {
        if (!currentRecipe) return;
        const categoria = e.target.value ? Number(e.target.value) : null;
        try {
            await supabaseRequest('recetas', `?id=eq.${currentRecipe.id}`, { method: 'PATCH', body: JSON.stringify({ categoria }) });
            currentRecipe.categoria = categoria;
            $('modalCategory').innerText = categoryName(categoria);
            await refreshAfterRecipeChange();
            showToast('Categoría actualizada');
        } catch (err) {
            showToast('No se pudo actualizar la categoría: ' + err.message, true);
        }
    });
    $('deleteRecipeBtn').onclick = () => {
        if (!currentRecipe) return;
        const recipe = currentRecipe;
        askConfirm(`¿Eliminar la receta «${recipe.title}»? Esta acción no se puede deshacer.`, 'Sí, eliminar', async () => {
            await supabaseRequest('recetas_favoritas', `?receta_id=eq.${recipe.id}`, { method: 'DELETE' });
            await supabaseRequest('menu_semanal_actual', `?receta_id=eq.${recipe.id}`, { method: 'DELETE' });
            await supabaseRequest('semanas_guardadas', `?receta_id=eq.${recipe.id}`, { method: 'DELETE' });
            await supabaseRequest('recetas', `?id=eq.${recipe.id}`, { method: 'DELETE' });
            closeModalEl('recipeModal');
            await refreshAfterRecipeChange();
            showToast('Receta eliminada');
        });
    };
}

async function openRecipe(id) {
    let detail;
    try {
        detail = await supabaseRequest('recetas', `?id=eq.${id}&select=id,title,url,ingredients,steps,categoria${schema.datos ? ',oculta,notas' : ''}`);
    } catch (e) {
        showToast('No se pudo cargar la receta: ' + e.message, true);
        return;
    }
    const recipe = detail && detail[0];
    if (!recipe) return showToast('Esa receta ya no existe', true);
    currentRecipe = recipe;

    $('modalTitle').innerText = recipe.title;
    $('modalCategory').innerText = categoryName(recipe.categoria);
    updateModalFavButton();
    updateModalHidden();
    $('modalNotesPanel').hidden = !schema.datos;
    $('modalNotes').value = recipe.notas || '';
    $('modalNotesStatus').textContent = '';
    $('modalRandomAgainBtn').hidden = !randomMode;
    $('modalWeeklyDay').value = String(todayDiaId());
    $('modalWeeklyMealType').value = new Date().getHours() >= 17 ? 'Cena' : 'Comida';
    $('modalIngredients').innerHTML = ingredientChecklistHtml(parseIngredients(recipe.ingredients));
    $('modalSteps').innerHTML = formatSteps(recipe.steps, recipe.title);
    $('modalUrlWrapper').innerHTML = /^https?:\/\//i.test(recipe.url || '')
        ? `<a href="${escapeHtml(recipe.url)}" target="_blank" rel="noopener">🌐 Ver receta original</a>` : '';

    renderCategorySelects();
    $('editRecipeTitle').value = recipe.title;
    $('editRecipeCategory').value = recipe.categoria == null ? '' : String(recipe.categoria);
    document.querySelector('.recipe-edit').open = false;

    openModalEl('recipeModal');
    document.querySelector('#recipeModal .modal-content').scrollTop = 0;
}

function updateModalFavButton() {
    if (!currentRecipe) return;
    const fav = isFavorite(currentRecipe.id);
    const btn = $('modalFavBtn');
    btn.textContent = fav ? '⭐' : '☆';
    btn.classList.toggle('active', fav);
    btn.setAttribute('aria-label', fav ? 'Quitar de favoritas' : 'Añadir a favoritas');
}

function updateModalHidden() {
    const btn = $('modalHideBtn');
    btn.hidden = !schema.datos || !currentRecipe;
    if (btn.hidden) return;
    const hidden = Boolean(currentRecipe.oculta);
    btn.textContent = hidden ? '👁️ Volver a mostrar' : '👎 No me interesa';
    btn.setAttribute('aria-pressed', String(hidden));
    $('modalHiddenNotice').hidden = !hidden;
}

async function toggleRecipeHidden() {
    if (!currentRecipe) return;
    const recipe = currentRecipe;
    const oculta = !recipe.oculta;
    await supabaseRequest('recetas', `?id=eq.${recipe.id}`, { method: 'PATCH', body: JSON.stringify({ oculta }) });
    recipe.oculta = oculta;
    const fav = favoriteRecipes.find(r => r.id === recipe.id);
    if (fav) fav.oculta = oculta;
    randomPool.key = null;
    refreshRecipes();
    if (oculta && randomMode) {
        showToast('🙈 Oculta. Ahí va otra sugerencia…');
        return suggestRandomRecipe();
    }
    updateModalHidden();
    showToast(oculta ? '🙈 Oculta. Puedes recuperarla en «Recetas → Ocultas».' : '👁️ La receta vuelve a mostrarse');
}

async function saveRecipeNotes(id, value) {
    const notas = value.trim() || null;
    const stillOpen = () => currentRecipe && currentRecipe.id === id;
    try {
        await supabaseRequest('recetas', `?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ notas }) });
        if (stillOpen()) $('modalNotesStatus').textContent = notas ? 'Guardado ✓' : 'Nota borrada';
    } catch (e) {
        if (stillOpen()) $('modalNotesStatus').textContent = '';
        showToast('No se pudo guardar la nota: ' + e.message, true);
    }
}

async function refreshAfterRecipeChange() {
    await Promise.all([loadFavorites(), loadCurrentWeekMenuDraft()]);
    renderScopeFilters();
    renderWeek();
    await refreshRecipes();
}

// -------------------- AÑADIR RECETA --------------------

// -------------------- IMPORTAR DESDE UNA WEB --------------------
// La Edge Function supabase/functions/importar-receta lee la página (el navegador no
// puede, por CORS) y devuelve título, ingredientes y pasos para revisar antes de guardar.

async function importRecipeFromUrl() {
    const url = $('importUrl').value.trim();
    const status = $('importStatus');
    if (!/^https?:\/\/\S+\.\S+/i.test(url)) {
        status.textContent = 'Pega un enlace completo, que empiece por https://';
        return;
    }
    // ¿Ya la tenemos? (las 18.000 importadas vienen de recetasgratis y recetas.com)
    try {
        const existing = await supabaseRequest('recetas', `?select=id,title&url=eq.${encodeURIComponent(url)}&limit=1`);
        if (existing && existing[0]) {
            status.textContent = '';
            closeModalEl('addRecipeModal');
            showToast(`Ya la teníais: «${existing[0].title}»`);
            randomMode = false;
            return openRecipe(existing[0].id);
        }
    } catch { /* si falla la comprobación, se importa igualmente */ }

    const btn = $('importUrlBtn');
    btn.disabled = true;
    btn.textContent = 'Leyendo…';
    status.textContent = '⏳ Leyendo la receta de la web…';
    try {
        const token = await getAccessToken();
        const response = await fetch(`${SUPABASE_URL}/functions/v1/importar-receta`, {
            method: 'POST',
            headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        const data = await response.json().catch(() => ({}));
        if (response.status === 404 && !data.error) {
            status.textContent = '⚠️ La importación aún no está activada en Supabase (falta desplegar la función «importar-receta»).';
            return;
        }
        if (!response.ok) {
            status.textContent = `⚠️ ${data.error || 'No se pudo leer esa web'}. Puedes copiar la receta a mano abajo.`;
            if (data.title && !$('newRecipeTitle').value) $('newRecipeTitle').value = data.title;
            $('newRecipeUrl').value = url;
            return;
        }
        $('newRecipeTitle').value = data.title || '';
        $('newRecipeUrl').value = data.url || url;
        $('newRecipeIngredients').value = (data.ingredients || []).join('\n');
        $('newRecipeSteps').value = (data.steps || []).join('\n');
        const n = (data.ingredients || []).length;
        status.textContent = `✅ ${n} ingredientes y ${(data.steps || []).length} pasos. Revisa, elige la categoría y guarda.`;
        $('newRecipeCategory').focus();
    } catch (e) {
        status.textContent = '⚠️ No se pudo conectar: ' + e.message;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Importar';
    }
}

function setupAddRecipeModal() {
    $('importUrlBtn').onclick = () => importRecipeFromUrl();
    $('importUrl').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            importRecipeFromUrl();
        }
    });
    $('addRecipeForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = $('newRecipeTitle').value.trim();
        const url = $('newRecipeUrl').value.trim();
        const ingredients = $('newRecipeIngredients').value.trim();
        const steps = $('newRecipeSteps').value.trim();
        const categoria = $('newRecipeCategory').value ? Number($('newRecipeCategory').value) : null;
        if (!title || !ingredients || !steps) return;

        const row = { title, url: url || null, ingredients, steps, categoria };
        if (schema.propia) row.propia = true;
        if (schema.datos) row.tipo = 'principal';
        try {
            const inserted = await supabaseRequest('recetas', '', { method: 'POST', body: JSON.stringify([row]) });
            e.target.reset();
            $('importUrl').value = '';
            $('importStatus').textContent = '';
            closeModalEl('addRecipeModal');
            showToast('Receta guardada');
            if (schema.propia) setScope('propias');
            else await refreshRecipes();
            if (inserted && inserted[0]) {
                randomMode = false;
                openRecipe(inserted[0].id);
            }
        } catch (err) {
            showToast('No se pudo guardar la receta: ' + err.message, true);
        }
    });
}

// -------------------- FAVORITOS --------------------

function isFavorite(recipeId) {
    return favorites.some(f => f.receta_id === recipeId);
}

async function toggleFavorite(recipeId) {
    try {
        const existing = favorites.filter(f => f.receta_id === recipeId);
        if (existing.length) {
            await supabaseRequest('recetas_favoritas', `?receta_id=eq.${recipeId}`, { method: 'DELETE' });
        } else {
            await supabaseRequest('recetas_favoritas', '', { method: 'POST', body: JSON.stringify([{ receta_id: recipeId }]) });
        }
        await loadFavorites();
        renderScopeFilters();
        renderRecipes();
        updateModalFavButton();
        showToast(existing.length ? 'Quitada de favoritas' : '⭐ Añadida a favoritas');
    } catch (e) {
        showToast('No se pudo actualizar la favorita: ' + e.message, true);
    }
}

// -------------------- LISTA DE LA COMPRA --------------------

function setupShoppingView() {
    $('shoppingAddForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const text = $('shoppingInput').value.trim();
        if (!text) return;
        addShoppingFromInput(text)
            .then(() => {
                $('shoppingInput').value = '';
                renderSuggestions();
            })
            .catch(showShoppingError);
    });
    $('shoppingInput').addEventListener('input', renderSuggestions);
    $('editHabitualBtn').onclick = () => {
        habitualEditMode = !habitualEditMode;
        renderHabituales();
    };
    $('addFixedBtn').onclick = () => addFixedHabituales().catch(showShoppingError);
    $('clearCheckedBtn').onclick = () => clearCheckedItems().catch(showShoppingError);
    $('clearListBtn').onclick = () => {
        if (shoppingList.length === 0) return showToast('La lista ya está vacía');
        askConfirm('¿Vaciar toda la lista de la compra?', 'Sí, vaciar', clearShoppingList);
    };
}

function readLocalChecked() {
    try {
        return new Set(JSON.parse(localStorage.getItem(LOCAL_CHECKED_KEY) || '[]'));
    } catch {
        return new Set();
    }
}

function writeLocalChecked() {
    try {
        localStorage.setItem(LOCAL_CHECKED_KEY, JSON.stringify(shoppingList.filter(i => i.comprado).map(i => i.id)));
    } catch { /* sin almacenamiento local: el tachado dura hasta recargar */ }
}

async function loadShoppingList() {
    const cols = 'id,id_producto,cantidad,productos(nombre)' + (schema.shoppingExtras ? ',texto,comprado' : '');
    const data = await supabaseRequest('lista_compra', `?select=${cols}&order=id.asc`);
    const localChecked = readLocalChecked();
    shoppingList = (data || []).map(item => ({
        id: item.id,
        id_producto: item.id_producto,
        cantidad: Number.isInteger(item.cantidad) && item.cantidad > 0 ? item.cantidad : 1,
        nombre: (item.productos && item.productos.nombre) || item.texto || 'Producto',
        comprado: schema.shoppingExtras ? Boolean(item.comprado) : localChecked.has(item.id)
    }));
    renderShoppingList();
    setShoppingStatus('');
}

function renderShoppingList() {
    const pending = shoppingList.filter(i => !i.comprado);
    const done = shoppingList.filter(i => i.comprado);
    const count = $('cartCount');
    count.textContent = pending.length;
    count.hidden = pending.length === 0;

    const listEl = $('shoppingList');
    if (shoppingList.length === 0) {
        listEl.innerHTML = '<li class="shopping-empty">La lista está vacía. Escribe arriba o añade ingredientes desde una receta o desde la semana.</li>';
    } else {
        const itemHtml = item =>
            `<li class="${item.comprado ? 'checked' : ''}">` +
            `<label class="shop-check"><input type="checkbox" data-action="shop-toggle" data-id="${item.id}" ${item.comprado ? 'checked' : ''}>` +
            `<span>${escapeHtml(item.nombre)}</span></label>` +
            `<div class="qty"><button type="button" data-action="shop-dec" data-id="${item.id}" aria-label="Menos">−</button>` +
            `<span>${item.cantidad}</span>` +
            `<button type="button" data-action="shop-inc" data-id="${item.id}" aria-label="Más">+</button></div>` +
            `<button class="remove-item-btn" type="button" data-action="shop-remove" data-id="${item.id}" aria-label="Quitar ${escapeHtml(item.nombre)}">×</button></li>`;
        const header = text => `<li class="shopping-section" aria-hidden="true">${text}</li>`;
        const groups = groupBySection(pending);
        listEl.innerHTML =
            groups.map(g => (groups.length > 1 ? header(g.titulo) : '') + g.items.map(itemHtml).join('')).join('') +
            (done.length ? header('✅ En el carro') + done.map(itemHtml).join('') : '');
    }
    $('clearCheckedBtn').hidden = done.length === 0;
    renderHabituales();
}

// Pasillos del súper, en el orden en que se suelen recorrer. Se comprueban de arriba abajo:
// lo más específico primero ("tomate frito" es despensa, "tomate" es verdura).
const SECCIONES = [
    { titulo: '❄️ Congelados', palabras: ['congelado', 'congelada', 'helado', 'hielo'] },
    { titulo: '🥫 Despensa', palabras: ['lata', 'conserva', 'bote', 'tomate frito', 'tomate triturado', 'tomate natural triturado',
        'pan rallado', 'caldo', 'leche condensada', 'leche evaporada', 'chocolate', 'cacao', 'atun en aceite', 'atun claro'] },
    { titulo: '🧽 Limpieza y hogar', palabras: ['detergente', 'lavavajillas', 'suavizante', 'lejia', 'friegasuelos', 'limpiador',
        'papel de cocina', 'servilleta', 'bolsas de basura', 'bolsa de basura', 'estropajo', 'film', 'papel de aluminio',
        'papel aluminio', 'papel de horno', 'pila', 'bayeta', 'ambientador', 'quitagrasas'] },
    { titulo: '🧴 Higiene', palabras: ['champu', 'gel', 'desodorante', 'pasta de dientes', 'dentifrico', 'cepillo', 'compresa',
        'tampon', 'crema hidratante', 'crema solar', 'protector solar', 'maquinilla', 'cuchilla', 'colonia', 'jabon',
        'papel higienico', 'panal', 'toallita', 'bastoncillo', 'algodon', 'acondicionador', 'enjuague'] },
    { titulo: '🧃 Bebidas', palabras: ['agua', 'zumo', 'refresco', 'cerveza', 'vino', 'cava', 'tonica', 'coca cola', 'cola',
        'gaseosa', 'sidra', 'bebida', 'cafe', 'te', 'infusion', 'manzanilla', 'poleo'] },
    { titulo: '🥛 Lácteos y huevos', palabras: ['leche', 'yogur', 'yogurt', 'queso', 'mantequilla', 'nata', 'crema de leche', 'huevo',
        'kefir', 'requeson', 'mozzarella', 'parmesano', 'natilla', 'margarina', 'cuajada', 'bebida de avena', 'flan'] },
    { titulo: '🥩 Carne y charcutería', palabras: ['pollo', 'pechuga', 'muslo', 'contramuslo', 'alita', 'ternera', 'cerdo', 'carne',
        'lomo', 'solomillo', 'costilla', 'cordero', 'conejo', 'pavo', 'hamburguesa', 'salchicha', 'chorizo', 'jamon',
        'bacon', 'beicon', 'panceta', 'morcilla', 'fuet', 'salami', 'salchichon', 'pate', 'albondiga', 'filete', 'chuleta',
        'embutido', 'pato', 'mortadela', 'lacon', 'picada', 'carrillada', 'secreto', 'longaniza', 'butifarra', 'sobrasada'] },
    { titulo: '🐟 Pescado y marisco', palabras: ['pescado', 'merluza', 'salmon', 'atun', 'bacalao', 'gamba', 'langostino', 'mejillon',
        'almeja', 'calamar', 'sepia', 'pulpo', 'lubina', 'dorada', 'sardina', 'boqueron', 'rape', 'trucha', 'emperador',
        'marisco', 'surimi', 'anchoa', 'bonito', 'caballa', 'lenguado', 'pescadilla', 'chipiron', 'berberecho', 'navaja'] },
    { titulo: '🥬 Fruta y verdura', palabras: ['tomate', 'lechuga', 'cebolla', 'cebolleta', 'ajo', 'patata', 'papa', 'zanahoria', 'pimiento',
        'calabacin', 'berenjena', 'pepino', 'puerro', 'apio', 'espinaca', 'acelga', 'brocoli', 'coliflor', 'col', 'repollo',
        'champinon', 'seta', 'judia verde', 'judias verdes', 'alcachofa', 'esparrago', 'calabaza', 'aguacate', 'limon',
        'lima', 'naranja', 'mandarina', 'manzana', 'pera', 'platano', 'banana', 'fresa', 'uva', 'melon', 'sandia', 'pina',
        'mango', 'kiwi', 'melocoton', 'nectarina', 'cereza', 'frutos rojos', 'arandano', 'frambuesa', 'perejil', 'cilantro',
        'albahaca', 'hierbabuena', 'menta', 'jengibre', 'rucula', 'canonigo', 'canonigos', 'chalota', 'rabano',
        'remolacha', 'boniato', 'batata', 'fruta', 'verdura', 'lombarda', 'endivia', 'escarola', 'nabo', 'guindilla',
        'ensalada', 'brotes', 'granada', 'higo', 'ciruela', 'coco'] },
    { titulo: '🥖 Panadería', palabras: ['pan', 'barra', 'baguette', 'chapata', 'bolleria', 'croissant', 'cruasan', 'magdalena',
        'pan de molde', 'tortilla de trigo', 'tortillas de trigo', 'picos', 'regañas', 'bizcocho'] },
    { titulo: '🥫 Despensa', palabras: ['arroz', 'pasta', 'macarron', 'espagueti', 'spaghetti', 'fideo', 'tallarin', 'lasaña',
        'harina', 'azucar', 'sal', 'aceite', 'vinagre', 'lenteja', 'garbanzo', 'alubia', 'judia', 'legumbre', 'especia',
        'pimienta', 'pimenton', 'oregano', 'comino', 'canela', 'curry', 'laurel', 'tomillo', 'romero', 'levadura',
        'galleta', 'cereal', 'avena', 'miel', 'mermelada', 'frutos secos', 'almendra', 'nuez', 'nueces', 'cacahuete',
        'pasa', 'aceituna', 'mayonesa', 'ketchup', 'mostaza', 'salsa', 'maiz', 'quinoa', 'cuscus', 'tomate concentrado',
        'colorante', 'azafran', 'nuez moscada', 'maicena', 'pinon', 'sesamo', 'cacao', 'gelatina', 'legumbres',
        'soja', 'tahini', 'caldo', 'pastilla', 'vainilla', 'polvo de hornear', 'bicarbonato'] }
];
const SECCION_OTROS = '📦 Otros';
const SECCIONES_RX = SECCIONES.map(s => ({
    titulo: s.titulo,
    // palabra entera, admitiendo plural: "tomate" casa con "2 tomates" pero no "sal" con "salsa"
    rx: new RegExp('(^|[^a-z])(' + s.palabras.map(p => normalizeText(p).replace(/\s+/g, '\\s+')).join('|') + ')(e?s)?([^a-z]|$)')
}));

function sectionOf(nombre) {
    const text = normalizeText(nombre);
    const hit = SECCIONES_RX.find(s => s.rx.test(text));
    return hit ? hit.titulo : SECCION_OTROS;
}

// Agrupa por pasillo respetando el orden de SECCIONES (las dos «Despensa» se juntan en una).
function groupBySection(items) {
    const order = [...new Set([...SECCIONES.map(s => s.titulo), SECCION_OTROS])];
    const map = new Map(order.map(t => [t, []]));
    items.forEach(item => map.get(sectionOf(item.nombre)).push(item));
    return [...map].filter(([, list]) => list.length).map(([titulo, list]) => ({ titulo, items: list }));
}

function renderSuggestions() {
    const query = normalizeText($('shoppingInput').value.trim().replace(/^\d+\s*[x×]?\s+/i, ''));
    const box = $('shoppingSuggestions');
    if (!query) {
        box.innerHTML = '';
        return;
    }
    const results = products.filter(p => normalizeText(p.nombre).includes(query)).slice(0, 8);
    box.innerHTML = results.map(p =>
        `<button class="suggestion" type="button" data-action="add-suggestion" data-id="${escapeHtml(p.id)}">+ ${escapeHtml(p.nombre)}</button>`
    ).join('');
}

async function addProductById(id) {
    const product = products.find(p => String(p.id) === String(id));
    if (!product) return;
    const match = $('shoppingInput').value.trim().match(/^(\d+)\s*[x×]?\s+/i);
    await addProductToList(product, match ? Number(match[1]) : 1);
    await loadShoppingList();
    recordHabitual(product.nombre);
    $('shoppingInput').value = '';
    renderSuggestions();
    $('shoppingInput').focus();
    showToast(`🛒 ${product.nombre} añadido`);
}

async function addProductToList(product, qty) {
    const existing = shoppingList.find(i => i.id_producto === product.id && !i.comprado);
    if (existing) {
        await supabaseRequest('lista_compra', `?id=eq.${existing.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ cantidad: existing.cantidad + qty })
        });
    } else {
        await supabaseRequest('lista_compra', '', {
            method: 'POST',
            body: JSON.stringify([{ id_producto: product.id, cantidad: qty }])
        });
    }
}

async function addShoppingFromInput(text) {
    let qty = 1;
    let name = text;
    const m = text.match(/^(\d+)\s*[x×]?\s+(.+)$/i);
    if (m) {
        qty = Math.max(1, Number(m[1]));
        name = m[2].trim();
    }
    await addShoppingTexts([name], qty);
    recordHabitual(name);
    showToast(`🛒 ${name} añadido`);
}

// -------------------- LO DE SIEMPRE --------------------
// Lo que se añade a mano a la lista se cuenta en compra_habitual; los más repetidos y
// los fijos (📌) salen como botones para añadirlos con un toque. Lo que llega desde
// los ingredientes de una receta no cuenta (son compras puntuales).

async function loadHabituales() {
    if (!schema.habituales) return;
    try {
        habituales = await supabaseRequest('compra_habitual', '?select=clave,nombre,veces,fijo,ultima_vez') || [];
    } catch (e) {
        console.warn('No se pudo cargar «Lo de siempre»:', e);
    }
}

function habitualByClave(clave) {
    return habituales.find(h => h.clave === clave);
}

function recordHabitual(name) {
    if (!schema.habituales) return;
    const clave = shoppingKey(name);
    if (!clave) return;
    const existing = habitualByClave(clave);
    const row = {
        clave,
        nombre: existing ? existing.nombre : (ingredientParts(name).nombre || name),
        veces: (existing ? existing.veces : 0) + 1,
        ultima_vez: new Date().toISOString()
    };
    if (existing) Object.assign(existing, row);
    else habituales.push({ ...row, fijo: false });
    renderHabituales();
    // upsert: si ya existe se actualizan veces/ultima_vez y se respeta "fijo"
    supabaseRequest('compra_habitual', '?on_conflict=clave', {
        method: 'POST',
        headers: { Prefer: 'return=minimal,resolution=merge-duplicates' },
        body: JSON.stringify([row])
    }).catch(e => console.warn('No se pudo guardar en «Lo de siempre»:', e));
}

function sortedHabituales() {
    return [...habituales].sort((a, b) =>
        Number(b.fijo) - Number(a.fijo) || b.veces - a.veces ||
        String(b.ultima_vez || '').localeCompare(String(a.ultima_vez || '')));
}

function pendingShoppingKeys() {
    return new Set(shoppingList.filter(i => !i.comprado).map(i => shoppingKey(i.nombre)));
}

function renderHabituales() {
    const box = $('habitualBox');
    if (!box) return;
    box.hidden = !schema.habituales || habituales.length === 0;
    if (box.hidden) return;
    const pending = pendingShoppingKeys();
    const chips = $('habitualChips');
    $('habitualHint').hidden = !habitualEditMode;
    $('editHabitualBtn').textContent = habitualEditMode ? '✓ Listo' : '✏️ Editar';

    if (habitualEditMode) {
        chips.innerHTML = sortedHabituales().map(h =>
            `<span class="habitual-chip editing${h.fijo ? ' fijo' : ''}">` +
            `<button type="button" data-action="habitual-pin" data-clave="${escapeHtml(h.clave)}" aria-pressed="${h.fijo}" ` +
            `aria-label="${h.fijo ? 'Quitar de fijos' : 'Marcar como fijo'}: ${escapeHtml(h.nombre)}">${h.fijo ? '📌' : '📍'}</button>` +
            `<span>${escapeHtml(h.nombre)}</span>` +
            `<button type="button" data-action="habitual-forget" data-clave="${escapeHtml(h.clave)}" aria-label="Olvidar ${escapeHtml(h.nombre)}">×</button></span>`
        ).join('');
        $('addFixedBtn').hidden = true;
        return;
    }

    const visible = sortedHabituales().filter(h => !pending.has(h.clave)).slice(0, 18);
    chips.innerHTML = visible.length
        ? visible.map(h =>
            `<button type="button" class="habitual-chip${h.fijo ? ' fijo' : ''}" data-action="habitual-add" data-clave="${escapeHtml(h.clave)}">` +
            `${h.fijo ? '📌 ' : '+ '}${escapeHtml(h.nombre)}</button>`).join('')
        : '<p class="hint">Ya está todo en la lista 👌</p>';
    const fixedMissing = habituales.filter(h => h.fijo && !pending.has(h.clave));
    $('addFixedBtn').hidden = fixedMissing.length === 0;
    $('addFixedBtn').textContent = `📌 Añadir los fijos (${fixedMissing.length})`;
}

async function addHabitual(clave) {
    const h = habitualByClave(clave);
    if (!h) return;
    await addShoppingTexts([h.nombre]);
    recordHabitual(h.nombre);
    showToast(`🛒 ${h.nombre} añadido`);
}

async function addFixedHabituales() {
    const pending = pendingShoppingKeys();
    const missing = habituales.filter(h => h.fijo && !pending.has(h.clave));
    if (missing.length === 0) return;
    await addShoppingTexts(missing.map(h => h.nombre));
    missing.forEach(h => recordHabitual(h.nombre));
    showToast(`📌 ${missing.length} ${missing.length === 1 ? 'producto fijo añadido' : 'productos fijos añadidos'}`);
}

async function toggleHabitualFijo(clave) {
    const h = habitualByClave(clave);
    if (!h) return;
    const fijo = !h.fijo;
    await supabaseRequest('compra_habitual', `?clave=eq.${encodeURIComponent(clave)}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ fijo })
    });
    h.fijo = fijo;
    renderHabituales();
}

async function forgetHabitual(clave) {
    await supabaseRequest('compra_habitual', `?clave=eq.${encodeURIComponent(clave)}`, {
        method: 'DELETE', headers: { Prefer: 'return=minimal' }
    });
    habituales = habituales.filter(h => h.clave !== clave);
    renderHabituales();
}

// Las altas en la lista van en cola: si dos se solapan (doble toque), ambas calcularían
// el mismo id de producto nuevo y Supabase devolvería 409.
let shoppingQueue = Promise.resolve();
function addShoppingTexts(texts, qty = 1) {
    const run = shoppingQueue.then(() => addShoppingTextsNow(texts, qty));
    shoppingQueue = run.catch(() => { });
    return run;
}

// Añade textos libres: si coinciden con un producto del catálogo se usa ese producto;
// si no, se guarda como texto (con la migración) o se crea el producto (sin ella).
async function addShoppingTextsNow(texts, qty) {
    const textRows = [];
    for (const raw of texts) {
        const name = raw.trim();
        if (!name) continue;
        // Misma clave = mismo producto: "2 tomates", "Tomate" y "Tomates (500 g)" se juntan.
        const key = shoppingKey(name);
        const product = products.find(p => shoppingKey(p.nombre) === key);
        if (product) {
            await addProductToList(product, qty);
            await loadShoppingList();
            continue;
        }
        const existing = shoppingList.find(i => !i.comprado && shoppingKey(i.nombre) === key);
        if (existing) {
            await supabaseRequest('lista_compra', `?id=eq.${existing.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ cantidad: existing.cantidad + qty })
            });
            continue;
        }
        if (schema.shoppingExtras) {
            textRows.push({ texto: name, cantidad: qty, id_producto: null });
        } else {
            const created = await supabaseRequest('productos', '', {
                method: 'POST',
                body: JSON.stringify([{ id: createProductId(), nombre: name.charAt(0).toUpperCase() + name.slice(1) }])
            });
            products.push(created[0]);
            await addProductToList(created[0], qty);
        }
    }
    if (textRows.length) await supabaseRequest('lista_compra', '', { method: 'POST', body: JSON.stringify(textRows) });
    await loadShoppingList();
}

async function toggleShoppingItem(id) {
    const item = shoppingList.find(i => i.id === id);
    if (!item) return;
    item.comprado = !item.comprado;
    renderShoppingList();
    if (!schema.shoppingExtras) {
        writeLocalChecked();
        return;
    }
    try {
        await supabaseRequest('lista_compra', `?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ comprado: item.comprado }) });
    } catch (e) {
        item.comprado = !item.comprado;
        renderShoppingList();
        showShoppingError(e);
    }
}

async function changeShoppingQuantity(id, delta) {
    const item = shoppingList.find(i => i.id === id);
    if (!item) return;
    const cantidad = item.cantidad + delta;
    if (cantidad < 1) return removeShoppingItem(id);
    item.cantidad = cantidad;
    renderShoppingList();
    try {
        await supabaseRequest('lista_compra', `?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ cantidad }) });
    } catch (e) {
        showShoppingError(e);
        await loadShoppingList();
    }
}

async function removeShoppingItem(id) {
    await supabaseRequest('lista_compra', `?id=eq.${id}`, { method: 'DELETE' });
    await loadShoppingList();
    writeLocalChecked();
}

async function clearCheckedItems() {
    const ids = shoppingList.filter(i => i.comprado).map(i => i.id);
    if (ids.length === 0) return;
    await supabaseRequest('lista_compra', `?id=in.(${ids.join(',')})`, { method: 'DELETE' });
    await loadShoppingList();
    writeLocalChecked();
    showToast(`${ids.length} ${ids.length === 1 ? 'producto quitado' : 'productos quitados'}`);
}

async function clearShoppingList() {
    await supabaseRequest('lista_compra', '?id=not.is.null', { method: 'DELETE' });
    await loadShoppingList();
    writeLocalChecked();
}

function showShoppingError(error) {
    console.error('Error en la lista de compra:', error);
    setShoppingStatus('Error: ' + error.message, true);
}

function setShoppingStatus(message, isError = false) {
    const el = $('shoppingStatus');
    el.textContent = message;
    el.classList.toggle('status-error', isError);
}

// -------------------- PRODUCTOS (catálogo de sugerencias) --------------------

function setupProductManagerModal() {
    $('openProductManagerBtn').onclick = () => {
        renderProductManagerList();
        openModalEl('productManagerModal');
    };
    $('addProductBtn').onclick = async () => {
        const input = $('newProductName');
        const name = input.value.trim();
        if (!name) return;
        if (products.some(p => normalizeText(p.nombre) === normalizeText(name))) return showToast('Ese producto ya existe');
        try {
            await supabaseRequest('productos', '', {
                method: 'POST',
                body: JSON.stringify([{ id: createProductId(), nombre: name }])
            });
            input.value = '';
            await loadProducts();
            renderProductManagerList();
        } catch (e) {
            showToast('No se pudo añadir el producto: ' + e.message, true);
        }
    };
    $('newProductName').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') $('addProductBtn').click();
    });
}

function createProductId() {
    const numericIds = products.map(p => Number(p.id)).filter(id => Number.isSafeInteger(id) && id > 0);
    return numericIds.length > 0 ? Math.max(...numericIds) + 1 : 1;
}

function renderProductManagerList() {
    const list = $('productManagerList');
    list.innerHTML = products.length === 0 ? '<li>No hay productos todavía.</li>' : products.map(p =>
        `<li><span>${escapeHtml(p.nombre)}</span><button class="btn-clear" type="button" data-action="product-delete" data-id="${escapeHtml(p.id)}">Eliminar</button></li>`
    ).join('');
}

function askDeleteProduct(id) {
    const product = products.find(p => String(p.id) === String(id));
    if (!product) return;
    askConfirm(`¿Eliminar el producto «${product.nombre}»? Se quitará también de la lista de la compra.`, 'Sí, eliminar', async () => {
        await supabaseRequest('lista_compra', `?id_producto=eq.${product.id}`, { method: 'DELETE' });
        await supabaseRequest('productos', `?id=eq.${product.id}`, { method: 'DELETE' });
        await Promise.all([loadProducts(), loadShoppingList()]);
        renderProductManagerList();
    });
}

// -------------------- CATEGORÍAS --------------------

function setupCategoryManagerModal() {
    $('openCategoryManagerBtn').onclick = () => {
        renderCategoryManagerList();
        openModalEl('categoryManagerModal');
    };
    $('addCategoryBtn').onclick = async () => {
        const input = $('newCategoryName');
        const name = input.value.trim();
        if (!name) return;
        try {
            await supabaseRequest('categoria_recetas', '', { method: 'POST', body: JSON.stringify([{ categoria: name }]) });
            input.value = '';
            await afterCategoriesChange();
        } catch (e) {
            showToast('No se pudo añadir la categoría: ' + e.message, true);
        }
    };
    $('newCategoryName').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') $('addCategoryBtn').click();
    });
}

async function afterCategoriesChange() {
    await loadCategories();
    renderCategoryFilters();
    renderCategorySelects();
    renderCategoryManagerList();
    renderRecipes();
}

function renderCategoryManagerList() {
    const list = $('categoryManagerList');
    list.innerHTML = categories.length === 0 ? '<li>No hay categorías todavía.</li>' : categories.map(c =>
        `<li><span>${escapeHtml(c.categoria)}</span><button class="btn-clear" type="button" data-action="cat-delete" data-id="${c.id}">Eliminar</button></li>`
    ).join('');
}

function askDeleteCategory(id) {
    const cat = categories.find(c => c.id === id);
    if (!cat) return;
    askConfirm(`¿Eliminar la categoría «${cat.categoria}»? Sus recetas quedarán sin categoría.`, 'Sí, eliminar', async () => {
        await supabaseRequest('recetas', `?categoria=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ categoria: null }) });
        await supabaseRequest('categoria_recetas', `?id=eq.${id}`, { method: 'DELETE' });
        if (currentCategoryFilter === id) currentCategoryFilter = 'Todas';
        await afterCategoriesChange();
        await refreshRecipes();
    });
}

// -------------------- MENÚS GUARDADOS --------------------

async function openSavedMenus() {
    try {
        await loadSavedMenus();
        currentlyViewedSemana = null;
        renderSavedMenusList();
        $('savedMenuDetail').innerHTML = '';
        $('savedMenuDetailTitle').innerHTML = '';
        openModalEl('savedMenusModal');
    } catch (e) {
        showToast('No se pudieron cargar los menús guardados: ' + e.message, true);
    }
}

async function loadSavedMenus() {
    const cols = 'id,semana,dia,tipo_comida,receta_id,recetas(title)' + (schema.menuFecha ? ',creado_en' : '');
    const data = await supabaseRequest('semanas_guardadas', `?select=${cols}&order=semana.desc,dia.asc`);
    savedMenusGrouped = {};
    (data || []).forEach(row => {
        if (!savedMenusGrouped[row.semana]) savedMenusGrouped[row.semana] = [];
        savedMenusGrouped[row.semana].push({
            dia: row.dia,
            tipo_comida: row.tipo_comida,
            receta_id: row.receta_id,
            creado_en: row.creado_en,
            title: row.recetas ? row.recetas.title : 'Receta eliminada'
        });
    });
}

function savedMenuLabel(semana) {
    const first = (savedMenusGrouped[semana] || [])[0];
    if (first && first.creado_en) {
        const fecha = new Date(first.creado_en).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
        return `Menú ${semana} · ${fecha}`;
    }
    return `Menú ${semana}`;
}

function renderSavedMenusList() {
    const list = $('savedMenusList');
    const semanas = Object.keys(savedMenusGrouped).sort((a, b) => b - a);
    if (semanas.length === 0) {
        list.innerHTML = '<div class="empty-state"><p>Todavía no has guardado ningún menú.</p><p>Usa «💾 Guardar en el historial» en la pestaña Semana.</p></div>';
        return;
    }
    list.innerHTML = semanas.map(semana => {
        const isOpen = String(currentlyViewedSemana) === String(semana);
        const n = savedMenusGrouped[semana].length;
        return `<div class="saved-menu-item">
            <span>${escapeHtml(savedMenuLabel(semana))} <small class="hint">(${n} ${n === 1 ? 'comida' : 'comidas'})</small></span>
            <div>
                <button class="btn btn-secondary" type="button" data-action="saved-toggle" data-semana="${semana}">${isOpen ? 'Ocultar' : 'Ver'}</button>
                <button class="btn btn-primary" type="button" data-action="saved-repeat" data-semana="${semana}">🔁 Repetir</button>
                <button class="btn-clear" type="button" data-action="saved-delete" data-semana="${semana}" aria-label="Eliminar">🗑️</button>
            </div>
        </div>`;
    }).join('');
}

function toggleSavedMenu(semana) {
    if (String(currentlyViewedSemana) === String(semana)) {
        currentlyViewedSemana = null;
        $('savedMenuDetail').innerHTML = '';
        $('savedMenuDetailTitle').innerHTML = '';
    } else {
        currentlyViewedSemana = semana;
        const menuData = {};
        (savedMenusGrouped[semana] || []).forEach(e => {
            menuData[`${e.dia}_${e.tipo_comida}`] = { receta_id: e.receta_id, title: e.title };
        });
        $('savedMenuDetailTitle').innerHTML = `<h3>${escapeHtml(savedMenuLabel(semana))}</h3>`;
        $('savedMenuDetail').innerHTML = generateWeeklyGridHtml(menuData, true);
    }
    renderSavedMenusList();
}

function repeatSavedMenu(semana) {
    const entries = (savedMenusGrouped[semana] || []).filter(e => e.receta_id != null);
    const doRepeat = async () => {
        await supabaseRequest('menu_semanal_actual', '?id=not.is.null', { method: 'DELETE' });
        const rows = entries.map(e => ({ dia: e.dia, tipo_comida: e.tipo_comida, receta_id: e.receta_id }));
        if (rows.length) await supabaseRequest('menu_semanal_actual', '', { method: 'POST', body: JSON.stringify(rows) });
        await loadCurrentWeekMenuDraft();
        renderWeek();
        closeModalEl('savedMenusModal');
        closeModalEl('settingsModal');
        goToView('semana');
        showToast('🔁 Menú copiado a esta semana');
    };
    if (Object.keys(currentWeekMenu).length > 0) {
        askConfirm('Esto sustituirá el menú que tienes ahora en la semana. ¿Continuar?', 'Sí, sustituir', doRepeat, { danger: false });
    } else {
        doRepeat().catch(e => showToast('No se pudo copiar el menú: ' + e.message, true));
    }
}

function askDeleteSavedMenu(semana) {
    askConfirm(`¿Eliminar «${savedMenuLabel(semana)}»? No se podrá recuperar.`, 'Sí, eliminar', async () => {
        await supabaseRequest('semanas_guardadas', `?semana=eq.${semana}`, { method: 'DELETE' });
        await loadSavedMenus();
        currentlyViewedSemana = null;
        renderSavedMenusList();
        $('savedMenuDetail').innerHTML = '';
        $('savedMenuDetailTitle').innerHTML = '';
    });
}

// -------------------- AJUSTES --------------------

function setupSettingsModal() {
    $('openSettingsBtn').onclick = () => {
        const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
        $('installHint').hidden = Boolean(standalone);
        openModalEl('settingsModal');
    };
    $('settingsSavedMenusBtn').onclick = () => openSavedMenus();
    $('installAppBtn').onclick = async () => {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        $('installAppBtn').hidden = true;
    };
    const thermomix = $('showThermomixToggle');
    thermomix.checked = showThermomix;
    thermomix.addEventListener('change', () => {
        showThermomix = thermomix.checked;
        writeFlag(THERMOMIX_KEY, showThermomix);
        randomPool.key = null;
        currentRecipePage = 0;
        allRecipesCount = null;
        refreshRecipes();
        showToast(showThermomix ? '🥣 Se muestran las recetas de Thermomix' : '🥣 Recetas de Thermomix ocultas');
    });
}

// -------------------- SINCRONIZAR AL VOLVER --------------------
// Si uno añade algo a la lista o al menú desde su móvil, el otro lo ve al volver a la app
// (sin recargar). Como mucho una vez cada 15 s.

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !appStarted || !session) return;
    if (Date.now() - lastBackgroundSync < 15000) return;
    lastBackgroundSync = Date.now();
    loadShoppingList().catch(e => console.warn('No se pudo actualizar la lista:', e));
    loadCurrentWeekMenuDraft({ keepOnError: true }).then(renderWeek);
    // Categorías y favoritas también: si la app se abrió sin acceso (o sin red) se
    // habían quedado vacías y no se volvían a pedir.
    Promise.all([
        loadCategories().catch(e => console.warn('No se pudieron actualizar las categorías:', e)),
        loadFavorites(),
        loadHabituales()
    ]).then(() => {
        renderCategoryFilters();
        renderCategorySelects();
        renderScopeFilters();
        renderHabituales();
        renderRecipes(); // los nombres de categoría de las tarjetas
    });
});

// -------------------- CONFIRMACIÓN --------------------

function setupConfirmModal() {
    $('confirmNoBtn').onclick = () => {
        confirmAction = null;
        closeModalEl('confirmModal');
    };
    $('confirmYesBtn').onclick = async () => {
        const action = confirmAction;
        confirmAction = null;
        closeModalEl('confirmModal');
        if (!action) return;
        try {
            await action();
        } catch (e) {
            console.error(e);
            showToast('No se pudo completar: ' + e.message, true);
        }
    };
}

// -------------------- VOLVER ARRIBA --------------------

function setupBackToTop() {
    const btn = $('backToTopBtn');
    window.addEventListener('scroll', () => { btn.hidden = window.scrollY < 600; }, { passive: true });
    btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}
