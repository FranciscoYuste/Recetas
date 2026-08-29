// App.js - Sistema completo integrado con Supabase
const SUPABASE_URL = 'https://vvhkuuuwpfbyqpthetos.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_KKUvsjeLk_gGNfOpdcg9aQ_4R0NTNyV';

// Tablas de Supabase
const RECIPES_TABLE = 'recetas';
const CATEGORIES_TABLE = 'categoria_recetas';
const FAVORITES_TABLE = 'recetas_favoritas';
const PRODUCTS_TABLE = 'productos';
const SHOPPING_TABLE = 'lista_compra';
const SAVED_WEEKS_TABLE = 'semanas_guardadas';

// Estado global de la aplicación
let recipes = [];
let categories = [];
let favorites = [];
let products = [];
let shoppingList = [];
let savedWeeks = [];

let currentCategory = 'Todas';
let selectedProduct = null;
let currentTab = 'recetas'; // 'recetas', 'semana', 'guardados'

// Objeto para el menú semanal actual en memoria { "L-comida": recetaId, ... }
let currentWeeklyPlan = {};

const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const MEALS = ['comida', 'cena'];

// Interceptor genérico para peticiones a Supabase REST API
async function supabaseRequest(table, query = '', options = {}) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
        ...options,
        headers: {
            'apikey': SUPABASE_PUBLISHABLE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_PUBLISHABLE_KEY,
            'Content-Type': 'application/json',
            'Prefer': options.method === 'POST' ? 'return=representation' : undefined,
            ...options.headers
        }
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Error en ${table} (${response.status}): ${errText}`);
    }
    if (response.status === 204) return [];
    return await response.json();
}

// Inicialización
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await reloadAllData();
        setupEventListeners();
        renderCategoriesNav();
        renderRecipes();
        renderWeeklyCalendar();
    } catch (e) {
        console.error('Error al inicializar:', e);
    }
});

async function reloadAllData() {
    await Promise.all([
        loadCategories(),
        loadRecipes(),
        loadFavorites(),
        loadProducts(),
        loadShoppingList(),
        loadSavedWeeks()
    ]);
}

// Carga de datos
async function loadCategories() {
    categories = await supabaseRequest(CATEGORIES_TABLE, '?select=id,categoria&order=id');
}

async function loadRecipes() {
    recipes = await supabaseRequest(RECIPES_TABLE, '?select=id,title,url,ingredients,steps,categoria&order=id');
}

async function loadFavorites() {
    // CAMBIO: 'receta_id' en minúscula
    const favs = await supabaseRequest(FAVORITES_TABLE, '?select=id,receta_id');
    favorites = favs.map(f => f.receta_id);
    updateFavoritesCount();
}

async function loadProducts() {
    products = await supabaseRequest(PRODUCTS_TABLE, '?select=id,nombre&order=nombre');
}

async function loadShoppingList() {
    const raw = await supabaseRequest(SHOPPING_TABLE, '?select=id,id_producto,cantidad&order=id');
    shoppingList = raw.map(item => {
        const prod = products.find(p => String(p.id) === String(item.id_producto));
        return {
            id: item.id,
            id_producto: item.id_producto,
            nombre: prod ? prod.nombre : 'Producto desconocido',
            cantidad: item.cantidad
        };
    });
    renderShoppingList();
}

async function loadSavedWeeks() {
    savedWeeks = await supabaseRequest(SAVED_WEEKS_TABLE, '?select=id,semana,dia,tipo_comida,receta_id&order=semana');
}

// Configuración de eventos
function setupEventListeners() {
    // Navegación por pestañas
    document.getElementById('navRecetas').onclick = () => switchTab('recetas');
    document.getElementById('navSemana').onclick = () => switchTab('semana');
    document.getElementById('navGuardados').onclick = () => switchTab('guardados');

    // Filtros de categoría y búsqueda de recetas
    const catBar = document.getElementById('categoryFilters');
    if (catBar) {
        catBar.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') {
                catBar.querySelectorAll('button').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                currentCategory = e.target.dataset.cat;
                renderRecipes();
            }
        });
    }

    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.addEventListener('input', renderRecipes);

    // Botón volver arriba
    const backToTopBtn = document.getElementById('backToTopBtn');
    if (backToTopBtn) {
        window.addEventListener('scroll', () => {
            backToTopBtn.hidden = window.scrollY < 500;
        }, { passive: true });
        backToTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    }

    // Modal Favoritos
    document.getElementById('openFavoritesBtn').onclick = openFavoritesModal;
    document.getElementById('closeFavoritesModal').onclick = () => closeModal('favoritesModal');
    document.getElementById('favoritesSearchInput').addEventListener('input', renderFavoritesGrid);

    // Modal Lista Compra
    document.getElementById('openShoppingBtn').onclick = openShoppingModal;
    document.getElementById('closeShoppingModal').onclick = () => closeModal('shoppingModal');
    document.getElementById('shoppingSearchInput').addEventListener('input', renderProductResults);
    document.getElementById('addShoppingItemBtn').onclick = () => addSelectedProduct().catch(showShoppingError);
    document.getElementById('clearListBtn').onclick = () => clearShoppingList().catch(showShoppingError);

    // Modales Receta
    document.getElementById('closeModal').onclick = () => closeModal('recipeModal');
    document.getElementById('openAddRecipeBtn').onclick = openAddRecipeModal;
    document.getElementById('closeAddRecipeModal').onclick = () => closeModal('addRecipeModal');
    document.getElementById('addRecipeForm').onsubmit = handleAddRecipe;

    // Gestión de Categorías
    document.getElementById('openCategoriesBtn').onclick = openCategoriesModal;
    document.getElementById('closeCategoriesModal').onclick = () => closeModal('categoriesModal');
    document.getElementById('addCategoryBtn').onclick = handleAddCategory;

    // Asignación al Menú Semanal
    document.getElementById('closeAddToWeekModal').onclick = () => closeModal('addToWeekModal');
    document.getElementById('confirmAddToWeekBtn').onclick = confirmAddToWeek;

    // Guardar Semana
    document.getElementById('saveWeekBtn').onclick = saveCurrentWeek;

    // Cierre al hacer click fuera
    window.onclick = (e) => {
        const modals = ['recipeModal', 'shoppingModal', 'favoritesModal', 'addRecipeModal', 'categoriesModal', 'addToWeekModal', 'confirmDeleteModal'];
        modals.forEach(mId => {
            const el = document.getElementById(mId);
            if (el && e.target === el) closeModal(mId);
        });
    };
}

function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`nav${tab.charAt(0).toUpperCase() + tab.slice(1)}`).classList.add('active');

    document.getElementById('viewRecetas').style.display = tab === 'recetas' ? 'block' : 'none';
    document.getElementById('viewSemana').style.display = tab === 'semana' ? 'block' : 'none';
    document.getElementById('viewGuardados').style.display = tab === 'guardados' ? 'block' : 'none';

    if (tab === 'guardados') renderSavedWeeks();
}

function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
}

// Categorías UI
function renderCategoriesNav() {
    const nav = document.getElementById('categoryFilters');
    let html = `<button class="${currentCategory === 'Todas' ? 'active' : ''}" data-cat="Todas">Todas</button>`;
    categories.forEach(c => {
        html += `<button class="${String(currentCategory) === String(c.id) ? 'active' : ''}" data-cat="${c.id}">${c.categoria}</button>`;
    });
    nav.innerHTML = html;
}

// Renderizado de Recetas
function renderRecipes() {
    const grid = document.getElementById('recipesGrid');
    const queryEl = document.getElementById('searchInput');
    const query = normalizeText(queryEl ? queryEl.value : '');

    const filtered = recipes.filter(r => {
        let categoryMatch = false;
        if (currentCategory === 'Todas') {
            categoryMatch = true;
        } else {
            categoryMatch = String(r.categoria) === String(currentCategory);
        }

        const recipeTitle = r.title || r.titulo || '';
        const matchQuery = normalizeText(recipeTitle).includes(query);

        return categoryMatch && matchQuery;
    });

    if (filtered.length === 0) {
        grid.innerHTML = '<div class="empty-state"><p>📭 No se encontraron recetas en esta categoría.</p></div>';
        return;
    }

    grid.innerHTML = filtered.map(r => {
        const isFav = favorites.includes(r.id);
        const title = r.title || r.titulo || 'Sin título';

        // Opciones del selector de categoría para esta receta
        const optionsHtml = categories.map(c => {
            const selected = String(c.id) === String(r.categoria) ? 'selected' : '';
            return `<option value="${c.id}" ${selected}>${c.categoria}</option>`;
        }).join('');

        return `
            <div class="card">
                <div>
                    <!-- Selector directo de categoría -->
                    <select class="badge-select" onchange="updateRecipeCategory(${r.id}, this.value)">
                        <option value="" ${!r.categoria ? 'selected' : ''}>Sin categoría</option>
                        ${optionsHtml}
                    </select>
                    <h3>${title}</h3>
                </div>
                <div class="card-actions">
                    <button class="favorite-btn ${isFav ? 'active' : ''}" title="${isFav ? 'Quitar de favoritos' : 'Agregar a favoritos'}" onclick="toggleFavorite(${r.id})">${isFav ? '⭐' : '☆'}</button>
                    <button class="btn btn-primary" onclick="openModal(${r.id})">📖 Ver</button>
                    <button class="btn btn-secondary" onclick="openAddToWeekModal(${r.id})">📅 Menú</button>
                    <button class="btn btn-delete" onclick="askDeleteRecipe(${r.id})">🗑️</button>
                </div>
            </div>
        `;
    }).join('');
}

// Modal Ver Receta
function openModal(id) {
    const r = recipes.find(item => String(item.id) === String(id));
    if (!r) return;
    const catObj = categories.find(c => String(c.id) === String(r.categoria));

    document.getElementById('modalTitle').innerText = r.title;
    document.getElementById('modalCategory').innerText = catObj ? catObj.categoria : 'Sin categoría';
    
    // Si ingredientes viene como string o json
    let ings = [];
    try { ings = typeof r.ingredients === 'string' ? JSON.parse(r.ingredients) : (r.ingredients || []); } catch { ings = [r.ingredients]; }
    document.getElementById('modalIngredients').innerHTML = Array.isArray(ings) ? ings.map(i => `<li>${i}</li>`).join('') : `<li>${r.ingredients}</li>`;

    document.getElementById('modalSteps').innerText = r.steps || 'Sin pasos especificados.';
    const urlWrapper = document.getElementById('modalUrlWrapper');
    urlWrapper.innerHTML = r.url ? `<a href="${r.url}" target="_blank" rel="noopener">🌐 Ver receta original</a>` : '';
    
    document.getElementById('recipeModal').style.display = 'flex';
}

// Añadir Nueva Receta
function openAddRecipeModal() {
    const select = document.getElementById('addRecipeCategory');
    select.innerHTML = categories.map(c => `<option value="${c.id}">${c.categoria}</option>`).join('');
    document.getElementById('addRecipeForm').reset();
    document.getElementById('addRecipeModal').style.display = 'flex';
}

async function handleAddRecipe(e) {
    e.preventDefault();
    const title = document.getElementById('addRecipeTitle').value;
    const categoria = parseInt(document.getElementById('addRecipeCategory').value);
    const ingredientsText = document.getElementById('addRecipeIngredients').value;
    const steps = document.getElementById('addRecipeSteps').value;
    const url = document.getElementById('addRecipeUrl').value;

    const ingredients = ingredientsText.split('\n').filter(i => i.trim() !== '');

    try {
        const newRec = await supabaseRequest(RECIPES_TABLE, '', {
            method: 'POST',
            body: JSON.stringify({ title, categoria, ingredients: JSON.stringify(ingredients), steps, url })
        });
        recipes.push(newRec[0] || newRec);
        closeModal('addRecipeModal');
        renderRecipes();
    } catch (err) {
        alert('Error creando receta: ' + err.message);
    }
}

// Eliminar Receta con modal de confirmación
let recipeToDeleteId = null;
function askDeleteRecipe(id) {
    recipeToDeleteId = id;
    const modal = document.getElementById('confirmDeleteModal');
    document.getElementById('confirmDeleteBtn').onclick = confirmDeleteRecipe;
    document.getElementById('cancelDeleteBtn').onclick = () => closeModal('confirmDeleteModal');
    modal.style.display = 'flex';
}

async function confirmDeleteRecipe() {
    if (!recipeToDeleteId) return;
    try {
        await supabaseRequest(RECIPES_TABLE, `?id=eq.${recipeToDeleteId}`, { method: 'DELETE' });
        recipes = recipes.filter(r => r.id !== recipeToDeleteId);
        favorites = favorites.filter(fId => fId !== recipeToDeleteId);
        closeModal('confirmDeleteModal');
        renderRecipes();
        updateFavoritesCount();
    } catch (err) {
        alert('Error al eliminar la receta: ' + err.message);
    }
}

// Gestión de Categorías Modal
function openCategoriesModal() {
    renderCategoriesList();
    document.getElementById('categoriesModal').style.display = 'flex';
}

function renderCategoriesList() {
    const list = document.getElementById('categoriesList');
    list.innerHTML = categories.map(c => `
        <li>
            <span>${c.categoria}</span>
            <button class="remove-item-btn" onclick="deleteCategory(${c.id})">Eliminar</button>
        </li>
    `).join('');
}

async function handleAddCategory() {
    const input = document.getElementById('newCategoryName');
    const name = input.value.trim();
    if (!name) return;
    try {
        const res = await supabaseRequest(CATEGORIES_TABLE, '', {
            method: 'POST',
            body: JSON.stringify({ categoria: name })
        });
        categories.push(res[0] || res);
        input.value = '';
        renderCategoriesList();
        renderCategoriesNav();
    } catch (err) {
        alert('Error creando categoría: ' + err.message);
    }
}

async function deleteCategory(id) {
    try {
        await supabaseRequest(CATEGORIES_TABLE, `?id=eq.${id}`, { method: 'DELETE' });
        categories = categories.filter(c => c.id !== id);
        renderCategoriesList();
        renderCategoriesNav();
        renderRecipes();
    } catch (err) {
        alert('No se puede eliminar la categoría si contiene recetas asociadas.');
    }
}

// Favoritos
async function toggleFavorite(recipeId) {
    if (favorites.includes(recipeId)) {
        // CAMBIO: 'receta_id' en minúscula
        await supabaseRequest(FAVORITES_TABLE, `?receta_id=eq.${recipeId}`, { method: 'DELETE' });
        favorites = favorites.filter(id => id !== recipeId);
    } else {
        await supabaseRequest(FAVORITES_TABLE, '', {
            method: 'POST',
            // CAMBIO: 'receta_id' en minúscula
            body: JSON.stringify({ receta_id: recipeId })
        });
        favorites.push(recipeId);
    }
    updateFavoritesCount();
    renderRecipes();
    if (document.getElementById('favoritesModal').style.display === 'flex') {
        renderFavoritesGrid();
    }
}

function updateFavoritesCount() {
    document.getElementById('favoritesCount').textContent = favorites.length;
}

function openFavoritesModal() {
    document.getElementById('favoritesModal').style.display = 'flex';
    document.getElementById('favoritesSearchInput').value = '';
    renderFavoritesGrid();
}

function renderFavoritesGrid() {
    const grid = document.getElementById('favoritesGrid');
    const query = normalizeText(document.getElementById('favoritesSearchInput').value);
    const favoriteRecipes = recipes.filter(r => favorites.includes(r.id) && normalizeText(r.title).includes(query));

    if (favoriteRecipes.length === 0) {
        grid.innerHTML = '<div class="empty-state"><p>📭 No hay recetas favoritas</p></div>';
        return;
    }

    grid.innerHTML = favoriteRecipes.map(r => `
        <div class="card">
            <div>
                <h3>${r.title}</h3>
            </div>
            <div class="card-actions">
                <button class="favorite-btn active" onclick="toggleFavorite(${r.id})">⭐</button>
                <button class="btn btn-primary" onclick="openModal(${r.id})">📖 Ver</button>
            </div>
        </div>
    `).join('');
}

// Lista de la compra
function openShoppingModal() {
    document.getElementById('shoppingModal').style.display = 'flex';
    document.getElementById('shoppingSearchInput').focus();
    renderProductResults();
}

function renderProductResults() {
    const query = normalizeText(document.getElementById('shoppingSearchInput').value);
    const results = products.filter(p => normalizeText(p.nombre).includes(query)).slice(0, 12);
    const resultsEl = document.getElementById('shoppingSearchResults');
    resultsEl.innerHTML = results.map(p => `<button class="product-result" type="button" onclick="selectProduct(${p.id})">${p.nombre}</button>`).join('');
}

function selectProduct(id) {
    selectedProduct = products.find(p => String(p.id) === String(id));
    if (!selectedProduct) return;
    document.getElementById('selectedProductName').textContent = selectedProduct.nombre;
    document.getElementById('quantityContainer').hidden = false;
    document.getElementById('shoppingQuantity').focus();
}

function clearProductSelection() {
    selectedProduct = null;
    document.getElementById('quantityContainer').hidden = true;
    document.getElementById('shoppingQuantity').value = 1;
}

async function addSelectedProduct() {
    const quantity = Number(document.getElementById('shoppingQuantity').value);
    if (!selectedProduct || quantity < 1) return;

    const existing = shoppingList.find(i => String(i.id_producto) === String(selectedProduct.id));
    if (existing) {
        const newQty = existing.cantidad + quantity;
        await supabaseRequest(SHOPPING_TABLE, `?id=eq.${existing.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ cantidad: newQty })
        });
    } else {
        await supabaseRequest(SHOPPING_TABLE, '', {
            method: 'POST',
            body: JSON.stringify({ id_producto: selectedProduct.id, cantidad: quantity })
        });
    }
    clearProductSelection();
    await loadShoppingList();
}

async function removeShoppingItem(id) {
    await supabaseRequest(SHOPPING_TABLE, `?id=eq.${id}`, { method: 'DELETE' });
    await loadShoppingList();
}

async function clearShoppingList() {
    await supabaseRequest(SHOPPING_TABLE, '?id=not.is.null', { method: 'DELETE' });
    await loadShoppingList();
}

function renderShoppingList() {
    document.getElementById('cartCount').textContent = shoppingList.length;
    const listEl = document.getElementById('shoppingList');
    listEl.innerHTML = shoppingList.map(item => `
        <li>
            <span>${item.nombre}</span>
            <span class="shopping-item-quantity">${item.cantidad}</span>
            <button class="remove-item-btn" onclick="removeShoppingItem(${item.id})">Quitar</button>
        </li>
    `).join('');
}

function showShoppingError(err) {
    console.error(err);
    document.getElementById('shoppingStatus').textContent = 'Error: ' + err.message;
}

// MENÚ SEMANAL
let recipeToAddToWeek = null;
function openAddToWeekModal(recipeId) {
    recipeToAddToWeek = recipeId;
    const selectDay = document.getElementById('weekDaySelect');
    selectDay.innerHTML = DAYS.map((d, i) => `<option value="${i + 1}">${d}</option>`).join('');
    document.getElementById('addToWeekModal').style.display = 'flex';
}

function confirmAddToWeek() {
    if (!recipeToAddToWeek) return;
    const day = document.getElementById('weekDaySelect').value;
    const meal = document.getElementById('weekMealSelect').value;
    const key = `${day}-${meal}`;
    
    currentWeeklyPlan[key] = recipeToAddToWeek;
    closeModal('addToWeekModal');
    renderWeeklyCalendar();
    switchTab('semana');
}

function renderWeeklyCalendar() {
    const grid = document.getElementById('weeklyCalendarGrid');
    let html = '';

    DAYS.forEach((dayName, index) => {
        const dayNum = index + 1;
        const comidaRecId = currentWeeklyPlan[`${dayNum}-comida`];
        const cenaRecId = currentWeeklyPlan[`${dayNum}-cena`];

        const comidaRec = recipes.find(r => String(r.id) === String(comidaRecId));
        const cenaRec = recipes.find(r => String(r.id) === String(cenaRecId));

        html += `
            <div class="day-card">
                <h3>${dayName}</h3>
                <div class="meal-block">
                    <strong>🌞 Comida:</strong>
                    ${comidaRec ? `<span>${comidaRec.title}</span> <button class="btn-clear-mini" onclick="removeFromWeek(${dayNum}, 'comida')">✕</button>` : '<em class="empty-meal">Sin asignar</em>'}
                </div>
                <div class="meal-block">
                    <strong>🌙 Cena:</strong>
                    ${cenaRec ? `<span>${cenaRec.title}</span> <button class="btn-clear-mini" onclick="removeFromWeek(${dayNum}, 'cena')">✕</button>` : '<em class="empty-meal">Sin asignar</em>'}
                </div>
            </div>
        `;
    });

    grid.innerHTML = html;
}

function removeFromWeek(day, meal) {
    delete currentWeeklyPlan[`${day}-${meal}`];
    renderWeeklyCalendar();
}

async function saveCurrentWeek() {
    const keys = Object.keys(currentWeeklyPlan);
    if (keys.length === 0) {
        alert('Asigna al menos una receta en la semana antes de guardar.');
        return;
    }

    const maxSemana = savedWeeks.reduce((max, w) => w.semana > max ? w.semana : max, 0);
    const nextSemana = maxSemana + 1;

    const payload = keys.map(k => {
        const [dia, tipo_comida] = k.split('-');
        return {
            semana: nextSemana,
            dia: parseInt(dia),
            tipo_comida: tipo_comida,
            // CAMBIO: 'receta_id' en minúscula
            receta_id: currentWeeklyPlan[k]
        };
    });

    try {
        await supabaseRequest(SAVED_WEEKS_TABLE, '', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        alert(`¡Menú de la Semana #${nextSemana} guardado exitosamente!`);
        currentWeeklyPlan = {};
        renderWeeklyCalendar();
        await loadSavedWeeks();
    } catch (err) {
        alert('Error al guardar el menú semanal: ' + err.message);
    }
}

// MENÚS GUARDADOS (Visualización y borrado)
function renderSavedWeeks() {
    const container = document.getElementById('savedWeeksContainer');
    if (!savedWeeks || savedWeeks.length === 0) {
        container.innerHTML = '<p class="empty-state">No hay semanas guardadas en la base de datos.</p>';
        return;
    }

    const grouped = {};
    savedWeeks.forEach(sw => {
        if (!grouped[sw.semana]) grouped[sw.semana] = [];
        grouped[sw.semana].push(sw);
    });

    let html = '';
    Object.keys(grouped).forEach(semanaNum => {
        const items = grouped[semanaNum];
        html += `
            <div class="saved-week-card">
                <div class="saved-week-header" onclick="toggleWeekAccordion(${semanaNum})">
                    <h3>📅 Menú Semanal #${semanaNum} <span id="arrow-${semanaNum}" class="accordion-arrow">▼</span></h3>
                    <button class="btn btn-delete" onclick="event.stopPropagation(); deleteSavedWeek(${semanaNum})">🗑️ Eliminar</button>
                </div>
                
                <div id="week-content-${semanaNum}" class="saved-week-content" style="display: none;">
                    <ul class="saved-week-list">
        `;

        DAYS.forEach((dayName, idx) => {
            const dayNum = idx + 1;
            const comida = items.find(i => i.dia === dayNum && i.tipo_comida === 'comida');
            const cena = items.find(i => i.dia === dayNum && i.tipo_comida === 'cena');

            const recComida = comida ? recipes.find(r => String(r.id) === String(comida.receta_id)) : null;
            const recCena = cena ? recipes.find(r => String(r.id) === String(cena.receta_id)) : null;

            const nombreComida = recComida ? (recComida.title || recComida.titulo) : '-';
            const nombreCena = recCena ? (recCena.title || recCena.titulo) : '-';

            html += `
                        <li class="saved-week-day-item">
                            <strong class="day-title">${dayName}</strong>
                            <div class="day-meals">
                                <div>🌞 <strong>Comida:</strong> <span>${nombreComida}</span></div>
                                <div>🌙 <strong>Cena:</strong> <span>${nombreCena}</span></div>
                            </div>
                        </li>
            `;
        });

        html += `
                    </ul>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function toggleWeekAccordion(semanaNum) {
    const content = document.getElementById(`week-content-${semanaNum}`);
    const arrow = document.getElementById(`arrow-${semanaNum}`);
    
    if (content.style.display === 'none') {
        content.style.display = 'block';
        if (arrow) arrow.textContent = '▲';
    } else {
        content.style.display = 'none';
        if (arrow) arrow.textContent = '▼';
    }
}

async function deleteSavedWeek(semanaNum) {
    if (!confirm(`¿Estás seguro de que deseas eliminar el Menú Semanal #${semanaNum}?`)) return;
    try {
        await supabaseRequest(SAVED_WEEKS_TABLE, `?semana=eq.${semanaNum}`, { method: 'DELETE' });
        savedWeeks = savedWeeks.filter(w => w.semana !== semanaNum);
        renderSavedWeeks();
    } catch (err) {
        alert('Error al eliminar la semana: ' + err.message);
    }
}

// Utilidades
function normalizeText(text) {
    return String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

async function updateRecipeCategory(recipeId, newCategoryId) {
    try {
        const payload = { categoria: newCategoryId ? parseInt(newCategoryId) : null };
        
        await supabaseRequest(RECIPES_TABLE, `?id=eq.${recipeId}`, {
            method: 'PATCH',
            body: JSON.stringify(payload)
        });

        // Actualizamos el objeto local en memoria
        const recipe = recipes.find(r => r.id === recipeId);
        if (recipe) {
            recipe.categoria = newCategoryId ? parseInt(newCategoryId) : null;
        }

        // Si estamos filtrando por una categoría concreta y cambió, re-renderizamos la vista
        if (currentCategory !== 'Todas') {
            renderRecipes();
        }
    } catch (err) {
        alert('Error al actualizar la categoría: ' + err.message);
        renderRecipes(); // Revertir en caso de error
    }
}