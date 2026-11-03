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

let schema = { shoppingExtras: false, menuFecha: false, propia: false };

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

    $('weeklyGrid').innerHTML = '<p class="hint">Cargando…</p>';
    try {
        await detectSchema();
        await Promise.all([loadCategories(), loadFavorites(), loadProducts()]);
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
});

async function detectSchema() {
    const probe = (table, cols) => supabaseRequest(table, `?select=${cols}&limit=1`).then(() => true, () => false);
    const [shoppingExtras, menuFecha, propia] = await Promise.all([
        probe('lista_compra', 'texto,comprado'),
        probe('semanas_guardadas', 'creado_en'),
        probe('recetas', 'propia')
    ]);
    schema = { shoppingExtras, menuFecha, propia };
    const hint = $('schemaHint');
    if (hint && !(shoppingExtras && menuFecha && propia)) {
        hint.hidden = false;
        hint.textContent = 'ℹ️ Para tachar productos sincronizados entre móviles, ver fechas en los menús y el filtro «Mis recetas», ejecuta supabase/migracion_mejoras.sql en Supabase.';
    }
}

// -------------------- SUPABASE --------------------

async function supabaseRequest(table, query = '', options = {}) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
        ...options,
        headers: {
            apikey: SUPABASE_KEY,
            Authorization: 'Bearer ' + SUPABASE_KEY,
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
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
        headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, Prefer: 'count=exact' }
    });
    if (!response.ok) throw new Error(`Supabase (${table}) respondió con ${response.status}`);
    const rows = await response.json();
    const range = response.headers.get('Content-Range');
    return { rows, total: range ? Number(range.split('/')[1]) : rows.length };
}

// -------------------- UTILIDADES --------------------

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
function parseIngredients(raw) {
    const units = 'unidad(?:es)?|tazas?|cucharadas?(?: soperas?)?|cucharaditas?|cdas?\\.?|cditas?\\.?|manojos?|gr\\.?|gramos?|g|kg|ml|cl|l|litros?|pizcas?|dientes?|latas?|vasos?|chorritos?|chorros?|ramitas?|ramas?|hojas?|rebanadas?|lonchas?|piezas?|sobres?|paquetes?|botes?|tarros?|cubitos?|pastillas?|filetes?|rodajas?|puñados?|copas?|onzas?|lb';
    const beforeQuantity = new RegExp(`(?<!\\d)\\s(?=(?:\\d+(?:\\s+\\d+/\\d+|[.,/]\\d+)?|½|¼|¾)\\s*(?:${units})\\b)`, 'gi');
    const seen = new Set();
    return String(raw ?? '')
        .replace(/^\s*ingredientes:?\s*/i, '')
        .split(/\n+|\s+,\s*/)
        .flatMap(part => part
            .replace(/([a-záéíóúüñ.)])(?=[A-ZÁÉÍÓÚÑ0-9½¼¾])/g, '$1\n')
            .replace(beforeQuantity, '\n')
            .split('\n'))
        .map(s => s.trim().replace(/^[-•*]\s*/, '').replace(/[,;]$/, '').trim())
        .filter(s => s.length > 1 && !/^ingredientes:?$/i.test(s))
        .filter(s => {
            const key = normalizeText(s);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
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
        `<li><label><input type="checkbox" value="${escapeHtml(i)}"><span>${escapeHtml(i)}</span></label></li>`
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
        const top = open.find(m => m.id === 'confirmModal') || open[open.length - 1];
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
            'recetas', `?select=id,title,url,categoria,ingredients&id=in.(${ids.join(',')})&order=title.asc`
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
}

async function loadCurrentWeekMenuDraft() {
    try {
        const data = await supabaseRequest('menu_semanal_actual', '?select=id,dia,tipo_comida,receta_id,recetas(title)');
        currentWeekMenu = {};
        (data || []).forEach(row => {
            currentWeekMenu[`${row.dia}_${row.tipo_comida}`] = {
                receta_id: row.receta_id,
                title: row.recetas ? row.recetas.title : 'Receta eliminada',
                draftId: row.id
            };
        });
    } catch (e) {
        console.error('Error cargando el menú semanal:', e);
        currentWeekMenu = {};
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
        currentWeekMenu[key] = { receta_id: recipe.id, title: recipe.title, draftId: existing.draftId };
    } else {
        const inserted = await supabaseRequest('menu_semanal_actual', '', {
            method: 'POST',
            body: JSON.stringify([{ dia, tipo_comida: tipo, receta_id: recipe.id }])
        });
        currentWeekMenu[key] = { receta_id: recipe.id, title: recipe.title, draftId: inserted[0].id };
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
        const params = new URLSearchParams({
            select: 'id,title,categoria',
            order: 'title.asc',
            limit: '40',
            title: 'imatch.' + accentInsensitivePattern(query)
        });
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
        openModalEl('addRecipeModal');
        $('newRecipeTitle').focus();
    };
}

function renderScopeFilters() {
    const scopes = [
        { id: 'favoritas', label: `⭐ Favoritas (${favorites.length})` },
        ...(schema.propia ? [{ id: 'propias', label: '👤 Mis recetas' }] : []),
        { id: 'todas', label: allRecipesCount ? `📚 Todas (${allRecipesCount.toLocaleString('es-ES')})` : '📚 Todas' }
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

async function getRandomRecipe() {
    const useFavorites = favoriteRecipes.length > 0 && (favoriteRecipes.length >= 5 ? Math.random() < 0.7 : Math.random() < 0.5);
    if (useFavorites) return favoriteRecipes[Math.floor(Math.random() * favoriteRecipes.length)];
    if (!allRecipesCount) {
        const { total } = await supabaseCount('recetas', new URLSearchParams({ select: 'id', limit: '1' }));
        allRecipesCount = total;
    }
    const offset = Math.floor(Math.random() * allRecipesCount);
    const data = await supabaseRequest('recetas', `?select=id,title,categoria&order=id.asc&offset=${offset}&limit=1`);
    return data && data[0];
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
        detail = await supabaseRequest('recetas', `?id=eq.${id}&select=id,title,url,ingredients,steps,categoria`);
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

async function refreshAfterRecipeChange() {
    await Promise.all([loadFavorites(), loadCurrentWeekMenuDraft()]);
    renderScopeFilters();
    renderWeek();
    await refreshRecipes();
}

// -------------------- AÑADIR RECETA --------------------

function setupAddRecipeModal() {
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
        try {
            const inserted = await supabaseRequest('recetas', '', { method: 'POST', body: JSON.stringify([row]) });
            e.target.reset();
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
        listEl.innerHTML = [...pending, ...done].map(item =>
            `<li class="${item.comprado ? 'checked' : ''}">` +
            `<label class="shop-check"><input type="checkbox" data-action="shop-toggle" data-id="${item.id}" ${item.comprado ? 'checked' : ''}>` +
            `<span>${escapeHtml(item.nombre)}</span></label>` +
            `<div class="qty"><button type="button" data-action="shop-dec" data-id="${item.id}" aria-label="Menos">−</button>` +
            `<span>${item.cantidad}</span>` +
            `<button type="button" data-action="shop-inc" data-id="${item.id}" aria-label="Más">+</button></div>` +
            `<button class="remove-item-btn" type="button" data-action="shop-remove" data-id="${item.id}" aria-label="Quitar ${escapeHtml(item.nombre)}">×</button></li>`
        ).join('');
    }
    $('clearCheckedBtn').hidden = done.length === 0;
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
    showToast(`🛒 ${name} añadido`);
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
        const key = normalizeText(name);
        const product = products.find(p => normalizeText(p.nombre) === key);
        if (product) {
            await addProductToList(product, qty);
            await loadShoppingList();
            continue;
        }
        const existing = shoppingList.find(i => !i.comprado && normalizeText(i.nombre) === key);
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
}

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
