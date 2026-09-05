// App.js - Recetario Digital 100% Supabase
// Tablas usadas (ver diagrama): recetas, categoria_recetas, recetas_favoritas,
// productos, lista_compra, semanas_guardadas

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

let recipes = [];        // {id, title, url, categoria} de la página actual
let favoriteRecipes = [];
let categories = [];     // {id, categoria}
let favorites = [];      // {id, receta_id}
let products = [];       // {id, nombre}
let shoppingList = [];   // {id, id_producto, cantidad, nombre}

let currentCategoryFilter = 'Todas';
let selectedProduct = null;

// Menú semanal en edición (solo cliente, hasta que se guarda)
let currentWeekMenu = {}; // key `${dia}_${tipo}` -> {receta_id, title}
let savedMenusGrouped = {}; // semana -> [ {id, dia, tipo_comida, receta_id, title} ]

let recipeIdPendingDelete = null;
let categoryIdPendingDelete = null;
let semanaPendingDelete = null;
let productIdPendingDelete = null;
let currentlyViewedSemana = null;
const RECIPES_PAGE_SIZE = 100;
let currentRecipePage = 0;
let totalRecipes = 0;
let recipeSearchTimer = null;

function resetPendingDeletes() {
    recipeIdPendingDelete = null;
    categoryIdPendingDelete = null;
    semanaPendingDelete = null;
    productIdPendingDelete = null;
}

// -------------------- ARRANQUE --------------------

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await Promise.all([loadRecipes(), loadCategories(), loadFavorites(), loadProducts()]);
        renderCategoryFilters();
        renderFavoritesFilters();
        renderCategorySelects();
        renderRecipes();
        updateFavoritesCount();
    } catch (e) {
        console.error('Error cargando datos iniciales:', e);
        showShoppingError(e);
    }

    Promise.all([loadShoppingList(), loadCurrentWeekMenuDraft()]).catch(e => {
        console.error('Error cargando datos secundarios:', e);
    });

    setupSearchAndFilters();
    setupFavoritesModal();
    setupShoppingModal();
    setupProductManagerModal();
    setupRecipeModal();
    setupCategoryPickerModal();
    setupRenameRecipeModal();
    setupConfirmModal();
    setupAddRecipeModal();
    setupCategoryManagerModal();
    setupWeeklyMenuModal();
    setupSavedMenusModal();
    setupBackToTop();
    setupGlobalModalClose();
});

// -------------------- SUPABASE HELPER --------------------

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

// -------------------- CARGA DE DATOS --------------------

async function loadRecipes() {
    const search = document.getElementById('searchInput')?.value.trim() || '';
    const params = new URLSearchParams({
        select: 'id,title,url,categoria',
        order: 'title.asc',
        offset: String(currentRecipePage * RECIPES_PAGE_SIZE),
        limit: String(RECIPES_PAGE_SIZE)
    });
    if (currentCategoryFilter !== 'Todas') params.set('categoria', `eq.${currentCategoryFilter}`);
    if (search) params.set('title', `ilike.*${search}*`);

    const response = await fetch(`${SUPABASE_URL}/rest/v1/recetas?${params}`, {
        headers: {
            apikey: SUPABASE_KEY,
            Authorization: 'Bearer ' + SUPABASE_KEY,
            Prefer: 'count=exact'
        }
    });
    if (!response.ok) throw new Error(`Supabase (recetas) respondió con ${response.status}`);
    recipes = await response.json();
    const contentRange = response.headers.get('Content-Range');
    totalRecipes = contentRange ? Number(contentRange.split('/')[1]) : recipes.length;
}

async function loadCategories() {
    categories = await supabaseRequest('categoria_recetas', '?select=id,categoria&order=categoria.asc');
}

async function loadFavorites() {
    try {
        favorites = await supabaseRequest('recetas_favoritas', '?select=id,receta_id');
        const recipeIds = favorites.map(favorite => favorite.receta_id);
        favoriteRecipes = recipeIds.length === 0 ? [] : await supabaseRequest(
            'recetas',
            `?select=id,title,url,categoria&id=in.(${recipeIds.join(',')})&order=title.asc`
        );
    } catch (e) {
        console.error('Error cargando favoritos:', e);
        favorites = [];
        favoriteRecipes = [];
    }
}

async function loadProducts() {
    products = await supabaseRequest('productos', '?select=id,nombre&order=nombre.asc');
}

async function loadShoppingList() {
    const data = await supabaseRequest('lista_compra', '?select=id,id_producto,cantidad,productos(nombre)&order=id.asc');
    shoppingList = (data || []).map(item => ({
        id: item.id,
        id_producto: item.id_producto,
        cantidad: Number.isInteger(item.cantidad) && item.cantidad > 0 ? item.cantidad : 1,
        nombre: item.productos ? item.productos.nombre : 'Producto'
    }));
    renderShoppingList();
    setShoppingStatus('Lista actualizada');
}

// -------------------- CATEGORÍAS (filtros y selects) --------------------

function categoryName(id) {
    const c = categories.find(cat => cat.id === id);
    return c ? c.categoria : 'Sin categoría';
}

function renderCategoryFilters() {
    const el = document.getElementById('categoryFilters');
    el.innerHTML = '<button class="active" data-cat="Todas">Todas</button>' +
        categories.map(c => `<button data-cat="${c.id}">${c.categoria}</button>`).join('');
}

function renderFavoritesFilters() {
    const el = document.getElementById('favoritesFilters');
    el.innerHTML = '<button class="active" data-cat="Todas">Todas</button>' +
        categories.map(c => `<button data-cat="${c.id}">${c.categoria}</button>`).join('');
}

function renderCategorySelects() {
    const options = categories.map(c => `<option value="${c.id}">${c.categoria}</option>`).join('');
    const newRecipeSelect = document.getElementById('newRecipeCategory');
    if (newRecipeSelect) newRecipeSelect.innerHTML = options;
}

function setupSearchAndFilters() {
    document.getElementById('categoryFilters').addEventListener('click', (e) => {
        if (e.target.tagName !== 'BUTTON') return;
        document.querySelectorAll('#categoryFilters button').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        const cat = e.target.dataset.cat;
        currentCategoryFilter = cat === 'Todas' ? 'Todas' : Number(cat);
        currentRecipePage = 0;
        loadRecipes().then(renderRecipes).catch(showRecipeError);
    });

    document.getElementById('searchInput').addEventListener('input', () => {
        clearTimeout(recipeSearchTimer);
        recipeSearchTimer = setTimeout(() => {
            currentRecipePage = 0;
            loadRecipes().then(renderRecipes).catch(showRecipeError);
        }, 250);
    });

    const openAddRecipeBtn = document.getElementById('openAddRecipeBtn');
    if (openAddRecipeBtn) openAddRecipeBtn.onclick = () => {
        document.getElementById('addRecipeModal').style.display = 'flex';
    };
}

// -------------------- RECETAS: LISTADO Y MODAL --------------------

function renderRecipes() {
    const grid = document.getElementById('recipesGrid');
    if (recipes.length === 0) {
        grid.innerHTML = '<div class="empty-state"><p>No hay recetas que coincidan.</p></div>';
        renderRecipePagination();
        return;
    }
    grid.innerHTML = recipes.map(recipeCardHtml).join('');
    renderRecipePagination();
}

function renderRecipePagination() {
    const pagination = document.getElementById('recipePagination');
    if (!pagination) return;
    const pageCount = Math.ceil(totalRecipes / RECIPES_PAGE_SIZE);
    if (pageCount <= 1) {
        pagination.innerHTML = '';
        return;
    }
    pagination.innerHTML = `<button class="btn btn-secondary" ${currentRecipePage === 0 ? 'disabled' : ''} data-page="${currentRecipePage - 1}">Anterior</button>` +
        `<span>Página ${currentRecipePage + 1} de ${pageCount}</span>` +
        `<button class="btn btn-secondary" ${currentRecipePage >= pageCount - 1 ? 'disabled' : ''} data-page="${currentRecipePage + 1}">Siguiente</button>`;
    pagination.querySelectorAll('button').forEach(button => {
        button.onclick = async () => {
            currentRecipePage = Number(button.dataset.page);
            pagination.setAttribute('aria-busy', 'true');
            try {
                await loadRecipes();
                renderRecipes();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            } catch (e) {
                showRecipeError(e);
            } finally {
                pagination.removeAttribute('aria-busy');
            }
        };
    });
}

function showRecipeError(error) {
    console.error('Error cargando recetas:', error);
    document.getElementById('recipesGrid').innerHTML = '<div class="empty-state"><p>No se pudieron cargar las recetas.</p></div>';
}

function recipeCardHtml(r) {
    return '<div class="card"><div><button class="badge badge-btn" title="Cambiar categoría" onclick="openCategoryPicker(' + r.id + ')">' +
        categoryName(r.categoria) + ' ✎</button><h3>' + r.title +
        ' <button class="edit-title-btn" title="Editar nombre" onclick="openRenameRecipe(' + r.id + ')">✏️</button></h3></div><div class="card-actions">' +
        '<button class="favorite-btn ' + (isFavorite(r.id) ? 'active' : '') + '" title="' +
        (isFavorite(r.id) ? 'Quitar de favoritos' : 'Agregar a favoritos') +
        '" onclick="toggleFavorite(' + r.id + ')">' + (isFavorite(r.id) ? '⭐' : '☆') + '</button>' +
        '<button class="btn btn-primary" onclick="openModal(' + r.id + ')">📖 Ver Receta</button>' +
        '<button class="delete-recipe-btn" title="Eliminar receta" onclick="askDeleteRecipe(' + r.id + ')">🗑️</button></div></div>';
}

// -------------------- RENOMBRAR RECETA (desde la tarjeta) --------------------

function openRenameRecipe(recipeId) {
    const recipe = recipes.find(r => r.id === recipeId);
    if (!recipe) return;
    const modal = document.getElementById('renameRecipeModal');
    modal.dataset.recipeId = String(recipeId);
    document.getElementById('renameRecipeInput').value = recipe.title;
    modal.style.display = 'flex';
    document.getElementById('renameRecipeInput').focus();
}

function setupRenameRecipeModal() {
    document.getElementById('closeRenameRecipeModal').onclick = () => {
        document.getElementById('renameRecipeModal').style.display = 'none';
    };
    document.getElementById('saveRenameRecipeBtn').onclick = async () => {
        const modal = document.getElementById('renameRecipeModal');
        const id = Number(modal.dataset.recipeId);
        const newTitle = document.getElementById('renameRecipeInput').value.trim();
        if (!newTitle) return;
        try {
            await supabaseRequest('recetas', `?id=eq.${id}`, {
                method: 'PATCH',
                body: JSON.stringify({ title: newTitle })
            });
            await loadRecipes();
            renderRecipes();
            renderFavoritesGrid();
            modal.style.display = 'none';
        } catch (e) {
            alert('No se pudo actualizar el nombre: ' + e.message);
        }
    };
    document.getElementById('renameRecipeInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('saveRenameRecipeBtn').click();
    });
}

// -------------------- SELECTOR DE CATEGORÍA (desde la tarjeta) --------------------

function openCategoryPicker(recipeId) {
    const recipe = recipes.find(r => r.id === recipeId);
    if (!recipe) return;
    const modal = document.getElementById('categoryPickerModal');
    modal.dataset.recipeId = String(recipeId);
    document.getElementById('categoryPickerRecipeTitle').innerText = recipe.title;

    const list = document.getElementById('categoryPickerList');
    const noneBtn = `<button class="category-picker-option ${recipe.categoria == null ? 'active' : ''}" data-cat="">Sin categoría</button>`;
    const catButtons = categories.map(c =>
        `<button class="category-picker-option ${recipe.categoria === c.id ? 'active' : ''}" data-cat="${c.id}">${c.categoria}</button>`
    ).join('');
    list.innerHTML = noneBtn + catButtons;
    list.querySelectorAll('.category-picker-option').forEach(btn => {
        btn.onclick = () => assignCategoryToRecipe(recipeId, btn.dataset.cat ? Number(btn.dataset.cat) : null);
    });

    modal.style.display = 'flex';
}

async function assignCategoryToRecipe(recipeId, categoryId) {
    try {
        await supabaseRequest('recetas', `?id=eq.${recipeId}`, {
            method: 'PATCH',
            body: JSON.stringify({ categoria: categoryId })
        });
        await loadRecipes();
        renderRecipes();
        renderFavoritesGrid();
        document.getElementById('categoryPickerModal').style.display = 'none';
    } catch (e) {
        alert('No se pudo actualizar la categoría: ' + e.message);
    }
}

function setupCategoryPickerModal() {
    document.getElementById('closeCategoryPickerModal').onclick = () => {
        document.getElementById('categoryPickerModal').style.display = 'none';
    };
}

function setupRecipeModal() {
    document.getElementById('closeModal').onclick = () => {
        document.getElementById('recipeModal').style.display = 'none';
    };

    const daySelect = document.getElementById('modalWeeklyDay');
    daySelect.innerHTML = DIAS.map(d => `<option value="${d.id}">${d.nombre}</option>`).join('');

    document.getElementById('modalAddToWeeklyBtn').onclick = () => {
        const id = Number(document.getElementById('recipeModal').dataset.recipeId);
        const recipe = recipes.find(r => r.id === id);
        if (!recipe) return;
        const dia = Number(daySelect.value);
        const tipo = document.getElementById('modalWeeklyMealType').value;
        addToCurrentWeekMenu(dia, tipo, recipe).catch(e => alert('No se pudo añadir a la semana: ' + e.message));
    };
}

async function openModal(id) {
    const r = recipes.find(item => item.id === id);
    if (!r) return;
    let detail;
    try {
        detail = await supabaseRequest('recetas', `?id=eq.${id}&select=id,title,url,ingredients,steps,categoria`);
    } catch (e) {
        alert('No se pudo cargar la receta: ' + e.message);
        return;
    }
    const recipe = detail && detail[0];
    if (!recipe) return;
    const modal = document.getElementById('recipeModal');
    modal.dataset.recipeId = String(id);
    document.getElementById('modalTitle').innerText = recipe.title;
    document.getElementById('modalCategory').innerText = categoryName(recipe.categoria);

    const ingredientsList = (recipe.ingredients || '')
        .split('\n')
        .map(i => i.trim())
        .filter(Boolean);
    document.getElementById('modalIngredients').innerHTML = ingredientsList.map(ing => '<li>' + ing + '</li>').join('');

    document.getElementById('modalSteps').innerHTML = (recipe.steps || 'Sin pasos especificados.').replace(/\n/g, '<br>');

    const urlWrapper = document.getElementById('modalUrlWrapper');
    urlWrapper.innerHTML = recipe.url ? '<a href="' + recipe.url + '" target="_blank" rel="noopener">🌐 Ver receta original</a>' : '';

    modal.style.display = 'flex';
}

// -------------------- AÑADIR RECETA --------------------

function setupAddRecipeModal() {
    document.getElementById('closeAddRecipeModal').onclick = () => {
        document.getElementById('addRecipeModal').style.display = 'none';
    };
    document.getElementById('addRecipeForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = document.getElementById('newRecipeTitle').value.trim();
        const url = document.getElementById('newRecipeUrl').value.trim();
        const ingredients = document.getElementById('newRecipeIngredients').value.trim();
        const steps = document.getElementById('newRecipeSteps').value.trim();
        const categorySelect = document.getElementById('newRecipeCategory');
        const categoria = categorySelect.value ? Number(categorySelect.value) : null;
        if (!title || !ingredients || !steps) return;

        try {
            await supabaseRequest('recetas', '', {
                method: 'POST',
                body: JSON.stringify([{ title, url: url || null, ingredients, steps, categoria }])
            });
            await loadRecipes();
            renderRecipes();
            e.target.reset();
            document.getElementById('addRecipeModal').style.display = 'none';
        } catch (err) {
            alert('No se pudo guardar la receta: ' + err.message);
        }
    });
}

// -------------------- ELIMINAR RECETA (con confirmación) --------------------

function askDeleteRecipe(id) {
    resetPendingDeletes();
    recipeIdPendingDelete = id;
    const recipe = recipes.find(r => r.id === id);
    document.getElementById('confirmMessage').innerText =
        `¿Seguro que quieres eliminar la receta "${recipe ? recipe.title : ''}" de tu base de datos? Esta acción no se puede deshacer.`;
    document.getElementById('confirmModal').style.display = 'flex';
}

function setupConfirmModal() {
    document.getElementById('confirmNoBtn').onclick = closeConfirmModal;
    document.getElementById('confirmYesBtn').onclick = async () => {
        try {
            if (recipeIdPendingDelete != null) {
                const id = recipeIdPendingDelete;
                await supabaseRequest('recetas_favoritas', `?receta_id=eq.${id}`, { method: 'DELETE' });
                await supabaseRequest('semanas_guardadas', `?receta_id=eq.${id}`, { method: 'DELETE' });
                await supabaseRequest('recetas', `?id=eq.${id}`, { method: 'DELETE' });
                await Promise.all([loadRecipes(), loadFavorites()]);
                renderRecipes();
                updateFavoritesCount();
                document.getElementById('recipeModal').style.display = 'none';
            } else if (categoryIdPendingDelete != null) {
                const id = categoryIdPendingDelete;
                await supabaseRequest('recetas', `?categoria=eq.${id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ categoria: null })
                });
                await supabaseRequest('categoria_recetas', `?id=eq.${id}`, { method: 'DELETE' });
                await Promise.all([loadCategories(), loadRecipes()]);
                renderCategoryFilters();
                renderFavoritesFilters();
                renderCategorySelects();
                renderRecipes();
                renderCategoryManagerList();
            } else if (semanaPendingDelete != null) {
                const semana = semanaPendingDelete;
                await supabaseRequest('semanas_guardadas', `?semana=eq.${semana}`, { method: 'DELETE' });
                await loadSavedMenus();
                currentlyViewedSemana = null;
                renderSavedMenusList();
                document.getElementById('savedMenuDetail').innerHTML = '';
                document.getElementById('savedMenuDetailTitle').innerHTML = '';
            } else if (productIdPendingDelete != null) {
                const id = productIdPendingDelete;
                await supabaseRequest('lista_compra', `?id_producto=eq.${id}`, { method: 'DELETE' });
                await supabaseRequest('productos', `?id=eq.${id}`, { method: 'DELETE' });
                await Promise.all([loadProducts(), loadShoppingList()]);
                renderProductResults();
                renderProductManagerList();
            }
        } catch (e) {
            alert('No se pudo completar la eliminación: ' + e.message);
        } finally {
            closeConfirmModal();
        }
    };
}

function closeConfirmModal() {
    resetPendingDeletes();
    document.getElementById('confirmModal').style.display = 'none';
}

// -------------------- GESTIÓN DE CATEGORÍAS --------------------

function setupCategoryManagerModal() {
    document.getElementById('openCategoryManagerBtn').onclick = () => {
        renderCategoryManagerList();
        document.getElementById('categoryManagerModal').style.display = 'flex';
    };
    document.getElementById('closeCategoryManagerModal').onclick = () => {
        document.getElementById('categoryManagerModal').style.display = 'none';
    };
    document.getElementById('addCategoryBtn').onclick = async () => {
        const input = document.getElementById('newCategoryName');
        const name = input.value.trim();
        if (!name) return;
        try {
            await supabaseRequest('categoria_recetas', '', {
                method: 'POST',
                body: JSON.stringify([{ categoria: name }])
            });
            input.value = '';
            await loadCategories();
            renderCategoryFilters();
            renderFavoritesFilters();
            renderCategorySelects();
            renderCategoryManagerList();
        } catch (e) {
            alert('No se pudo añadir la categoría: ' + e.message);
        }
    };
}

function renderCategoryManagerList() {
    const list = document.getElementById('categoryManagerList');
    if (categories.length === 0) {
        list.innerHTML = '<li>No hay categorías todavía.</li>';
        return;
    }
    list.innerHTML = categories.map(c =>
        `<li><span>${c.categoria}</span><button class="btn-clear" onclick="askDeleteCategory(${c.id})">Eliminar</button></li>`
    ).join('');
}

function askDeleteCategory(id) {
    resetPendingDeletes();
    categoryIdPendingDelete = id;
    const cat = categories.find(c => c.id === id);
    document.getElementById('confirmMessage').innerText =
        `¿Eliminar la categoría "${cat ? cat.categoria : ''}"? Las recetas asignadas quedarán sin categoría.`;
    document.getElementById('confirmModal').style.display = 'flex';
}

// -------------------- MENÚ SEMANAL --------------------
// El borrador del menú en curso se guarda en la tabla "menu_semanal_actual"
// (id, dia, tipo_comida, receta_id) para que sobreviva a cerrar la app.

async function loadCurrentWeekMenuDraft() {
    try {
        const data = await supabaseRequest(
            'menu_semanal_actual',
            '?select=id,dia,tipo_comida,receta_id,recetas(title)'
        );
        currentWeekMenu = {};
        (data || []).forEach(row => {
            currentWeekMenu[`${row.dia}_${row.tipo_comida}`] = {
                receta_id: row.receta_id,
                title: row.recetas ? row.recetas.title : 'Receta eliminada',
                draftId: row.id
            };
        });
    } catch (e) {
        console.error('Error cargando el borrador del menú semanal:', e);
        currentWeekMenu = {};
    }
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
        const row = inserted[0];
        currentWeekMenu[key] = { receta_id: recipe.id, title: recipe.title, draftId: row.id };
    }
    renderWeeklyGrid();
    alert(`"${recipe.title}" añadida a ${DIAS.find(d => d.id === dia).nombre} - ${tipo}`);
}

function setupWeeklyMenuModal() {
    document.getElementById('openWeeklyMenuBtn').onclick = () => {
        renderWeeklyGrid();
        document.getElementById('weeklyMenuModal').style.display = 'flex';
    };
    document.getElementById('closeWeeklyMenuModal').onclick = () => {
        document.getElementById('weeklyMenuModal').style.display = 'none';
    };
    document.getElementById('clearWeeklyMenuBtn').onclick = async () => {
        try {
            await supabaseRequest('menu_semanal_actual', '?id=not.is.null', { method: 'DELETE' });
            currentWeekMenu = {};
            renderWeeklyGrid();
        } catch (e) {
            alert('No se pudo vaciar el menú semanal: ' + e.message);
        }
    };
    document.getElementById('saveWeeklyMenuBtn').onclick = saveWeeklyMenu;
}

function generateWeeklyGridHtml(menuData, readOnly) {
    // Vista de escritorio: tabla Comida/Cena x Días
    let tableHtml = '<table class="weekly-grid-table"><thead><tr><th>Comida</th>' +
        DIAS.map(d => `<th>${d.nombre}</th>`).join('') + '</tr></thead><tbody>';
    TIPOS_COMIDA.forEach(tipo => {
        tableHtml += `<tr><td class="weekly-row-label">${tipo}</td>`;
        DIAS.forEach(d => {
            const key = `${d.id}_${tipo}`;
            const entry = menuData[key];
            if (entry) {
                tableHtml += `<td class="weekly-cell filled">${entry.title}` +
                    (readOnly ? '' : ` <button class="remove-item-btn" onclick="removeFromWeeklyMenu('${key}')">×</button>`) +
                    '</td>';
            } else {
                tableHtml += '<td class="weekly-cell empty">—</td>';
            }
        });
        tableHtml += '</tr>';
    });
    tableHtml += '</tbody></table>';

    // Vista de móvil: una tarjeta vertical por día
    let mobileHtml = '<div class="weekly-grid-mobile">';
    DIAS.forEach(d => {
        mobileHtml += `<div class="weekly-day-card"><h4>${d.nombre}</h4>`;
        TIPOS_COMIDA.forEach(tipo => {
            const key = `${d.id}_${tipo}`;
            const entry = menuData[key];
            mobileHtml += `<div class="weekly-day-row"><span class="weekly-day-meal-label">${tipo}</span><span class="weekly-day-meal-value">`;
            if (entry) {
                mobileHtml += entry.title +
                    (readOnly ? '' : ` <button class="remove-item-btn" onclick="removeFromWeeklyMenu('${key}')">×</button>`);
            } else {
                mobileHtml += '—';
            }
            mobileHtml += '</span></div>';
        });
        mobileHtml += '</div>';
    });
    mobileHtml += '</div>';

    return tableHtml + mobileHtml;
}

function renderWeeklyGrid(containerId = 'weeklyGrid', menuData = null, readOnly = false) {
    const container = document.getElementById(containerId);
    const data = menuData || currentWeekMenu;
    container.innerHTML = generateWeeklyGridHtml(data, readOnly);
}

async function removeFromWeeklyMenu(key) {
    const entry = currentWeekMenu[key];
    if (!entry) return;
    try {
        if (entry.draftId) {
            await supabaseRequest('menu_semanal_actual', `?id=eq.${entry.draftId}`, { method: 'DELETE' });
        }
        delete currentWeekMenu[key];
        renderWeeklyGrid();
    } catch (e) {
        alert('No se pudo quitar de la semana: ' + e.message);
    }
}

async function saveWeeklyMenu() {
    const entries = Object.entries(currentWeekMenu);
    if (entries.length === 0) {
        alert('Añade al menos una receta a tu menú semanal antes de guardarlo.');
        return;
    }
    try {
        const existing = await supabaseRequest('semanas_guardadas', '?select=semana&order=semana.desc&limit=1');
        const nextSemana = existing && existing.length > 0 ? existing[0].semana + 1 : 1;
        const rows = entries.map(([key, val]) => {
            const [dia, tipo] = key.split('_');
            return { semana: nextSemana, dia: Number(dia), tipo_comida: tipo, receta_id: val.receta_id };
        });
        await supabaseRequest('semanas_guardadas', '', { method: 'POST', body: JSON.stringify(rows) });
        await supabaseRequest('menu_semanal_actual', '?id=not.is.null', { method: 'DELETE' });
        currentWeekMenu = {};
        renderWeeklyGrid();
        alert('Menú semanal guardado correctamente.');
    } catch (e) {
        alert('No se pudo guardar el menú semanal: ' + e.message);
    }
}

// -------------------- MENÚS GUARDADOS --------------------

function setupSavedMenusModal() {
    document.getElementById('openSavedMenusBtn').onclick = async () => {
        try {
            await loadSavedMenus();
            currentlyViewedSemana = null;
            renderSavedMenusList();
            document.getElementById('savedMenuDetail').innerHTML = '';
            document.getElementById('savedMenuDetailTitle').innerHTML = '';
            document.getElementById('savedMenusModal').style.display = 'flex';
        } catch (e) {
            alert('No se pudieron cargar los menús guardados: ' + e.message);
        }
    };
    document.getElementById('closeSavedMenusModal').onclick = () => {
        document.getElementById('savedMenusModal').style.display = 'none';
    };
}

async function loadSavedMenus() {
    const data = await supabaseRequest(
        'semanas_guardadas',
        '?select=id,semana,dia,tipo_comida,receta_id,recetas(title)&order=semana.desc,dia.asc'
    );
    savedMenusGrouped = {};
    (data || []).forEach(row => {
        if (!savedMenusGrouped[row.semana]) savedMenusGrouped[row.semana] = [];
        savedMenusGrouped[row.semana].push({
            id: row.id,
            dia: row.dia,
            tipo_comida: row.tipo_comida,
            receta_id: row.receta_id,
            title: row.recetas ? row.recetas.title : 'Receta eliminada'
        });
    });
}

function renderSavedMenusList() {
    const list = document.getElementById('savedMenusList');
    const semanas = Object.keys(savedMenusGrouped).sort((a, b) => b - a);
    if (semanas.length === 0) {
        list.innerHTML = '<div class="empty-state"><p>Todavía no has guardado ningún menú semanal.</p></div>';
        return;
    }
    list.innerHTML = semanas.map(semana => {
        const isOpen = String(currentlyViewedSemana) === String(semana);
        return `<div class="saved-menu-item">
            <span>Semana ${semana}</span>
            <div>
                <button class="btn btn-secondary" onclick="toggleSavedMenu(${semana})">${isOpen ? 'Ocultar' : 'Ver'}</button>
                <button class="btn-clear" onclick="askDeleteSavedMenu(${semana})">Eliminar</button>
            </div>
        </div>`;
    }).join('');
}

function toggleSavedMenu(semana) {
    if (String(currentlyViewedSemana) === String(semana)) {
        currentlyViewedSemana = null;
        document.getElementById('savedMenuDetail').innerHTML = '';
        document.getElementById('savedMenuDetailTitle').innerHTML = '';
    } else {
        currentlyViewedSemana = semana;
        viewSavedMenu(semana);
    }
    renderSavedMenusList();
}

function viewSavedMenu(semana) {
    const entries = savedMenusGrouped[semana] || [];
    const menuData = {};
    entries.forEach(e => {
        menuData[`${e.dia}_${e.tipo_comida}`] = { receta_id: e.receta_id, title: e.title };
    });
    document.getElementById('savedMenuDetailTitle').innerHTML = `<h3>Semana ${semana}</h3>`;
    renderWeeklyGrid('savedMenuDetail', menuData, true);
}

function askDeleteSavedMenu(semana) {
    resetPendingDeletes();
    semanaPendingDelete = semana;
    document.getElementById('confirmMessage').innerText = `¿Eliminar la Semana ${semana}? No se podrá recuperar.`;
    document.getElementById('confirmModal').style.display = 'flex';
}

// -------------------- FAVORITOS --------------------

function isFavorite(recipeId) {
    return favorites.some(f => f.receta_id === recipeId);
}

async function toggleFavorite(recipeId) {
    try {
        const existing = favorites.find(f => f.receta_id === recipeId);
        if (existing) {
            await supabaseRequest('recetas_favoritas', `?id=eq.${existing.id}`, { method: 'DELETE' });
        } else {
            await supabaseRequest('recetas_favoritas', '', {
                method: 'POST',
                body: JSON.stringify([{ receta_id: recipeId }])
            });
        }
        await loadFavorites();
        updateFavoritesCount();
        renderRecipes();
        renderFavoritesGrid();
    } catch (e) {
        console.error('Error actualizando favorito:', e);
    }
}

function updateFavoritesCount() {
    const favCount = document.getElementById('favoritesCount');
    if (favCount) favCount.textContent = favorites.length;
}

function setupFavoritesModal() {
    document.getElementById('openFavoritesBtn').onclick = () => {
        document.getElementById('favoritesModal').style.display = 'flex';
        document.getElementById('favoritesSearchInput').value = '';
        document.querySelectorAll('#favoritesFilters button').forEach((b, i) => {
            b.classList.toggle('active', i === 0);
        });
        renderFavoritesGrid();
    };
    document.getElementById('closeFavoritesModal').onclick = () => {
        document.getElementById('favoritesModal').style.display = 'none';
    };
    document.getElementById('favoritesSearchInput').addEventListener('input', renderFavoritesGrid);
    document.getElementById('favoritesFilters').addEventListener('click', (e) => {
        if (e.target.tagName !== 'BUTTON') return;
        document.querySelectorAll('#favoritesFilters button').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        renderFavoritesGrid();
    });
}

function renderFavoritesGrid() {
    const grid = document.getElementById('favoritesGrid');
    const query = document.getElementById('favoritesSearchInput').value.toLowerCase();
    const activeBtn = document.querySelector('#favoritesFilters .active');
    const currentFavCategory = activeBtn ? activeBtn.dataset.cat : 'Todas';

    const filtered = favoriteRecipes.filter(r => {
        const categoryMatch = currentFavCategory === 'Todas' || r.categoria === Number(currentFavCategory);
        const matchQuery = (r.title || '').toLowerCase().includes(query);
        return categoryMatch && matchQuery;
    });

    if (favorites.length === 0) {
        grid.innerHTML = '<div class="empty-state"><p>📭 Aún no tienes favoritas</p><p>Marca recetas con ⭐ en el apartado principal</p></div>';
        return;
    }
    if (filtered.length === 0) {
        grid.innerHTML = '<div class="empty-state"><p>No hay favoritas en esta categoría</p></div>';
        return;
    }
    grid.innerHTML = filtered.map(recipeCardHtml).join('');
}

// -------------------- LISTA DE LA COMPRA --------------------

function setupShoppingModal() {
    document.getElementById('openShoppingBtn').onclick = () => {
        document.getElementById('shoppingModal').style.display = 'flex';
        document.getElementById('shoppingSearchInput').focus();
        renderProductResults();
    };
    document.getElementById('closeShoppingModal').onclick = closeShoppingModal;
    document.getElementById('shoppingSearchInput').addEventListener('input', renderProductResults);
    document.getElementById('addShoppingItemBtn').onclick = () => addSelectedProduct().catch(showShoppingError);
    document.getElementById('shoppingQuantity').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addSelectedProduct().catch(showShoppingError);
    });
    document.getElementById('clearListBtn').onclick = () => clearShoppingList().catch(showShoppingError);
}

function closeShoppingModal() {
    document.getElementById('shoppingModal').style.display = 'none';
    clearProductSelection();
}

function renderProductResults() {
    const query = normalizeText(document.getElementById('shoppingSearchInput').value);
    const results = products.filter(p => normalizeText(p.nombre).includes(query)).slice(0, 12);
    const resultsEl = document.getElementById('shoppingSearchResults');
    resultsEl.innerHTML = results.map(p => `<button class="product-result" type="button" data-product-id="${p.id}">${p.nombre}</button>`).join('');
    resultsEl.querySelectorAll('.product-result').forEach(button => {
        button.onclick = () => selectProduct(button.dataset.productId);
    });
}

function selectProduct(id) {
    selectedProduct = products.find(p => String(p.id) === String(id));
    if (!selectedProduct) return;
    document.getElementById('selectedProductName').textContent = selectedProduct.nombre;
    document.getElementById('quantityContainer').hidden = false;
    document.getElementById('shoppingQuantity').focus();
    document.getElementById('shoppingQuantity').select();
}

function clearProductSelection() {
    selectedProduct = null;
    document.getElementById('quantityContainer').hidden = true;
    document.getElementById('shoppingQuantity').value = 1;
}

async function addSelectedProduct() {
    const quantity = Number(document.getElementById('shoppingQuantity').value);
    if (!selectedProduct || !Number.isInteger(quantity) || quantity < 1) return;
    const existingItem = shoppingList.find(item => item.id_producto === selectedProduct.id);
    if (existingItem) {
        await supabaseRequest('lista_compra', `?id=eq.${existingItem.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ cantidad: existingItem.cantidad + quantity })
        });
    } else {
        await supabaseRequest('lista_compra', '', {
            method: 'POST',
            body: JSON.stringify([{ id_producto: selectedProduct.id, cantidad: quantity }])
        });
    }
    await loadShoppingList();
    clearProductSelection();
}

function removeItem(index) {
    const item = shoppingList[index];
    if (!item) return;
    supabaseRequest('lista_compra', `?id=eq.${item.id}`, { method: 'DELETE' })
        .then(loadShoppingList)
        .catch(showShoppingError);
}

async function clearShoppingList() {
    await supabaseRequest('lista_compra', '?id=not.is.null', { method: 'DELETE' });
    await loadShoppingList();
}

function renderShoppingList() {
    const listEl = document.getElementById('shoppingList');
    document.getElementById('cartCount').textContent = shoppingList.length;
    listEl.innerHTML = shoppingList.map((item, index) =>
        '<li><span>' + item.nombre + '</span><span class="shopping-item-quantity">' + item.cantidad +
        '</span><button class="remove-item-btn" onclick="removeItem(' + index + ')">Quitar</button></li>'
    ).join('');
}

function showShoppingError(error) {
    console.error('Error en la lista de compra:', error);
    setShoppingStatus('Error: ' + error.message, true);
}

function setShoppingStatus(message, isError = false) {
    const statusEl = document.getElementById('shoppingStatus');
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.classList.toggle('shopping-status-error', isError);
}

function normalizeText(text) {
    return String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// -------------------- GESTIÓN DE PRODUCTOS (añadir/eliminar del catálogo) --------------------

function setupProductManagerModal() {
    document.getElementById('openProductManagerBtn').onclick = () => {
        renderProductManagerList();
        document.getElementById('productManagerModal').style.display = 'flex';
    };
    document.getElementById('closeProductManagerModal').onclick = () => {
        document.getElementById('productManagerModal').style.display = 'none';
    };
    document.getElementById('addProductBtn').onclick = async () => {
        const input = document.getElementById('newProductName');
        const name = input.value.trim();
        if (!name) return;
        const id = createProductId();
        try {
            await supabaseRequest('productos', '', {
                method: 'POST',
                body: JSON.stringify([{ id, nombre: name }])
            });
            input.value = '';
            await loadProducts();
            renderProductResults();
            renderProductManagerList();
        } catch (e) {
            alert('No se pudo añadir el producto: ' + e.message);
        }
    };
    document.getElementById('newProductName').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('addProductBtn').click();
    });
}

function createProductId() {
    const numericIds = products
        .map(product => Number(product.id))
        .filter(id => Number.isSafeInteger(id) && id > 0);
    return numericIds.length > 0 ? Math.max(...numericIds) + 1 : 1;
}

function renderProductManagerList() {
    const list = document.getElementById('productManagerList');
    if (products.length === 0) {
        list.innerHTML = '<li>No hay productos todavía.</li>';
        return;
    }
    list.innerHTML = products.map(p =>
        `<li><span>${p.nombre}</span><button class="btn-clear" onclick="askDeleteProduct(${JSON.stringify(p.id)})">Eliminar</button></li>`
    ).join('');
}

function askDeleteProduct(id) {
    resetPendingDeletes();
    productIdPendingDelete = id;
    const product = products.find(p => p.id === id);
    document.getElementById('confirmMessage').innerText =
        `¿Eliminar el producto "${product ? product.nombre : ''}"? Se quitará también de tu lista de la compra si está en ella.`;
    document.getElementById('confirmModal').style.display = 'flex';
}

// -------------------- UTILIDADES DE INTERFAZ --------------------

function setupBackToTop() {
    const backToTopBtn = document.getElementById('backToTopBtn');
    window.addEventListener('scroll', () => {
        backToTopBtn.hidden = window.scrollY < 500;
    }, { passive: true });
    backToTopBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

function setupGlobalModalClose() {
    window.onclick = (e) => {
        const modals = ['recipeModal', 'shoppingModal', 'favoritesModal', 'addRecipeModal',
            'categoryManagerModal', 'weeklyMenuModal', 'savedMenusModal', 'confirmModal',
            'categoryPickerModal', 'renameRecipeModal', 'productManagerModal'];
        modals.forEach(id => {
            const modal = document.getElementById(id);
            if (modal && e.target === modal) {
                if (id === 'shoppingModal') closeShoppingModal();
                else modal.style.display = 'none';
            }
        });
    };
}