// ⚙️ Más opciones: ajustes, instalar la app, cerrar sesión y gestión de categorías y
// del catálogo de productos (sugerencias de la lista).

import { THERMOMIX_KEY } from './config.js';
import { dbInsert, dbUpdate, dbDelete, signOut } from './api.js';
import { state, emit } from './state.js';
import { $, escapeHtml, normalizeText, storage } from './util.js';
import { registerActions, openModal, closeModal, showToast, askConfirm } from './ui.js';
import { loadCategories, resetRandomPool } from './catalogo.js';
import { loadProducts, loadShoppingList } from './compra.js';

let deferredInstallPrompt = null;

// ---------------------------------------------------------------- ajustes

function openSettings() {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    $('installHint').hidden = Boolean(standalone) || Boolean(deferredInstallPrompt);
    openModal('settingsModal');
}

async function installApp() {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    $('installAppBtn').hidden = true;
}

function logout() {
    askConfirm('¿Cerrar la sesión en este dispositivo?', 'Cerrar sesión', async () => {
        await signOut();
        location.reload();
    }, { danger: false });
}

// ---------------------------------------------------------------- categorías

function renderCategoryManager() {
    const list = $('categoryManagerList');
    list.innerHTML = state.categories.length === 0 ? '<li class="hint">No hay categorías todavía.</li>' : state.categories.map(c =>
        `<li><span>${escapeHtml(c.categoria)}</span>` +
        `<button class="btn btn-danger-ghost btn-small" type="button" data-action="cat-delete" data-id="${c.id}" aria-label="Eliminar ${escapeHtml(c.categoria)}">Eliminar</button></li>`
    ).join('');
}

async function addCategory(name) {
    await dbInsert('categoria_recetas', { categoria: name });
    await loadCategories();
    renderCategoryManager();
}

function askDeleteCategory(id) {
    const cat = state.categories.find(c => c.id === id);
    if (!cat) return;
    askConfirm(`¿Eliminar la categoría «${cat.categoria}»? Sus recetas quedarán sin categoría.`, 'Sí, eliminar', async () => {
        await dbUpdate('recetas', `?categoria=eq.${id}`, { categoria: null });
        await dbDelete('categoria_recetas', `?id=eq.${id}`);
        if (state.currentCategoryFilter === id) state.currentCategoryFilter = 'Todas';
        await loadCategories();
        renderCategoryManager();
        emit('catalogo');
    });
}

// ---------------------------------------------------------------- productos

function renderProductManager() {
    const list = $('productManagerList');
    list.innerHTML = state.products.length === 0 ? '<li class="hint">No hay productos todavía.</li>' : state.products.map(p =>
        `<li><span>${escapeHtml(p.nombre)}</span>` +
        `<button class="btn btn-danger-ghost btn-small" type="button" data-action="product-delete" data-id="${escapeHtml(p.id)}" aria-label="Eliminar ${escapeHtml(p.nombre)}">Eliminar</button></li>`
    ).join('');
}

// productos.id no es autonumérico: siguiente número libre
function nextProductId() {
    const ids = state.products.map(p => Number(p.id)).filter(id => Number.isSafeInteger(id) && id > 0);
    return ids.length > 0 ? Math.max(...ids) + 1 : 1;
}

async function addProduct(name) {
    if (state.products.some(p => normalizeText(p.nombre) === normalizeText(name))) return showToast('Ese producto ya existe');
    await dbInsert('productos', { id: nextProductId(), nombre: name });
    await loadProducts();
    renderProductManager();
}

function askDeleteProduct(id) {
    const product = state.products.find(p => String(p.id) === String(id));
    if (!product) return;
    askConfirm(`¿Eliminar el producto «${product.nombre}»? Se quitará también de la lista de la compra.`, 'Sí, eliminar', async () => {
        await dbDelete('lista_compra', `?id_producto=eq.${product.id}`);
        await dbDelete('productos', `?id=eq.${product.id}`);
        await Promise.all([loadProducts(), loadShoppingList()]);
        renderProductManager();
    });
}

// ---------------------------------------------------------------- arranque

function onSubmit(formId, inputId, fn, errorMsg) {
    $(formId).addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = $(inputId);
        const name = input.value.trim();
        if (!name) return;
        try {
            await fn(name);
            input.value = '';
        } catch (err) {
            showToast(errorMsg + err.message, true);
        }
    });
}

export function setupSettings() {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        $('installAppBtn').hidden = false;
    });

    const thermomix = $('showThermomixToggle');
    thermomix.checked = state.showThermomix;
    thermomix.addEventListener('change', () => {
        state.showThermomix = thermomix.checked;
        storage.setFlag(THERMOMIX_KEY, state.showThermomix);
        resetRandomPool();
        state.currentRecipePage = 0;
        emit('catalogo');
        showToast(state.showThermomix ? '🥣 Se muestran las recetas de Thermomix' : '🥣 Recetas de Thermomix ocultas');
    });

    onSubmit('addCategoryForm', 'newCategoryName', addCategory, 'No se pudo añadir la categoría: ');
    onSubmit('addProductForm', 'newProductName', addProduct, 'No se pudo añadir el producto: ');
}

registerActions({
    'open-settings': openSettings,
    'install-app': installApp,
    'logout': logout,
    'open-categories': () => {
        renderCategoryManager();
        closeModal('settingsModal');
        openModal('categoryManagerModal');
    },
    'open-products': () => {
        renderProductManager();
        closeModal('settingsModal');
        openModal('productManagerModal');
    },
    'cat-delete': (el) => askDeleteCategory(Number(el.dataset.id)),
    'product-delete': (el) => askDeleteProduct(el.dataset.id)
});
