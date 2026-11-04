// Pestaña Recetas (catálogo paginado en el servidor), ficha de receta y alta de
// recetas (a mano o importando desde una web).

import { RECIPES_PAGE_SIZE, DIAS } from './config.js';
import { db, dbCount, dbInsert, dbUpdate, dbDelete, callFunction } from './api.js';
import { state, on, isFavorite, categoryName } from './state.js';
import { $, escapeHtml, accentInsensitivePattern, matchesSearch, todayDiaId, plural } from './util.js';
import { registerActions, openModal, closeModal, onModalClose, showToast, askConfirm } from './ui.js';
import { applyCatalogFilters, loadFavorites, toggleFavorite, getRandomRecipe, resetRandomPool } from './catalogo.js';
import { parseIngredients, parseSteps, ingredientListName } from './ingredientes.js';
import { addShoppingTexts } from './compra.js';
import { addToWeek, loadWeek } from './semana.js';

let searchTimer = null;
let loadToken = 0;
let notesTimer = null;
let wakeLock = null;

const SCOPES = [
    { id: 'favoritas', label: '⭐ Favoritas' },
    { id: 'propias', label: '👤 Mías' },
    { id: 'todas', label: '📚 Todas' },
    { id: 'ocultas', label: '🙈 Ocultas' }
];

// ---------------------------------------------------------------- catálogo

export function renderScopeFilters() {
    $('scopeFilters').innerHTML = SCOPES.map(s =>
        `<button type="button" class="${s.id === state.currentScope ? 'active' : ''}" aria-pressed="${s.id === state.currentScope}" ` +
        `data-action="set-scope" data-scope="${s.id}">${s.label}</button>`
    ).join('');
}

export function renderCategoryFilters() {
    const all = [{ id: 'Todas', categoria: 'Todas' }, ...state.categories];
    $('categoryFilters').innerHTML = all.map(c => {
        const active = String(c.id) === String(state.currentCategoryFilter);
        return `<button type="button" class="chip${active ? ' active' : ''}" aria-pressed="${active}" data-action="filter-cat" data-cat="${c.id}">${escapeHtml(c.categoria)}</button>`;
    }).join('');
}

export function renderCategorySelects() {
    const options = state.categories.map(c => `<option value="${c.id}">${escapeHtml(c.categoria)}</option>`).join('');
    const none = '<option value="">Sin categoría</option>';
    const keepNew = $('newRecipeCategory').value;
    $('newRecipeCategory').innerHTML = none + options;
    $('newRecipeCategory').value = keepNew;
    $('editRecipeCategory').innerHTML = none + options;
}

function setScope(scope) {
    state.currentScope = scope;
    state.currentRecipePage = 0;
    renderScopeFilters();
    refreshRecipes();
}

function setCategoryFilter(cat) {
    state.currentCategoryFilter = cat === 'Todas' ? 'Todas' : Number(cat);
    state.currentRecipePage = 0;
    renderCategoryFilters();
    refreshRecipes();
}

export async function refreshRecipes() {
    const token = ++loadToken;
    if (state.currentScope === 'favoritas') {
        renderRecipes();
        return;
    }
    $('recipesGrid').setAttribute('aria-busy', 'true');
    try {
        await loadRecipes();
        if (token !== loadToken) return;
        renderRecipes();
    } catch (e) {
        if (token !== loadToken) return;
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
        offset: String(state.currentRecipePage * RECIPES_PAGE_SIZE),
        limit: String(RECIPES_PAGE_SIZE)
    });
    if (state.currentCategoryFilter !== 'Todas') params.set('categoria', `eq.${state.currentCategoryFilter}`);
    if (state.currentScope === 'propias') params.set('propia', 'eq.true');
    const pattern = accentInsensitivePattern(search);
    if (pattern) params.set($('searchMode').value === 'ingredients' ? 'ingredients' : 'title', 'imatch.' + pattern);
    applyCatalogFilters(params, { ocultas: state.currentScope === 'ocultas' });

    const { rows, total } = await dbCount('recetas', params);
    state.recipes = rows;
    state.totalRecipes = total;
}

function visibleRecipes() {
    if (state.currentScope !== 'favoritas') return state.recipes;
    const query = $('searchInput').value.trim();
    const byIngredients = $('searchMode').value === 'ingredients';
    return state.favoriteRecipes.filter(r =>
        (state.currentCategoryFilter === 'Todas' || r.categoria === state.currentCategoryFilter) &&
        matchesSearch(byIngredients ? r.ingredients : r.title, query)
    );
}

function recipeRowHtml(r) {
    const fav = isFavorite(r.id);
    return `<article class="recipe-row" data-action="open-recipe" data-id="${r.id}" tabindex="0" role="button">` +
        `<div class="recipe-row-text"><h3>${escapeHtml(r.title)}</h3>` +
        `<span class="recipe-row-cat">${escapeHtml(categoryName(r.categoria))}</span></div>` +
        `<button class="fav-btn${fav ? ' active' : ''}" type="button" data-action="toggle-fav" data-id="${r.id}" ` +
        `aria-pressed="${fav}" aria-label="${fav ? 'Quitar de favoritas' : 'Añadir a favoritas'}">${fav ? '★' : '☆'}</button></article>`;
}

export function renderRecipes() {
    const grid = $('recipesGrid');
    const list = visibleRecipes();
    const isFavScope = state.currentScope === 'favoritas';
    const count = isFavScope ? list.length : state.totalRecipes;
    $('recipesCount').textContent = count ? `${count.toLocaleString('es-ES')} ${count === 1 ? 'receta' : 'recetas'}` : '';

    if (list.length === 0) {
        const link = '<button class="link-btn" type="button" data-action="set-scope" data-scope="todas">todas las recetas</button>';
        grid.innerHTML = isFavScope && state.favorites.length === 0
            ? `<div class="empty-state"><p>Aún no tenéis favoritas.</p><p>Busca en ${link} y marca con ☆ las que os gusten.</p></div>`
            : isFavScope
                ? `<div class="empty-state"><p>Ninguna favorita coincide.</p><p>Buscar en ${link}</p></div>`
                : state.currentScope === 'ocultas'
                    ? '<div class="empty-state"><p>No hay recetas ocultas que coincidan.</p></div>'
                    : '<div class="empty-state"><p>No hay recetas que coincidan.</p></div>';
    } else {
        grid.innerHTML = list.map(recipeRowHtml).join('');
    }
    renderPagination(isFavScope);
}

function renderPagination(hide) {
    const pagination = $('recipePagination');
    const pageCount = Math.ceil(state.totalRecipes / RECIPES_PAGE_SIZE);
    const page = state.currentRecipePage;
    if (hide || pageCount <= 1) {
        pagination.innerHTML = '';
        return;
    }
    pagination.innerHTML =
        `<button class="btn btn-secondary" type="button" data-action="page" data-page="${page - 1}" ${page === 0 ? 'disabled' : ''}>‹ Anterior</button>` +
        `<span>${page + 1} de ${pageCount}</span>` +
        `<button class="btn btn-secondary" type="button" data-action="page" data-page="${page + 1}" ${page >= pageCount - 1 ? 'disabled' : ''}>Siguiente ›</button>`;
}

async function goToPage(page) {
    state.currentRecipePage = page;
    await refreshRecipes();
    $('view-recetas').scrollIntoView({ behavior: 'smooth' });
}

async function suggestRandom() {
    try {
        const r = await getRandomRecipe();
        if (!r) return showToast('No hay recetas para sugerir', true);
        state.randomMode = true;
        await openRecipe(r.id);
    } catch (e) {
        showToast('No se pudo sugerir una receta: ' + e.message, true);
    }
}

// ---------------------------------------------------------------- ficha de receta

function checklistHtml(lines) {
    if (lines.length === 0) return '<p class="hint">Sin ingredientes.</p>';
    return '<ul class="checklist">' + lines.map(line =>
        `<li><label><input type="checkbox" value="${escapeHtml(ingredientListName(line))}"><span>${escapeHtml(line)}</span></label></li>`
    ).join('') + '</ul>';
}

export async function openRecipe(id) {
    let detail;
    try {
        detail = await db('recetas', `?id=eq.${id}&select=id,title,url,ingredients,steps,categoria,oculta,notas`);
    } catch (e) {
        return showToast('No se pudo cargar la receta: ' + e.message, true);
    }
    const recipe = detail && detail[0];
    if (!recipe) return showToast('Esa receta ya no existe', true);
    state.currentRecipe = recipe;

    $('modalTitle').textContent = recipe.title;
    $('modalCategory').textContent = categoryName(recipe.categoria);
    updateModalFav();
    updateModalHidden();
    $('modalRandomAgainBtn').hidden = !state.randomMode;
    $('modalNotes').value = recipe.notas || '';
    $('modalNotesStatus').textContent = '';
    fitNotes();
    $('modalWeeklyDay').value = String(todayDiaId());
    $('modalWeeklyMealType').value = new Date().getHours() >= 17 ? 'Cena' : 'Comida';

    const lines = parseIngredients(recipe.ingredients);
    $('modalIngredientsCount').textContent = lines.length ? `(${lines.length})` : '';
    $('modalIngredients').innerHTML = checklistHtml(lines);
    const steps = parseSteps(recipe.steps, recipe.title);
    $('modalSteps').innerHTML = steps.length
        ? steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')
        : '<li class="hint">Sin pasos especificados.</li>';
    $('modalUrlWrapper').innerHTML = /^https?:\/\//i.test(recipe.url || '')
        ? `<a href="${escapeHtml(recipe.url)}" target="_blank" rel="noopener">🌐 Ver receta original</a>` : '';

    renderCategorySelects();
    $('editRecipeTitle').value = recipe.title;
    $('editRecipeCategory').value = recipe.categoria == null ? '' : String(recipe.categoria);
    document.querySelector('.recipe-edit').open = false;

    openModal('recipeModal');
    keepScreenOn();
}

// Mientras la receta está abierta la pantalla no se apaga (para cocinar con ella).
async function keepScreenOn() {
    try {
        if ('wakeLock' in navigator && !wakeLock) {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => { wakeLock = null; });
        }
    } catch { /* no soportado o sin permiso: no pasa nada */ }
}

function releaseScreen() {
    wakeLock?.release().catch(() => {});
    wakeLock = null;
}

function updateModalFav() {
    if (!state.currentRecipe) return;
    const fav = isFavorite(state.currentRecipe.id);
    const btn = $('modalFavBtn');
    btn.textContent = fav ? '★ Favorita' : '☆ Favorita';
    btn.classList.toggle('active', fav);
    btn.setAttribute('aria-pressed', String(fav));
}

function updateModalHidden() {
    if (!state.currentRecipe) return;
    const hidden = Boolean(state.currentRecipe.oculta);
    const btn = $('modalHideBtn');
    btn.textContent = hidden ? '👁️ Volver a mostrar' : '👎 No me interesa';
    btn.setAttribute('aria-pressed', String(hidden));
    $('modalHiddenNotice').hidden = !hidden;
}

async function toggleHidden() {
    const recipe = state.currentRecipe;
    if (!recipe) return;
    const oculta = !recipe.oculta;
    await dbUpdate('recetas', `?id=eq.${recipe.id}`, { oculta });
    recipe.oculta = oculta;
    const fav = state.favoriteRecipes.find(r => r.id === recipe.id);
    if (fav) fav.oculta = oculta;
    resetRandomPool();
    refreshRecipes();
    if (oculta && state.randomMode) {
        showToast('🙈 Oculta. Ahí va otra idea…');
        return suggestRandom();
    }
    updateModalHidden();
    showToast(oculta ? '🙈 Oculta. La puedes recuperar en «Recetas → Ocultas».' : '👁️ La receta vuelve a mostrarse');
}

// La nota crece con el texto (empieza en una línea).
function fitNotes() {
    const t = $('modalNotes');
    t.style.height = 'auto';
    t.style.height = t.scrollHeight + 2 + 'px';
}

async function saveNotes(id, value) {
    const notas = value.trim() || null;
    const stillOpen = () => state.currentRecipe && state.currentRecipe.id === id;
    try {
        await dbUpdate('recetas', `?id=eq.${id}`, { notas });
        if (stillOpen()) $('modalNotesStatus').textContent = notas ? '· guardado ✓' : '· nota borrada';
    } catch (e) {
        if (stillOpen()) $('modalNotesStatus').textContent = '';
        showToast('No se pudo guardar la nota: ' + e.message, true);
    }
}

async function addCheckedIngredients() {
    const checked = [...$('modalIngredients').querySelectorAll('input[type="checkbox"]:checked')];
    if (checked.length === 0) return showToast('Marca primero los ingredientes que te faltan');
    await addShoppingTexts(checked.map(i => i.value));
    checked.forEach(i => { i.checked = false; });
    showToast(`🛒 ${plural(checked.length, 'ingrediente añadido', 'ingredientes añadidos')} a la lista`);
}

async function afterRecipeChange() {
    await Promise.all([loadFavorites(), loadWeek()]);
    await refreshRecipes();
}

async function saveTitle() {
    const title = $('editRecipeTitle').value.trim();
    const recipe = state.currentRecipe;
    if (!recipe || !title) return;
    await dbUpdate('recetas', `?id=eq.${recipe.id}`, { title });
    recipe.title = title;
    $('modalTitle').textContent = title;
    await afterRecipeChange();
    showToast('Nombre actualizado');
}

function askDeleteRecipe() {
    const recipe = state.currentRecipe;
    if (!recipe) return;
    askConfirm(`¿Eliminar la receta «${recipe.title}»? No se puede deshacer.`, 'Sí, eliminar', async () => {
        // sin borrado en cascada en la base de datos: primero lo que la usa
        await dbDelete('recetas_favoritas', `?receta_id=eq.${recipe.id}`);
        await dbDelete('menu_semanal_actual', `?receta_id=eq.${recipe.id}`);
        await dbDelete('semanas_guardadas', `?receta_id=eq.${recipe.id}`);
        await dbDelete('recetas', `?id=eq.${recipe.id}`);
        closeModal('recipeModal');
        await afterRecipeChange();
        showToast('Receta eliminada');
    });
}

// ---------------------------------------------------------------- nueva receta / importar

function openAddRecipe() {
    renderCategorySelects();
    $('importStatus').textContent = '';
    openModal('addRecipeModal');
}

// La Edge Function supabase/functions/importar-receta lee la página (el navegador no
// puede, por CORS) y devuelve título, ingredientes y pasos para revisar antes de guardar.
async function importFromUrl() {
    const url = $('importUrl').value.trim();
    const status = $('importStatus');
    if (!/^https?:\/\/\S+\.\S+/i.test(url)) {
        status.textContent = 'Pega un enlace completo, que empiece por https://';
        return;
    }
    // ¿Ya la tenemos? (las importadas vienen de recetasgratis y recetas.com)
    try {
        const existing = await db('recetas', `?select=id,title&url=eq.${encodeURIComponent(url)}&limit=1`);
        if (existing && existing[0]) {
            closeModal('addRecipeModal');
            showToast(`Ya la teníais: «${existing[0].title}»`);
            state.randomMode = false;
            return openRecipe(existing[0].id);
        }
    } catch { /* si falla la comprobación, se importa igualmente */ }

    const btn = $('importUrlBtn');
    btn.disabled = true;
    btn.textContent = 'Leyendo…';
    status.textContent = '⏳ Leyendo la receta de la web…';
    try {
        const { status: code, ok, data } = await callFunction('importar-receta', { url });
        if (code === 404 && !data.error) {
            status.textContent = '⚠️ La importación aún no está activada en Supabase (falta desplegar la función «importar-receta»).';
            return;
        }
        if (!ok) {
            status.textContent = `⚠️ ${data.error || 'No se pudo leer esa web'}. Puedes copiar la receta a mano abajo.`;
            if (data.title && !$('newRecipeTitle').value) $('newRecipeTitle').value = data.title;
            $('newRecipeUrl').value = url;
            return;
        }
        $('newRecipeTitle').value = data.title || '';
        $('newRecipeUrl').value = data.url || url;
        $('newRecipeIngredients').value = (data.ingredients || []).join('\n');
        $('newRecipeSteps').value = (data.steps || []).join('\n');
        status.textContent = `✅ ${plural((data.ingredients || []).length, 'ingrediente', 'ingredientes')} y ` +
            `${plural((data.steps || []).length, 'paso', 'pasos')}. Revisa, elige la categoría y guarda.`;
        $('newRecipeCategory').focus();
    } catch (e) {
        status.textContent = '⚠️ No se pudo conectar: ' + e.message;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Importar';
    }
}

async function saveNewRecipe(form) {
    const title = $('newRecipeTitle').value.trim();
    const ingredients = $('newRecipeIngredients').value.trim();
    const steps = $('newRecipeSteps').value.trim();
    if (!title || !ingredients || !steps) return;
    const row = {
        title, ingredients, steps,
        url: $('newRecipeUrl').value.trim() || null,
        categoria: $('newRecipeCategory').value ? Number($('newRecipeCategory').value) : null,
        propia: true,
        tipo: 'principal'
    };
    try {
        const inserted = await dbInsert('recetas', row);
        form.reset();
        $('importUrl').value = '';
        $('importStatus').textContent = '';
        closeModal('addRecipeModal');
        showToast('Receta guardada');
        setScope('propias');
        if (inserted && inserted[0]) {
            state.randomMode = false;
            openRecipe(inserted[0].id);
        }
    } catch (e) {
        showToast('No se pudo guardar la receta: ' + e.message, true);
    }
}

// ---------------------------------------------------------------- arranque

export function setupRecipes() {
    $('modalWeeklyDay').innerHTML = DIAS.map(d => `<option value="${d.id}">${d.nombre}</option>`).join('');

    $('searchInput').addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            state.currentRecipePage = 0;
            refreshRecipes();
        }, 300);
    });
    $('searchMode').addEventListener('change', () => {
        state.currentRecipePage = 0;
        if ($('searchInput').value.trim()) refreshRecipes();
    });

    $('modalNotes').addEventListener('input', () => {
        const recipe = state.currentRecipe;
        if (!recipe) return;
        const value = $('modalNotes').value;
        recipe.notas = value;
        fitNotes();
        $('modalNotesStatus').textContent = '· guardando…';
        clearTimeout(notesTimer);
        notesTimer = setTimeout(() => saveNotes(recipe.id, value), 900);
    });

    $('editRecipeCategory').addEventListener('change', async (e) => {
        const recipe = state.currentRecipe;
        if (!recipe) return;
        const categoria = e.target.value ? Number(e.target.value) : null;
        try {
            await dbUpdate('recetas', `?id=eq.${recipe.id}`, { categoria });
            recipe.categoria = categoria;
            $('modalCategory').textContent = categoryName(categoria);
            await afterRecipeChange();
            showToast('Categoría actualizada');
        } catch (err) {
            showToast('No se pudo actualizar la categoría: ' + err.message, true);
        }
    });
    $('editRecipeTitle').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveTitle().catch(err => showToast('No se pudo actualizar el nombre: ' + err.message, true));
    });

    $('importUrl').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            importFromUrl();
        }
    });
    $('addRecipeForm').addEventListener('submit', (e) => {
        e.preventDefault();
        saveNewRecipe(e.target);
    });

    // Filas de receta accesibles con teclado
    $('recipesGrid').addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('recipe-row')) {
            e.preventDefault();
            e.target.click();
        }
    });

    onModalClose('recipeModal', () => {
        state.randomMode = false;
        releaseScreen();
    });
    // al volver a la app, el bloqueo de pantalla se pierde: se pide de nuevo si la receta sigue abierta
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && $('recipeModal').open) keepScreenOn();
    });

    on('favoritos', () => {
        renderRecipes();
        updateModalFav();
    });
    on('categorias', () => {
        renderCategoryFilters();
        renderCategorySelects();
        renderRecipes();
    });
    on('catalogo', refreshRecipes);
}

registerActions({
    'open-recipe': (el) => {
        state.randomMode = false;
        return openRecipe(Number(el.dataset.id));
    },
    'toggle-fav': (el) => toggleFavorite(Number(el.dataset.id)),
    'set-scope': (el) => setScope(el.dataset.scope),
    'filter-cat': (el) => setCategoryFilter(el.dataset.cat),
    'page': (el) => goToPage(Number(el.dataset.page)),
    'random-recipe': suggestRandom,
    'open-add-recipe': openAddRecipe,
    'import-url': importFromUrl,
    'modal-fav': () => state.currentRecipe && toggleFavorite(state.currentRecipe.id),
    'modal-hide': toggleHidden,
    'modal-add-week': () => state.currentRecipe && addToWeek(
        Number($('modalWeeklyDay').value), $('modalWeeklyMealType').value, state.currentRecipe),
    'modal-add-ingredients': addCheckedIngredients,
    'modal-save-title': saveTitle,
    'modal-delete': askDeleteRecipe
});
