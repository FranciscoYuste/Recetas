let recipes = [];
let products = [];
let currentCategory = 'Todas';
const SUPABASE_URL = 'https://vvhkuuuwpfbyqpthetos.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_KKUvsjeLk_gGNfOpdcg9aQ_4R0NTNyV';
const SHOPPING_TABLE = 'ListaCompra';
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
        await loadShoppingList();
        renderRecipes();
    } catch (e) {
        console.error("Error cargando recetas:", e);
        showShoppingError(e);
    }

    // Filtros por Categoría
    document.getElementById('categoryFilters').addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            document.querySelectorAll('#categoryFilters button').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentCategory = e.target.dataset.cat;
            renderRecipes();
        }
    });

    // Filtro por Buscador
    document.getElementById('searchInput').addEventListener('input', renderRecipes);

    const backToTopBtn = document.getElementById('backToTopBtn');
    window.addEventListener('scroll', () => {
        backToTopBtn.hidden = window.scrollY < 500;
    }, { passive: true });
    backToTopBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    document.getElementById('openShoppingBtn').onclick = openShoppingModal;
    document.getElementById('closeShoppingModal').onclick = closeShoppingModal;
    document.getElementById('shoppingSearchInput').addEventListener('input', renderProductResults);
    document.getElementById('addShoppingItemBtn').onclick = () => {
        addSelectedProduct().catch(showShoppingError);
    };
    document.getElementById('shoppingQuantity').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addSelectedProduct().catch(showShoppingError);
    });

    // Modal Events
    document.getElementById('closeModal').onclick = () => {
        document.getElementById('recipeModal').style.display = 'none';
    };

    window.onclick = (e) => {
        if (e.target === document.getElementById('recipeModal')) {
            document.getElementById('recipeModal').style.display = 'none';
        }
        if (e.target === document.getElementById('shoppingModal')) closeShoppingModal();
    };

    document.getElementById('clearListBtn').onclick = () => {
        clearShoppingList().catch(showShoppingError);
    };
});

function renderRecipes() {
    const grid = document.getElementById('recipesGrid');
    const query = document.getElementById('searchInput').value.toLowerCase();

    const filtered = recipes.filter(r => {
        // Mapeo flexible para hacer coincidir las categorías del JSON con los botones HTML
        let categoryMatch = false;
        if (currentCategory === 'Todas') {
            categoryMatch = true;
        } else if (currentCategory === 'Ensaladas' && (r.categoria === 'Ensaladas' || r.categoria === 'Verduras y Ensaladas')) {
            categoryMatch = true;
        } else if (currentCategory === 'Sopas y Cremas' && (r.categoria === 'Sopas y Cremas' || r.categoria === 'Sopas y Guisos')) {
            categoryMatch = true;
        } else {
            categoryMatch = r.categoria === currentCategory;
        }

        const matchQuery = r.titulo.toLowerCase().includes(query);
        return categoryMatch && matchQuery;
    });

    grid.innerHTML = filtered.map(r => `
        <div class="card">
            <div>
                <span class="badge">${r.categoria || 'Sin categoría'}</span>
                <h3>${r.titulo}</h3>
            </div>
            <div class="card-actions">
                <button class="btn btn-primary" onclick="openModal('${r.id}')">📖 Ver Receta</button>
            </div>
        </div>
    `).join('');
}

function openModal(id) {
    const r = recipes.find(item => String(item.id) === String(id));
    if (!r) return;

    document.getElementById('modalTitle').innerText = r.titulo;
    document.getElementById('modalCategory').innerText = r.categoria || 'Sin categoría';

    document.getElementById('modalIngredients').innerHTML = r.ingredientes
        .map(ing => `<li>${ing}</li>`).join('');

    document.getElementById('modalSteps').innerText = r.pasos || "Sin pasos especificados.";

    const urlWrapper = document.getElementById('modalUrlWrapper');
    if (r.url) {
        urlWrapper.innerHTML = `<a href="${r.url}" target="_blank" rel="noopener">🌐 Ver receta original</a>`;
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
    const results = products
        .filter(product => normalizeText(product.nombre).includes(query))
        .slice(0, 12);
    const resultsEl = document.getElementById('shoppingSearchResults');
    resultsEl.innerHTML = results.map(product => `
        <button class="product-result" type="button" data-product-id="${product.id}">${product.nombre}</button>
    `).join('');
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
    shoppingList = data.map(item => ({
        id: item.id,
        producto: item.producto,
        cantidad: Number.isInteger(item.cantidad) && item.cantidad > 0 ? item.cantidad : 1
    }));
    renderShoppingList();
    setShoppingStatus('Lista actualizada');
}

async function addShoppingItem(item) {
    await supabaseRequest('', {
        method: 'POST',
        body: JSON.stringify(item)
    });
    await loadShoppingList();
}

async function updateShoppingItem(item) {
    await supabaseRequest(`?id=eq.${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ cantidad: item.cantidad })
    });
    await loadShoppingList();
}

async function removeShoppingItem(item) {
    await supabaseRequest(`?id=eq.${encodeURIComponent(item.id)}`, { method: 'DELETE' });
    await loadShoppingList();
}

async function clearShoppingList() {
    await supabaseRequest('?id=not.is.null', { method: 'DELETE' });
    await loadShoppingList();
}

function showShoppingError(error) {
    console.error('Error en la lista de compra:', error);
    setShoppingStatus(`Error: ${error.message}`, true);
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

    const response = await fetch(`${SUPABASE_URL}/rest/v1/${SHOPPING_TABLE}${query}`, {
        ...options,
        headers: {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
            'Content-Type': 'application/json',
            ...options.headers
        }
    });
    if (!response.ok) {
        throw new Error(`Supabase respondió con ${response.status}: ${await response.text()}`);
    }
    return response;
}

function renderShoppingList() {
    const listEl = document.getElementById('shoppingList');
    document.getElementById('cartCount').textContent = shoppingList.length;
    listEl.innerHTML = shoppingList.map((item, index) => `
        <li>
            <span>${item.producto}</span>
            <span class="shopping-item-quantity">${item.cantidad}</span>
            <button class="remove-item-btn" onclick="removeItem(${index})">Quitar</button>
        </li>
    `).join('');
}

function normalizeText(text) {
    return String(text)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}