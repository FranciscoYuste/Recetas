// App.js - Recetas Web con Favoritos
let recipes = [];
let products = [];
let currentCategory = 'Todas';
let favorites = [];
const SUPABASE_URL = 'https://vvhkuuuwpfbyqpthetos.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_KKUvsjeLk_gGNfOpdcg9aQ_4R0NTNyV';
const SHOPPING_TABLE = 'ListaCompra';
const FAVORITES_TABLE = 'recetasFavoritas';
let shoppingList = [];
let selectedProduct = null;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const [recipesResponse, productsResponse] = await Promise.all([
            fetch('recetas_final.json'),
            fetch('productos.json')
        ]);
        recipes = await recipesResponse.json();
        const productsData = await productsResponse.json();
        products = Array.isArray(productsData) ? productsData : productsData.productos || [];
        favorites = await loadFavorites();
        updateFavoritesCount();
        await loadShoppingList();
        renderRecipes();
    } catch (e) {
        console.error('Error cargando recetas:', e);
        showShoppingError(e);
    }

    const categoryFilters = document.getElementById('categoryFilters');
    if (categoryFilters) {
        categoryFilters.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') {
                categoryFilters.querySelectorAll('button').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                currentCategory = e.target.dataset.cat;
                renderRecipes();
            }
        });
    }

    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.addEventListener('input', renderRecipes);

    const backToTopBtn = document.getElementById('backToTopBtn');
    if (backToTopBtn) {
        window.addEventListener('scroll', () => {
            backToTopBtn.hidden = window.scrollY < 500;
        }, { passive: true });
        backToTopBtn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    const openFavoritesBtn = document.getElementById('openFavoritesBtn');
    const favoritesModal = document.getElementById('favoritesModal');
    const closeFavoritesModalBtn = document.getElementById('closeFavoritesModal');
    const favoritesSearchInput = document.getElementById('favoritesSearchInput');
    const favoritesFilters = document.getElementById('favoritesFilters');

    if (openFavoritesBtn) openFavoritesBtn.onclick = openFavoritesModal;
    if (closeFavoritesModalBtn) closeFavoritesModalBtn.onclick = closeFavoritesModal;
    if (favoritesSearchInput) favoritesSearchInput.addEventListener('input', renderFavoritesGrid);

    if (favoritesFilters) {
        favoritesFilters.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') {
                favoritesFilters.querySelectorAll('button').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                renderFavoritesGrid();
            }
        });
    }

    const openShoppingBtn = document.getElementById('openShoppingBtn');
    const closeShoppingModalBtn = document.getElementById('closeShoppingModal');
    const shoppingSearchInput = document.getElementById('shoppingSearchInput');
    const addShoppingItemBtn = document.getElementById('addShoppingItemBtn');
    const shoppingQuantity = document.getElementById('shoppingQuantity');

    if (openShoppingBtn) openShoppingBtn.onclick = openShoppingModal;
    if (closeShoppingModalBtn) closeShoppingModalBtn.onclick = closeShoppingModal;
    if (shoppingSearchInput) shoppingSearchInput.addEventListener('input', renderProductResults);
    if (addShoppingItemBtn) addShoppingItemBtn.onclick = () => addSelectedProduct().catch(showShoppingError);
    if (shoppingQuantity) {
        shoppingQuantity.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') addSelectedProduct().catch(showShoppingError);
        });
    }

    const closeModalBtn = document.getElementById('closeModal');
    const recipeModal = document.getElementById('recipeModal');
    const shoppingModal = document.getElementById('shoppingModal');

    if (closeModalBtn) closeModalBtn.onclick = () => {
        if (recipeModal) recipeModal.style.display = 'none';
    };

    window.onclick = (e) => {
        if (recipeModal && e.target === recipeModal) {
            recipeModal.style.display = 'none';
        }
        if (shoppingModal && e.target === shoppingModal) closeShoppingModal();
        if (favoritesModal && e.target === favoritesModal) closeFavoritesModal();
    };

    const clearListBtn = document.getElementById('clearListBtn');
    if (clearListBtn) clearListBtn.onclick = () => {
        clearShoppingList().catch(showShoppingError);
    };
});

function renderRecipes() {
    const grid = document.getElementById('recipesGrid');
    const query = document.getElementById('searchInput').value.toLowerCase();
    const filtered = recipes.filter(r => {
        let categoryMatch = false;
        if (currentCategory === 'Todas') categoryMatch = true;
        else if (currentCategory === 'Ensaladas' && (r.categoria === 'Ensaladas' || r.categoria === 'Verduras y Ensaladas')) categoryMatch = true;
        else if (currentCategory === 'Sopas y Cremas' && (r.categoria === 'Sopas y Cremas' || r.categoria === 'Sopas y Guisos')) categoryMatch = true;
        else categoryMatch = r.categoria === currentCategory;
        const matchQuery = r.titulo.toLowerCase().includes(query);
        return categoryMatch && matchQuery;
    });
    grid.innerHTML = filtered.map(r => '<div class="card"><div><span class="badge">' + (r.categoria || 'Sin categoría') + '</span><h3>' + r.titulo + '</h3></div><div class="card-actions"><button class="favorite-btn ' + (isFavorite(r.id) ? 'active' : '') + '" title="' + (isFavorite(r.id) ? 'Quitar de favoritos' : 'Agregar a favoritos') + '" onclick="toggleFavorite(\'' + r.id + '\')">' + (isFavorite(r.id) ? '⭐' : '☆') + '</button><button class="btn btn-primary" onclick="openModal(\'' + r.id + '\')">📖 Ver Receta</button></div></div>').join('');
}

function openModal(id) {
    const r = recipes.find(item => String(item.id) === String(id));
    if (!r) return;
    document.getElementById('modalTitle').innerText = r.titulo;
    document.getElementById('modalCategory').innerText = r.categoria || 'Sin categoría';
    document.getElementById('modalIngredients').innerHTML = r.ingredientes.map(ing => '<li>' + ing + '</li>').join('');
    document.getElementById('modalSteps').innerText = r.pasos || 'Sin pasos especificados.';
    const urlWrapper = document.getElementById('modalUrlWrapper');
    if (r.url) {
        urlWrapper.innerHTML = '<a href="' + r.url + '" target="_blank" rel="noopener">🌐 Ver receta original</a>';
    } else {
        urlWrapper.innerHTML = '';
    }
    document.getElementById('recipeModal').style.display = 'flex';
}

function openShoppingModal() {
    document.getElementById('shoppingModal').style.display = 'flex';
    document.getElementById('shoppingSearchInput').focus();
    renderProductResults();
}

function closeShoppingModal() {
    document.getElementById('shoppingModal').style.display = 'none';
    clearProductSelection();
}

function renderProductResults() {
    const query = normalizeText(document.getElementById('shoppingSearchInput').value);
    const results = products.filter(product => normalizeText(product.nombre).includes(query)).slice(0, 12);
    const resultsEl = document.getElementById('shoppingSearchResults');
    resultsEl.innerHTML = results.map(product => '<button class="product-result" type="button" data-product-id="' + product.id + '">' + product.nombre + '</button>').join('');
    resultsEl.querySelectorAll('.product-result').forEach(button => {
        button.onclick = () => selectProduct(button.dataset.productId);
    });
}

function selectProduct(id) {
    selectedProduct = products.find(product => String(product.id) === String(id));
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
    const existingItem = shoppingList.find(item => item.producto === selectedProduct.nombre);
    if (existingItem) {
        existingItem.cantidad += quantity;
        await updateShoppingItem(existingItem);
    } else {
        await addShoppingItem({ producto: selectedProduct.nombre, cantidad: quantity });
    }
    clearProductSelection();
}

function removeItem(index) {
    const item = shoppingList[index];
    if (item) removeShoppingItem(item).catch(showShoppingError);
}

async function loadShoppingList() {
    const response = await supabaseRequest('?select=id,producto,cantidad&order=id');
    const data = await response.json();
    shoppingList = data.map(item => ({ id: item.id, producto: item.producto, cantidad: Number.isInteger(item.cantidad) && item.cantidad > 0 ? item.cantidad : 1 }));
    renderShoppingList();
    setShoppingStatus('Lista actualizada');
}

async function addShoppingItem(item) {
    await supabaseRequest('', { method: 'POST', body: JSON.stringify(item) });
    await loadShoppingList();
}

async function updateShoppingItem(item) {
    await supabaseRequest('?id=eq.' + encodeURIComponent(item.id), { method: 'PATCH', body: JSON.stringify({ cantidad: item.cantidad }) });
    await loadShoppingList();
}

async function removeShoppingItem(item) {
    await supabaseRequest('?id=eq.' + encodeURIComponent(item.id), { method: 'DELETE' });
    await loadShoppingList();
}

async function clearShoppingList() {
    await supabaseRequest('?id=not.is.null', { method: 'DELETE' });
    await loadShoppingList();
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

async function supabaseRequest(query = '', options = {}) {
    if (SUPABASE_PUBLISHABLE_KEY === 'PEGA_AQUI_TU_PUBLISHABLE_KEY') {
        throw new Error('Falta configurar la publishable key de Supabase en app.js');
    }
    const response = await fetch(SUPABASE_URL + '/rest/v1/' + SHOPPING_TABLE + query, {
        ...options,
        headers: {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            Authorization: 'Bearer ' + SUPABASE_PUBLISHABLE_KEY,
            'Content-Type': 'application/json',
            ...options.headers
        }
    });
    if (!response.ok) {
        throw new Error('Supabase respondió con ' + response.status + ': ' + await response.text());
    }
    return response;
}

function renderShoppingList() {
    const listEl = document.getElementById('shoppingList');
    document.getElementById('cartCount').textContent = shoppingList.length;
    listEl.innerHTML = shoppingList.map((item, index) => '<li><span>' + item.producto + '</span><span class="shopping-item-quantity">' + item.cantidad + '</span><button class="remove-item-btn" onclick="removeItem(' + index + ')">Quitar</button></li>').join('');
}

function normalizeText(text) {
    return String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// FUNCIONES DE FAVORITOS
async function loadFavorites() {
    try {
        const url = new URL(SUPABASE_URL + '/rest/v1/' + FAVORITES_TABLE, window.location.origin);
        url.searchParams.append('select', 'recipe_id');
        const response = await fetch(url, {
            headers: {
                'apikey': SUPABASE_PUBLISHABLE_KEY,
                'Authorization': 'Bearer ' + SUPABASE_PUBLISHABLE_KEY
            }
        });
        if (!response.ok) throw new Error('Error ' + response.status);
        const data = await response.json();
        let favoriteIds = data.map(item => item.recipe_id);
        let validFavorites = favoriteIds.filter(id => recipes.find(r => r.id === id));
        if (favoriteIds.length !== validFavorites.length) {
            const huerfanos = favoriteIds.filter(id => !validFavorites.includes(id));
            for (const id of huerfanos) {
                await removeFavoriteFromDB(id);
            }
        }
        return validFavorites;
    } catch (e) {
        console.error('Error cargando favoritos:', e);
        return [];
    }
}

async function addFavoriteToDBAsync(recipeId) {
    try {
        const url = new URL(SUPABASE_URL + '/rest/v1/' + FAVORITES_TABLE, window.location.origin);
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_PUBLISHABLE_KEY,
                'Authorization': 'Bearer ' + SUPABASE_PUBLISHABLE_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ recipe_id: recipeId })
        });
        if (!response.ok) throw new Error('Error ' + response.status);
        favorites.push(recipeId);
        updateFavoritesCount();
        renderRecipes();
    } catch (e) {
        console.error('Error agregando favorito:', e);
    }
}

async function removeFavoriteFromDB(recipeId) {
    try {
        const url = new URL(SUPABASE_URL + '/rest/v1/' + FAVORITES_TABLE, window.location.origin);
        url.searchParams.append('recipe_id', 'eq.' + recipeId);
        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'apikey': SUPABASE_PUBLISHABLE_KEY,
                'Authorization': 'Bearer ' + SUPABASE_PUBLISHABLE_KEY
            }
        });
        if (!response.ok) throw new Error('Error ' + response.status);
        favorites = favorites.filter(id => id !== recipeId);
        updateFavoritesCount();
        renderRecipes();
    } catch (e) {
        console.error('Error removiendo favorito:', e);
    }
}

function isFavorite(recipeId) {
    return favorites.includes(recipeId);
}

function updateFavoritesCount() {
    const favCount = document.getElementById('favoritesCount');
    if (favCount) {
        favCount.textContent = favorites.length;
    }
}

function openFavoritesModal() {
    document.getElementById('favoritesModal').style.display = 'flex';
    document.getElementById('favoritesSearchInput').value = '';
    document.querySelectorAll('#favoritesFilters button').forEach((b, i) => {
        if (i === 0) b.classList.add('active');
        else b.classList.remove('active');
    });
    renderFavoritesGrid();
}

function closeFavoritesModal() {
    document.getElementById('favoritesModal').style.display = 'none';
}

function renderFavoritesGrid() {
    const grid = document.getElementById('favoritesGrid');
    const query = document.getElementById('favoritesSearchInput').value.toLowerCase();
    const currentFavCategory = document.querySelector('#favoritesFilters .active')?.dataset.cat || 'Todas';
    const favoriteRecipes = recipes.filter(r => favorites.includes(r.id));
    const filtered = favoriteRecipes.filter(r => {
        let categoryMatch = false;
        if (currentFavCategory === 'Todas') categoryMatch = true;
        else if (currentFavCategory === 'Ensaladas' && (r.categoria === 'Ensaladas' || r.categoria === 'Verduras y Ensaladas')) categoryMatch = true;
        else if (currentFavCategory === 'Sopas y Cremas' && (r.categoria === 'Sopas y Cremas' || r.categoria === 'Sopas y Guisos')) categoryMatch = true;
        else categoryMatch = r.categoria === currentFavCategory;
        const matchQuery = r.titulo.toLowerCase().includes(query);
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
    grid.innerHTML = filtered.map(r => '<div class="card"><div><span class="badge">' + (r.categoria || 'Sin categoría') + '</span><h3>' + r.titulo + '</h3></div><div class="card-actions"><button class="favorite-btn active" title="Quitar de favoritos" onclick="toggleFavorite(\'' + r.id + '\'); renderFavoritesGrid();">⭐</button><button class="btn btn-primary" onclick="openModal(\'' + r.id + '\')">📖 Ver Receta</button></div></div>').join('');
}

async function toggleFavorite(recipeId) {
    if (isFavorite(recipeId)) {
        await removeFavoriteFromDB(recipeId);
    } else {
        await addFavoriteToDBAsync(recipeId);
    }
}
