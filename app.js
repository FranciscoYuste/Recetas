let recipes = [];
let currentCategory = 'Todas';
let shoppingList = JSON.parse(localStorage.getItem('shoppingList')) || [];

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch('recetas_final.json');
        recipes = await response.json();
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

    // Modal Events
    document.getElementById('closeModal').onclick = () => {
        document.getElementById('recipeModal').style.display = 'none';
    };

    window.onclick = (e) => {
        if (e.target === document.getElementById('recipeModal')) {
            document.getElementById('recipeModal').style.display = 'none';
        }
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
                <button class="btn btn-secondary" onclick="addIngredientsToCart('${r.id}')">🛒 + Compra</button>
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

function addIngredientsToCart(id) {
    const r = recipes.find(item => String(item.id) === String(id));
    if (!r) return;

    r.ingredientes.forEach(ing => {
        if (!shoppingList.some(item => item.nombre === ing)) {
            shoppingList.push({ nombre: ing, completado: false });
        }
    });
    saveShoppingList();
}

function toggleItem(index) {
    shoppingList[index].completado = !shoppingList[index].completado;
    saveShoppingList();
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
    listEl.innerHTML = shoppingList.map((item, index) => `
        <li class="${item.completado ? 'completed' : ''}">
            <span onclick="toggleItem(${index})" style="cursor: pointer; flex-grow: 1;">
                ${item.completado ? '✔️' : '⚪'} ${item.nombre}
            </span>
            <button onclick="removeItem(${index})" style="background:none; border:none; color:red; cursor:pointer;">❌</button>
        </li>
    `).join('');
}