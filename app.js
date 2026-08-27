let recipes = [];
let products = [];
let currentCategory = 'Todas';
let shoppingList = (JSON.parse(localStorage.getItem('shoppingList')) || [])
    .filter(item => item && item.nombre)
    .map(item => ({
        productId: item.productId || item.nombre.toLowerCase(),
        nombre: item.nombre,
        cantidad: Number.isInteger(item.cantidad) && item.cantidad > 0 ? item.cantidad : 1
    }));
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
        renderRecipes();
        renderShoppingList();
    } catch (e) {
        console.error("Error cargando recetas:", e);
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

    document.getElementById('openShoppingBtn').onclick = openShoppingModal;
    document.getElementById('closeShoppingModal').onclick = closeShoppingModal;
    document.getElementById('shoppingSearchInput').addEventListener('input', renderProductResults);
    document.getElementById('addShoppingItemBtn').onclick = addSelectedProduct;
    document.getElementById('shoppingQuantity').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addSelectedProduct();
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
        shoppingList = [];
        saveShoppingList();
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

function addSelectedProduct() {
    const quantity = Number(document.getElementById('shoppingQuantity').value);
    if (!selectedProduct || !Number.isInteger(quantity) || quantity < 1) return;

    const existingItem = shoppingList.find(item => item.productId === selectedProduct.id);
    if (existingItem) {
        existingItem.cantidad += quantity;
    } else {
        shoppingList.push({ productId: selectedProduct.id, nombre: selectedProduct.nombre, cantidad: quantity });
    }
    saveShoppingList();
    clearProductSelection();
}

function removeItem(index) {
    shoppingList.splice(index, 1);
    saveShoppingList();
}

function saveShoppingList() {
    localStorage.setItem('shoppingList', JSON.stringify(shoppingList));
    renderShoppingList();
}

function renderShoppingList() {
    const listEl = document.getElementById('shoppingList');
    document.getElementById('cartCount').textContent = shoppingList.length;
    listEl.innerHTML = shoppingList.map((item, index) => `
        <li>
            <span>${item.nombre}</span>
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