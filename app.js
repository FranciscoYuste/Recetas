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

let recipes = [];        // {id, title, url, ingredients, steps, categoria}
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
let currentlyViewedSemana = null;

// -------------------- ARRANQUE --------------------

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await Promise.all([loadRecipes(), loadCategories(), loadFavorites(), loadProducts()]);
        await loadShoppingList();
        renderCategoryFilters();
        renderFavoritesFilters();
        renderCategorySelects();
        renderRecipes();
        updateFavoritesCount();
    } catch (e) {
        console.error('Error cargando datos iniciales:', e);
        showShoppingError(e);
    }

    setupSearchAndFilters();
    setupFavoritesModal();
    setupShoppingModal();
    setupRecipeModal();
    setupCategoryPickerModal();
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
    recipes = await supabaseRequest('recetas', '?select=id,title,url,ingredients,steps,categoria&order=title.asc');
}

async function loadCategories() {
    categories = await supabaseRequest('categoria_recetas', '?select=id,categoria&order=categoria.asc');
}

async function loadFavorites() {
    try {
        favorites = await supabaseRequest('recetas_favoritas', '?select=id,receta_id');
    } catch (e) {
        console.error('Error cargando favoritos:', e);
        favorites = [];
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
        renderRecipes();
    });

    document.getElementById('searchInput').addEventListener('input', renderRecipes);

    const openAddRecipeBtn = document.getElementById('openAddRecipeBtn');
    if (openAddRecipeBtn) openAddRecipeBtn.onclick = () => {
        document.getElementById('addRecipeModal').style.display = 'flex';
    };
}

// -------------------- RECETAS: LISTADO Y MODAL --------------------

function renderRecipes() {
    const grid = document.getElementById('recipesGrid');
    const query = document.getElementById('searchInput').value.toLowerCase();
    const filtered = recipes.filter(r => {
        const categoryMatch = currentCategoryFilter === 'Todas' || r.categoria === currentCategoryFilter;
        const matchQuery = (r.title || '').toLowerCase().includes(query);
        return categoryMatch && matchQuery;
    });
    if (filtered.length === 0) {
        grid.innerHTML = '<div class="empty-state"><p>No hay recetas que coincidan.</p></div>';
        return;
    }
    grid.innerHTML = filtered.map(recipeCardHtml).join('');
}

function recipeCardHtml(r) {
    return '<div class="card"><div><button class="badge badge-btn" title="Cambiar categoría" onclick="openCategoryPicker(' + r.id + ')">' +
        categoryName(r.categoria) + ' ✎</button><h3>' + r.title + '</h3></div><div class="card-actions">' +
        '<button class="favorite-btn ' + (isFavorite(r.id) ? 'active' : '') + '" title="' +
        (isFavorite(r.id) ? 'Quitar de favoritos' : 'Agregar a favoritos') +
        '" onclick="toggleFavorite(' + r.id + ')">' + (isFavorite(r.id) ? '⭐' : '☆') + '</button>' +
        '<button class="btn btn-primary" onclick="openModal(' + r.id + ')">📖 Ver Receta</button>' +
        '<button class="delete-recipe-btn" title="Eliminar receta" onclick="askDeleteRecipe(' + r.id + ')">🗑️</button></div></div>';
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
        currentWeekMenu[`${dia}_${tipo}`] = { receta_id: recipe.id, title: recipe.title };
        renderWeeklyGrid();
        alert(`"${recipe.title}" añadida a ${DIAS.find(d => d.id === dia).nombre} - ${tipo}`);
    };
}

function openModal(id) {
    const r = recipes.find(item => item.id === id);
    if (!r) return;
    const modal = document.getElementById('recipeModal');
    modal.dataset.recipeId = String(id);
    document.getElementById('modalTitle').innerText = r.title;
    document.getElementById('modalCategory').innerText = categoryName(r.categoria);

    const ingredientsList = (r.ingredients || '')
        .split('\n')
        .map(i => i.trim())
        .filter(Boolean);
    document.getElementById('modalIngredients').innerHTML = ingredientsList.map(ing => '<li>' + ing + '</li>').join('');

    document.getElementById('modalSteps').innerHTML = (r.steps || 'Sin pasos especificados.').replace(/\n/g, '<br>');

    const urlWrapper = document.getElementById('modalUrlWrapper');
    urlWrapper.innerHTML = r.url ? '<a href="' + r.url + '" target="_blank" rel="noopener">🌐 Ver receta original</a>' : '';

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
    recipeIdPendingDelete = id;
    categoryIdPendingDelete = null;
    semanaPendingDelete = null;
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
            }
        } catch (e) {
            alert('No se pudo completar la eliminación: ' + e.message);
        } finally {
            closeConfirmModal();
        }
    };
}

function closeConfirmModal() {
    recipeIdPendingDelete = null;
    categoryIdPendingDelete = null;
    semanaPendingDelete = null;
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
    recipeIdPendingDelete = null;
    semanaPendingDelete = null;
    categoryIdPendingDelete = id;
    const cat = categories.find(c => c.id === id);
    document.getElementById('confirmMessage').innerText =
        `¿Eliminar la categoría "${cat ? cat.categoria : ''}"? Las recetas asignadas quedarán sin categoría.`;
    document.getElementById('confirmModal').style.display = 'flex';
}

// -------------------- MENÚ SEMANAL --------------------

function setupWeeklyMenuModal() {
    document.getElementById('openWeeklyMenuBtn').onclick = () => {
        renderWeeklyGrid();
        document.getElementById('weeklyMenuModal').style.display = 'flex';
    };
    document.getElementById('closeWeeklyMenuModal').onclick = () => {
        document.getElementById('weeklyMenuModal').style.display = 'none';
    };
    document.getElementById('clearWeeklyMenuBtn').onclick = () => {
        currentWeekMenu = {};
        renderWeeklyGrid();
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

function removeFromWeeklyMenu(key) {
    delete currentWeekMenu[key];
    renderWeeklyGrid();
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
    recipeIdPendingDelete = null;
    categoryIdPendingDelete = null;
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

    const favoriteRecipes = recipes.filter(r => favorites.some(f => f.receta_id === r.id));
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
            'categoryManagerModal', 'weeklyMenuModal', 'savedMenusModal', 'confirmModal', 'categoryPickerModal'];
        modals.forEach(id => {
            const modal = document.getElementById(id);
            if (modal && e.target === modal) {
                if (id === 'shoppingModal') closeShoppingModal();
                else modal.style.display = 'none';
            }
        });
    };
}