// Pestaña Semana: el menú que se está planificando (menu_semanal_actual), elegir
// receta para un hueco, rellenar huecos, ingredientes de la semana y menús guardados
// (semanas_guardadas).

import { DIAS, TIPOS_COMIDA } from './config.js';
import { db, dbInsert, dbUpdate, dbDelete } from './api.js';
import { state, on, isFavorite, categoryName } from './state.js';
import { $, escapeHtml, accentInsensitivePattern, shuffle, todayDiaId, diaNombre, plural } from './util.js';
import { registerActions, openModal, closeModal, openSheet, showToast, askConfirm } from './ui.js';
import { applyCatalogFilters, isMenuRecipe, randomServerRecipes, getRandomRecipe } from './catalogo.js';
import { chooseWeekRecipes } from './sugerencias.js';
import { mergeIngredients, ingredientListName } from './ingredientes.js';
import { addShoppingTexts } from './compra.js';
import { openRecipe } from './recetas.js';

let pickerSlot = null;       // {dia, tipo} del hueco que se está eligiendo
let pickerSearchTimer = null;
let pickerSearchToken = 0;
let savedMenus = {};         // semana -> [{dia, tipo_comida, receta_id, title, creado_en}]
let openSavedSemana = null;

const slotKey = (dia, tipo) => `${dia}_${tipo}`;

// ---------------------------------------------------------------- datos

// keepOnError: en las recargas en segundo plano un fallo de red no debe vaciar la semana.
export async function loadWeek({ keepOnError = false } = {}) {
    try {
        const data = await db('menu_semanal_actual', '?select=id,dia,tipo_comida,receta_id,recetas(title,categoria)');
        state.currentWeekMenu = {};
        (data || []).forEach(row => {
            state.currentWeekMenu[slotKey(row.dia, row.tipo_comida)] = {
                receta_id: row.receta_id,
                title: row.recetas ? row.recetas.title : 'Receta eliminada',
                categoria: row.recetas ? row.recetas.categoria : null,
                draftId: row.id
            };
        });
    } catch (e) {
        console.error('Error cargando el menú semanal:', e);
        if (!keepOnError) state.currentWeekMenu = {};
    }
    renderWeek();
}

export async function addToWeek(dia, tipo, recipe) {
    const key = slotKey(dia, tipo);
    const existing = state.currentWeekMenu[key];
    let draftId;
    if (existing && existing.draftId) {
        await dbUpdate('menu_semanal_actual', `?id=eq.${existing.draftId}`, { receta_id: recipe.id });
        draftId = existing.draftId;
    } else {
        const inserted = await dbInsert('menu_semanal_actual', { dia, tipo_comida: tipo, receta_id: recipe.id });
        draftId = inserted[0].id;
    }
    state.currentWeekMenu[key] = { receta_id: recipe.id, title: recipe.title, categoria: recipe.categoria ?? null, draftId };
    renderWeek();
    showToast(`«${recipe.title}» → ${diaNombre(dia)}, ${tipo.toLowerCase()}`);
}

async function removeFromWeek(key) {
    const entry = state.currentWeekMenu[key];
    if (!entry) return;
    if (entry.draftId) await dbDelete('menu_semanal_actual', `?id=eq.${entry.draftId}`);
    delete state.currentWeekMenu[key];
    renderWeek();
}

async function clearWeek() {
    await dbDelete('menu_semanal_actual', '?id=not.is.null');
    state.currentWeekMenu = {};
    renderWeek();
}

// ---------------------------------------------------------------- pintar

// Comida vacía -> elegir receta; con receta -> menú de opciones (ver, cambiar, quitar).
function mealHtml(dia, tipo, menu) {
    const entry = menu[slotKey(dia, tipo)];
    const label = `<span class="meal-label">${tipo}</span>`;
    if (!entry) {
        return `<button class="meal empty" type="button" data-action="slot-pick" data-dia="${dia}" data-tipo="${tipo}">` +
            `${label}<span class="meal-title">+ Elegir</span></button>`;
    }
    return `<button class="meal" type="button" data-action="slot-menu" data-dia="${dia}" data-tipo="${tipo}" ` +
        `aria-label="${tipo} del ${diaNombre(dia)}: ${escapeHtml(entry.title)}. Opciones">` +
        `${label}<span class="meal-title">${escapeHtml(entry.title)}</span></button>`;
}

function weekHtml(menu) {
    const today = todayDiaId();
    return DIAS.map(d => {
        const isToday = d.id === today;
        return `<div class="day${isToday ? ' today' : ''}">` +
            `<div class="day-name"><span>${d.corto}</span>${isToday ? '<span class="today-tag">Hoy</span>' : ''}</div>` +
            `<div class="day-meals">${TIPOS_COMIDA.map(t => mealHtml(d.id, t, menu)).join('')}</div></div>`;
    }).join('');
}

export function renderWeek() {
    $('weeklyGrid').innerHTML = weekHtml(state.currentWeekMenu);
    const filled = Object.keys(state.currentWeekMenu).length;
    const total = DIAS.length * TIPOS_COMIDA.length;
    $('weekProgress').textContent = filled === 0
        ? 'Toca «+ Elegir» en cualquier hueco, o «✨ Rellenar» para que la app proponga.'
        : `${filled} de ${total} comidas planificadas`;
    $('fillWeekBtn').hidden = filled === total;
}

// ---------------------------------------------------------------- opciones de una comida

function openSlotMenu(dia, tipo) {
    const key = slotKey(dia, tipo);
    const entry = state.currentWeekMenu[key];
    if (!entry) return openPicker(dia, tipo);
    openSheet({
        title: `${diaNombre(dia)} · ${tipo}`,
        subtitle: entry.title,
        options: [
            { label: '📖 Ver receta', run: () => openRecipe(entry.receta_id) },
            { label: '🔄 Cambiar por otra', run: () => openPicker(dia, tipo) },
            { label: '🗑️ Quitar del menú', danger: true, run: () => removeFromWeek(key) }
        ]
    });
}

function openWeekMenu() {
    openSheet({
        title: 'Semana',
        options: [
            { label: '💾 Guardar en el historial', run: saveWeek },
            { label: '📋 Menús anteriores', run: openSavedMenus },
            {
                label: '🗑️ Vaciar la semana', danger: true, run: () => {
                    if (Object.keys(state.currentWeekMenu).length === 0) return showToast('La semana ya está vacía');
                    askConfirm('¿Vaciar el menú de esta semana?', 'Sí, vaciar', clearWeek);
                }
            }
        ]
    });
}

// ---------------------------------------------------------------- elegir receta para un hueco

function openPicker(dia, tipo) {
    pickerSlot = { dia, tipo };
    $('pickerTitle').textContent = `${diaNombre(dia)} · ${tipo}`;
    $('pickerSearch').value = '';
    renderPickerResults();
    openModal('recipePickerModal');
}

function pickerItemHtml(r) {
    return `<button class="list-item" type="button" data-action="pick-recipe" data-id="${r.id}" ` +
        `data-title="${escapeHtml(r.title)}" data-categoria="${r.categoria ?? ''}">` +
        `<span class="list-item-title">${isFavorite(r.id) ? '⭐ ' : ''}${escapeHtml(r.title)}</span>` +
        `<small class="list-item-sub">${escapeHtml(categoryName(r.categoria))}</small></button>`;
}

async function renderPickerResults() {
    const list = $('pickerResults');
    const query = $('pickerSearch').value.trim();
    const token = ++pickerSearchToken;
    if (!query) {
        const favs = state.favoriteRecipes.filter(isMenuRecipe);
        list.innerHTML = favs.length
            ? '<p class="list-section">⭐ Vuestras favoritas</p>' + favs.map(pickerItemHtml).join('')
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
        const data = await db('recetas', '?' + params) || [];
        if (token !== pickerSearchToken) return;
        data.sort((a, b) => Number(isFavorite(b.id)) - Number(isFavorite(a.id)));
        list.innerHTML = data.length ? data.map(pickerItemHtml).join('') : '<p class="hint">No hay recetas con ese nombre.</p>';
    } catch {
        if (token === pickerSearchToken) list.innerHTML = '<p class="hint">No se pudo buscar. Revisa la conexión.</p>';
    }
}

async function pickForSlot(recipe) {
    if (!pickerSlot) return;
    await addToWeek(pickerSlot.dia, pickerSlot.tipo, recipe);
    closeModal('recipePickerModal');
}

// ---------------------------------------------------------------- rellenar huecos

function emptySlots() {
    const slots = [];
    DIAS.forEach(d => TIPOS_COMIDA.forEach(tipo => {
        if (!state.currentWeekMenu[slotKey(d.id, tipo)]) slots.push({ dia: d.id, tipo });
    }));
    return slots;
}

function askFillWeek() {
    const slots = emptySlots();
    if (slots.length === 0) return showToast('La semana ya está completa');
    askConfirm(
        `¿Rellenar ${slots.length === 1 ? 'el hueco vacío' : `los ${slots.length} huecos vacíos`} con sugerencias?\n` +
        'Sobre todo vuestras favoritas, sin repetir las últimas semanas. Luego puedes cambiar cualquiera.',
        '✨ Rellenar', () => fillWeek(slots), { danger: false }
    );
}

async function recentMenuRecipeIds(weeks = 3) {
    try {
        const rows = await db('semanas_guardadas', `?select=semana,receta_id&order=semana.desc&limit=${weeks * 14}`) || [];
        if (rows.length === 0) return [];
        const minSemana = rows[0].semana - weeks + 1;
        return rows.filter(r => r.semana >= minSemana).map(r => r.receta_id);
    } catch {
        return [];
    }
}

async function fillWeek(slots) {
    const btn = $('fillWeekBtn');
    btn.disabled = true;
    btn.textContent = '✨ Buscando…';
    try {
        const used = new Set([
            ...Object.values(state.currentWeekMenu).map(e => e.receta_id),
            ...await recentMenuRecipeIds()
        ]);
        const favs = shuffle(state.favoriteRecipes.filter(r => isMenuRecipe(r) && !used.has(r.id)));
        const extra = (await randomServerRecipes(slots.length * 3).catch(() => []))
            .filter(r => !used.has(r.id) && !isFavorite(r.id));
        // ~60 % favoritas si hay suficientes; el resto, descubrimientos.
        const nFavs = Math.min(favs.length, Math.ceil(slots.length * 0.6));
        const candidates = [...favs.slice(0, nFavs), ...extra, ...favs.slice(nFavs)];
        const plan = {};
        Object.entries(state.currentWeekMenu).forEach(([k, e]) => { plan[k] = { categoria: e.categoria }; });
        const chosen = chooseWeekRecipes(slots, candidates, plan, categoryName);
        if (chosen.length === 0) return showToast('No hay recetas suficientes para sugerir. Marca algunas favoritas.', true);

        const inserted = await dbInsert('menu_semanal_actual',
            chosen.map(c => ({ dia: c.dia, tipo_comida: c.tipo, receta_id: c.recipe.id }))) || [];
        chosen.forEach(c => {
            const row = inserted.find(r => r.dia === c.dia && r.tipo_comida === c.tipo);
            state.currentWeekMenu[slotKey(c.dia, c.tipo)] = {
                receta_id: c.recipe.id, title: c.recipe.title, categoria: c.recipe.categoria, draftId: row && row.id
            };
        });
        renderWeek();
        showToast(`✨ ${plural(chosen.length, 'hueco rellenado', 'huecos rellenados')}. Toca una comida para cambiarla.`);
    } catch (e) {
        showToast('No se pudo rellenar la semana: ' + e.message, true);
        await loadWeek({ keepOnError: true });
    } finally {
        btn.disabled = false;
        btn.textContent = '✨ Rellenar';
    }
}

// ---------------------------------------------------------------- ingredientes de la semana

let weekIngredients = [];

async function openWeekIngredients() {
    const ids = [...new Set(Object.values(state.currentWeekMenu).map(e => e.receta_id).filter(Boolean))];
    if (ids.length === 0) return showToast('Primero añade recetas a la semana');
    const recipes = await db('recetas', `?select=id,title,ingredients&id=in.(${ids.join(',')})&order=title.asc`) || [];
    weekIngredients = mergeIngredients(recipes).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    const item = (ing, i) => {
        const detalle = ing.lineas.length > 1 ? ing.lineas.join(' · ') : ing.lineas[0];
        return `<li><label><input type="checkbox" data-index="${i}">` +
            `<span class="ing-name">${escapeHtml(ing.nombre)}${ing.recetas.length > 1 ? ` <span class="ing-count">×${ing.recetas.length}</span>` : ''}</span>` +
            `<small class="ing-detail">${escapeHtml(detalle)} — ${escapeHtml(ing.recetas.join(', '))}</small></label></li>`;
    };
    const indexed = weekIngredients.map((ing, i) => ({ ing, i }));
    const toBuy = indexed.filter(x => !x.ing.basico);
    const basics = indexed.filter(x => x.ing.basico);
    $('ingredientsModalBody').innerHTML =
        `<div class="list-head"><p class="hint">${plural(recipes.length, 'receta', 'recetas')} · marca lo que tienes que comprar.</p>` +
        `<button class="link-btn" type="button" data-action="week-ingredients-all">Marcar todo</button></div>` +
        `<ul class="checklist" id="toBuyList">${toBuy.map(x => item(x.ing, x.i)).join('')}</ul>` +
        (basics.length ? `<details class="basics"><summary>🧂 Básicos de despensa (${basics.length})</summary>` +
            `<ul class="checklist">${basics.map(x => item(x.ing, x.i)).join('')}</ul></details>` : '');
    openModal('ingredientsModal');
}

async function addWeekIngredients() {
    const checked = [...$('ingredientsModalBody').querySelectorAll('input[type="checkbox"]:checked')];
    if (checked.length === 0) return showToast('Marca primero lo que tienes que comprar');
    const names = checked.map(c => {
        const ing = weekIngredients[Number(c.dataset.index)];
        // con una sola receta se conserva la cantidad; si se junta de varias, solo el nombre
        return ing.lineas.length === 1 ? ingredientListName(ing.lineas[0]) : ing.nombre;
    });
    await addShoppingTexts(names);
    checked.forEach(c => { c.checked = false; });
    showToast(`🛒 ${plural(names.length, 'ingrediente añadido', 'ingredientes añadidos')} a la lista`);
}

// ---------------------------------------------------------------- historial

async function saveWeek() {
    const entries = Object.entries(state.currentWeekMenu);
    if (entries.length === 0) return showToast('Añade al menos una receta antes de guardar la semana');
    try {
        const last = await db('semanas_guardadas', '?select=semana&order=semana.desc&limit=1');
        const nextSemana = last && last.length > 0 ? last[0].semana + 1 : 1;
        await dbInsert('semanas_guardadas', entries.map(([key, val]) => {
            const [dia, tipo] = key.split('_');
            return { semana: nextSemana, dia: Number(dia), tipo_comida: tipo, receta_id: val.receta_id };
        }));
        askConfirm('Menú guardado en el historial ✅\n¿Vaciar el calendario para empezar una semana nueva?',
            'Sí, empezar semana nueva', clearWeek, { danger: false, noLabel: 'No, mantenerlo' });
    } catch (e) {
        showToast('No se pudo guardar el menú: ' + e.message, true);
    }
}

async function openSavedMenus() {
    try {
        const data = await db('semanas_guardadas', '?select=id,semana,dia,tipo_comida,receta_id,creado_en,recetas(title)&order=semana.desc,dia.asc');
        savedMenus = {};
        (data || []).forEach(row => {
            (savedMenus[row.semana] ||= []).push({
                dia: row.dia, tipo_comida: row.tipo_comida, receta_id: row.receta_id, creado_en: row.creado_en,
                title: row.recetas ? row.recetas.title : 'Receta eliminada'
            });
        });
        openSavedSemana = null;
        renderSavedMenus();
        closeModal('settingsModal');
        openModal('savedMenusModal');
    } catch (e) {
        showToast('No se pudieron cargar los menús guardados: ' + e.message, true);
    }
}

function savedMenuLabel(semana) {
    const first = (savedMenus[semana] || [])[0];
    const fecha = first && first.creado_en
        ? new Date(first.creado_en).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
        : '';
    return fecha ? `Semana del ${fecha}` : `Menú ${semana}`;
}

function renderSavedMenus() {
    const list = $('savedMenusList');
    const semanas = Object.keys(savedMenus).sort((a, b) => b - a);
    if (semanas.length === 0) {
        list.innerHTML = '<div class="empty-state"><p>Todavía no habéis guardado ningún menú.</p>' +
            '<p>En la pestaña Semana, «⋯ → Guardar en el historial».</p></div>';
        return;
    }
    list.innerHTML = semanas.map(semana => {
        const isOpen = String(openSavedSemana) === String(semana);
        const entries = savedMenus[semana];
        const corto = id => (DIAS.find(d => d.id === id) || {}).corto || '';
        const ordered = [...entries].sort((a, b) => a.dia - b.dia || TIPOS_COMIDA.indexOf(a.tipo_comida) - TIPOS_COMIDA.indexOf(b.tipo_comida));
        const detail = '<ul class="saved-meals">' + ordered.map(e =>
            `<li><span class="meal-label">${corto(e.dia)} · ${e.tipo_comida}</span>` +
            (e.receta_id
                ? `<button class="link-btn" type="button" data-action="open-recipe" data-id="${e.receta_id}">${escapeHtml(e.title)}</button>`
                : `<span>${escapeHtml(e.title)}</span>`) + '</li>').join('') + '</ul>';
        return `<div class="saved-menu${isOpen ? ' open' : ''}">` +
            `<button class="saved-menu-head" type="button" data-action="saved-toggle" data-semana="${semana}" aria-expanded="${isOpen}">` +
            `<span>${escapeHtml(savedMenuLabel(semana))}</span><small class="hint">${plural(entries.length, 'comida', 'comidas')} ${isOpen ? '▲' : '▼'}</small></button>` +
            (isOpen ? detail : '') +
            `<div class="saved-menu-actions">` +
            `<button class="btn btn-primary btn-small" type="button" data-action="saved-repeat" data-semana="${semana}">🔁 Repetir este menú</button>` +
            `<button class="btn btn-danger-ghost btn-small" type="button" data-action="saved-delete" data-semana="${semana}" aria-label="Eliminar ${escapeHtml(savedMenuLabel(semana))}">🗑️</button>` +
            `</div></div>`;
    }).join('');
}

function repeatSavedMenu(semana) {
    const entries = (savedMenus[semana] || []).filter(e => e.receta_id != null);
    const doRepeat = async () => {
        await dbDelete('menu_semanal_actual', '?id=not.is.null');
        if (entries.length) await dbInsert('menu_semanal_actual', entries.map(e => ({ dia: e.dia, tipo_comida: e.tipo_comida, receta_id: e.receta_id })));
        await loadWeek();
        closeModal('savedMenusModal');
        location.hash = 'semana';
        showToast('🔁 Menú copiado a esta semana');
    };
    if (Object.keys(state.currentWeekMenu).length > 0) {
        askConfirm('Esto sustituirá el menú que tienes ahora en la semana. ¿Continuar?', 'Sí, sustituir', doRepeat, { danger: false });
    } else {
        doRepeat().catch(e => showToast('No se pudo copiar el menú: ' + e.message, true));
    }
}

function askDeleteSavedMenu(semana) {
    askConfirm(`¿Eliminar «${savedMenuLabel(semana)}»? No se podrá recuperar.`, 'Sí, eliminar', async () => {
        await dbDelete('semanas_guardadas', `?semana=eq.${semana}`);
        delete savedMenus[semana];
        openSavedSemana = null;
        renderSavedMenus();
    });
}

// ---------------------------------------------------------------- arranque

export function setupWeek() {
    $('pickerSearch').addEventListener('input', () => {
        clearTimeout(pickerSearchTimer);
        pickerSearchToken++;
        if ($('pickerSearch').value.trim()) $('pickerResults').innerHTML = '<p class="hint">Buscando…</p>';
        pickerSearchTimer = setTimeout(renderPickerResults, 250);
    });
    // el nombre de categoría de cada comida (para "Rellenar") llega con las categorías
    on('categorias', renderWeek);
}

export { openSavedMenus };

registerActions({
    'slot-pick': (el) => openPicker(Number(el.dataset.dia), el.dataset.tipo),
    'slot-menu': (el) => openSlotMenu(Number(el.dataset.dia), el.dataset.tipo),
    'pick-recipe': (el) => pickForSlot({
        id: Number(el.dataset.id), title: el.dataset.title,
        categoria: el.dataset.categoria ? Number(el.dataset.categoria) : null
    }),
    'picker-random': async () => {
        const r = await getRandomRecipe();
        if (r) await pickForSlot(r);
    },
    'week-fill': askFillWeek,
    'week-more': openWeekMenu,
    'week-ingredients': openWeekIngredients,
    'week-ingredients-all': () => {
        $('toBuyList').querySelectorAll('input').forEach(c => { c.checked = true; });
    },
    'week-ingredients-add': addWeekIngredients,
    'saved-toggle': (el) => {
        openSavedSemana = String(openSavedSemana) === el.dataset.semana ? null : el.dataset.semana;
        renderSavedMenus();
    },
    'saved-repeat': (el) => repeatSavedMenu(el.dataset.semana),
    'saved-delete': (el) => askDeleteSavedMenu(el.dataset.semana),
    'open-saved-menus': openSavedMenus
});

// Cuando cambia algo de la semana desde otra pantalla
on('semana', renderWeek);
