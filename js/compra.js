// Pestaña Compra: lista de la compra (lista_compra), sugerencias del catálogo de
// productos y «Lo de siempre» (compra_habitual).
//
// Un artículo es un producto del catálogo (id_producto) o texto libre (texto).
// "2 tomates", "Tomate" y "Tomates (500 g)" son el mismo artículo (shoppingKey).

import { db, dbInsert, dbUpdate, dbDelete } from './api.js';
import { state, on } from './state.js';
import { $, escapeHtml, normalizeText, plural } from './util.js';
import { registerActions, showToast, askConfirm } from './ui.js';
import { shoppingKey, ingredientParts } from './ingredientes.js';
import { groupBySection } from './pasillos.js';

// ---------------------------------------------------------------- datos

export async function loadProducts() {
    state.products = await db('productos', '?select=id,nombre&order=nombre.asc') || [];
}

export async function loadShoppingList() {
    const data = await db('lista_compra', '?select=id,id_producto,cantidad,texto,comprado,productos(nombre)&order=id.asc');
    state.shoppingList = (data || []).map(item => ({
        id: item.id,
        id_producto: item.id_producto,
        cantidad: Number.isInteger(item.cantidad) && item.cantidad > 0 ? item.cantidad : 1,
        nombre: (item.productos && item.productos.nombre) || item.texto || 'Producto',
        comprado: Boolean(item.comprado)
    }));
    renderShoppingList();
    setStatus('');
}

async function addProductToList(product, qty) {
    const existing = state.shoppingList.find(i => i.id_producto === product.id && !i.comprado);
    if (existing) await dbUpdate('lista_compra', `?id=eq.${existing.id}`, { cantidad: existing.cantidad + qty });
    else await dbInsert('lista_compra', { id_producto: product.id, cantidad: qty });
}

// Las altas van en cola: si dos se solapan (doble toque) no se duplican.
let queue = Promise.resolve();
export function addShoppingTexts(texts, qty = 1) {
    const run = queue.then(() => addTextsNow(texts, qty));
    queue = run.catch(() => {});
    return run;
}

// Si coincide con un producto del catálogo se usa ese producto; si ya está en la lista
// se suma la cantidad; si no, se guarda como texto libre.
async function addTextsNow(texts, qty) {
    const textRows = [];
    for (const raw of texts) {
        const name = String(raw || '').trim();
        if (!name) continue;
        const key = shoppingKey(name);
        const product = state.products.find(p => shoppingKey(p.nombre) === key);
        if (product) {
            await addProductToList(product, qty);
            await loadShoppingList();
            continue;
        }
        const existing = state.shoppingList.find(i => !i.comprado && shoppingKey(i.nombre) === key);
        if (existing) {
            await dbUpdate('lista_compra', `?id=eq.${existing.id}`, { cantidad: existing.cantidad + qty });
            continue;
        }
        if (!textRows.some(r => shoppingKey(r.texto) === key)) textRows.push({ texto: name, cantidad: qty, id_producto: null });
    }
    if (textRows.length) await dbInsert('lista_compra', textRows);
    await loadShoppingList();
}

// "2 tomates" -> 2 x tomates
async function addFromInput(text) {
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

async function addProductById(id) {
    const product = state.products.find(p => String(p.id) === String(id));
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

async function toggleItem(id) {
    const item = state.shoppingList.find(i => i.id === id);
    if (!item) return;
    item.comprado = !item.comprado;
    renderShoppingList();
    try {
        await dbUpdate('lista_compra', `?id=eq.${id}`, { comprado: item.comprado });
    } catch (e) {
        item.comprado = !item.comprado;
        renderShoppingList();
        showError(e);
    }
}

async function changeQuantity(id, delta) {
    const item = state.shoppingList.find(i => i.id === id);
    if (!item) return;
    const cantidad = item.cantidad + delta;
    if (cantidad < 1) return removeItem(id);
    item.cantidad = cantidad;
    renderShoppingList();
    try {
        await dbUpdate('lista_compra', `?id=eq.${id}`, { cantidad });
    } catch (e) {
        showError(e);
        await loadShoppingList();
    }
}

async function removeItem(id) {
    await dbDelete('lista_compra', `?id=eq.${id}`);
    await loadShoppingList();
}

async function clearChecked() {
    const ids = state.shoppingList.filter(i => i.comprado).map(i => i.id);
    if (ids.length === 0) return;
    await dbDelete('lista_compra', `?id=in.(${ids.join(',')})`);
    await loadShoppingList();
    showToast(`${plural(ids.length, 'producto quitado', 'productos quitados')}`);
}

async function clearAll() {
    await dbDelete('lista_compra', '?id=not.is.null');
    await loadShoppingList();
}

function showError(error) {
    console.error('Error en la lista de compra:', error);
    setStatus('Error: ' + error.message, true);
}

function setStatus(message, isError = false) {
    const el = $('shoppingStatus');
    el.textContent = message;
    el.classList.toggle('error-text', isError);
}

// ---------------------------------------------------------------- pintar

function itemHtml(item) {
    const qty = item.cantidad > 1
        ? `<button type="button" data-action="shop-dec" data-id="${item.id}" aria-label="Uno menos de ${escapeHtml(item.nombre)}">−</button>`
        : `<button type="button" class="qty-remove" data-action="shop-remove" data-id="${item.id}" aria-label="Quitar ${escapeHtml(item.nombre)}">🗑</button>`;
    return `<li class="shop-item${item.comprado ? ' checked' : ''}">` +
        `<button class="shop-check" type="button" role="checkbox" aria-checked="${item.comprado}" data-action="shop-toggle" data-id="${item.id}">` +
        `<span class="box" aria-hidden="true"></span><span class="shop-name">${escapeHtml(item.nombre)}</span></button>` +
        (item.comprado ? '' :
            `<div class="qty">${qty}<span class="qty-n" aria-label="Cantidad">${item.cantidad}</span>` +
            `<button type="button" data-action="shop-inc" data-id="${item.id}" aria-label="Uno más de ${escapeHtml(item.nombre)}">+</button></div>`) +
        `</li>`;
}

export function renderShoppingList() {
    const pending = state.shoppingList.filter(i => !i.comprado);
    const done = state.shoppingList.filter(i => i.comprado);
    const count = $('cartCount');
    count.textContent = pending.length;
    count.hidden = pending.length === 0;

    const listEl = $('shoppingList');
    if (state.shoppingList.length === 0) {
        listEl.innerHTML = '<li class="empty-state">La lista está vacía. Escribe arriba, toca «Lo de siempre» o añade ingredientes desde una receta o desde la semana.</li>';
    } else {
        const header = text => `<li class="list-section" aria-hidden="true">${text}</li>`;
        const groups = groupBySection(pending);
        listEl.innerHTML =
            groups.map(g => (groups.length > 1 ? header(g.titulo) : '') + g.items.map(itemHtml).join('')).join('') +
            (done.length ? header(`✅ En el carro (${done.length})`) + done.map(itemHtml).join('') : '');
    }
    $('clearCheckedBtn').hidden = done.length === 0;
    renderHabituales();
}

function renderSuggestions() {
    const query = normalizeText($('shoppingInput').value.trim().replace(/^\d+\s*[x×]?\s+/i, ''));
    const box = $('shoppingSuggestions');
    if (!query) {
        box.innerHTML = '';
        return;
    }
    const results = state.products.filter(p => normalizeText(p.nombre).includes(query)).slice(0, 8);
    box.innerHTML = results.map(p =>
        `<button class="chip" type="button" data-action="add-suggestion" data-id="${escapeHtml(p.id)}">+ ${escapeHtml(p.nombre)}</button>`
    ).join('');
}

// ---------------------------------------------------------------- lo de siempre
// Lo que se añade a mano se cuenta en compra_habitual; los más repetidos y los fijos (📌)
// salen como botones. Lo que llega desde los ingredientes de una receta no cuenta.

export async function loadHabituales() {
    try {
        state.habituales = await db('compra_habitual', '?select=clave,nombre,veces,fijo,ultima_vez') || [];
    } catch (e) {
        console.warn('No se pudo cargar «Lo de siempre»:', e);
    }
    renderHabituales();
}

const habitualByClave = clave => state.habituales.find(h => h.clave === clave);

function recordHabitual(name) {
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
    else state.habituales.push({ ...row, fijo: false });
    renderHabituales();
    // upsert: si ya existe se actualizan veces/ultima_vez y se respeta "fijo"
    db('compra_habitual', '?on_conflict=clave', {
        method: 'POST',
        headers: { Prefer: 'return=minimal,resolution=merge-duplicates' },
        body: JSON.stringify([row])
    }).catch(e => console.warn('No se pudo guardar en «Lo de siempre»:', e));
}

function sortedHabituales() {
    return [...state.habituales].sort((a, b) =>
        Number(b.fijo) - Number(a.fijo) || b.veces - a.veces ||
        String(b.ultima_vez || '').localeCompare(String(a.ultima_vez || '')));
}

const pendingKeys = () => new Set(state.shoppingList.filter(i => !i.comprado).map(i => shoppingKey(i.nombre)));

function renderHabituales() {
    const box = $('habitualBox');
    box.hidden = state.habituales.length === 0;
    if (box.hidden) return;
    const pending = pendingKeys();
    const chips = $('habitualChips');
    const editing = state.habitualEditMode;
    $('habitualHint').hidden = !editing;
    $('editHabitualBtn').textContent = editing ? '✓ Listo' : '✏️ Editar';

    if (editing) {
        chips.innerHTML = sortedHabituales().map(h =>
            `<span class="chip chip-edit${h.fijo ? ' fijo' : ''}">` +
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
            `<button type="button" class="chip${h.fijo ? ' fijo' : ''}" data-action="habitual-add" data-clave="${escapeHtml(h.clave)}">` +
            `${h.fijo ? '📌 ' : '+ '}${escapeHtml(h.nombre)}</button>`).join('')
        : '<p class="hint">Ya está todo en la lista 👌</p>';
    const fixedMissing = state.habituales.filter(h => h.fijo && !pending.has(h.clave));
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
    const pending = pendingKeys();
    const missing = state.habituales.filter(h => h.fijo && !pending.has(h.clave));
    if (missing.length === 0) return;
    await addShoppingTexts(missing.map(h => h.nombre));
    missing.forEach(h => recordHabitual(h.nombre));
    showToast(`📌 ${plural(missing.length, 'producto fijo añadido', 'productos fijos añadidos')}`);
}

async function toggleHabitualFijo(clave) {
    const h = habitualByClave(clave);
    if (!h) return;
    const fijo = !h.fijo;
    await db('compra_habitual', `?clave=eq.${encodeURIComponent(clave)}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ fijo })
    });
    h.fijo = fijo;
    renderHabituales();
}

async function forgetHabitual(clave) {
    await dbDelete('compra_habitual', `?clave=eq.${encodeURIComponent(clave)}`);
    state.habituales = state.habituales.filter(h => h.clave !== clave);
    renderHabituales();
}

// ---------------------------------------------------------------- arranque

export function setupShopping() {
    $('shoppingAddForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const text = $('shoppingInput').value.trim();
        if (!text) return;
        addFromInput(text)
            .then(() => {
                $('shoppingInput').value = '';
                renderSuggestions();
            })
            .catch(showError);
    });
    $('shoppingInput').addEventListener('input', renderSuggestions);
    on('compra', () => loadShoppingList().catch(showError));
}

registerActions({
    'shop-toggle': (el) => toggleItem(Number(el.dataset.id)),
    'shop-inc': (el) => changeQuantity(Number(el.dataset.id), 1),
    'shop-dec': (el) => changeQuantity(Number(el.dataset.id), -1),
    'shop-remove': (el) => removeItem(Number(el.dataset.id)),
    'shop-clear-checked': () => clearChecked().catch(showError),
    'shop-clear-all': () => {
        if (state.shoppingList.length === 0) return showToast('La lista ya está vacía');
        askConfirm('¿Vaciar toda la lista de la compra?', 'Sí, vaciar', clearAll);
    },
    'add-suggestion': (el) => addProductById(el.dataset.id),
    'habitual-add': (el) => addHabitual(el.dataset.clave),
    'habitual-add-fixed': () => addFixedHabituales().catch(showError),
    'habitual-edit': () => {
        state.habitualEditMode = !state.habitualEditMode;
        renderHabituales();
    },
    'habitual-pin': (el) => toggleHabitualFijo(el.dataset.clave),
    'habitual-forget': (el) => forgetHabitual(el.dataset.clave)
});
