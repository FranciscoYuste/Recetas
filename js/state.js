// Estado compartido de la app. Un único objeto para que cada módulo lea y escriba lo
// mismo (los módulos ES no comparten variables sueltas).

import { THERMOMIX_KEY } from './config.js';
import { storage } from './util.js';

export const state = {
    appStarted: false,
    showThermomix: storage.getFlag(THERMOMIX_KEY),

    // catálogo
    categories: [],          // {id, categoria}
    favorites: [],           // {id, receta_id}
    favoriteRecipes: [],     // {id, title, url, categoria, ingredients, tipo, oculta}
    recipes: [],             // página actual del catálogo
    totalRecipes: 0,
    allRecipesCount: null,
    currentRecipePage: 0,
    currentScope: 'todas',   // 'favoritas' | 'propias' | 'todas' | 'ocultas'
    currentCategoryFilter: 'Todas',
    randomPool: { key: null, total: 0 },

    // receta abierta
    currentRecipe: null,
    randomMode: false,

    // semana
    currentWeekMenu: {},     // `${dia}_${tipo}` -> {receta_id, title, categoria, draftId}

    // compra
    products: [],            // {id, nombre}
    shoppingList: [],        // {id, id_producto, cantidad, nombre, comprado}
    habituales: [],          // {clave, nombre, veces, fijo, ultima_vez}
    habitualEditMode: false
};

// Avisos entre módulos: emit('favoritos') y quien muestre favoritas se repinta con
// on('favoritos', fn). Eventos: favoritos, categorias, semana, compra, catalogo.
const listeners = {};

export function on(event, fn) {
    (listeners[event] ||= []).push(fn);
}

export function emit(event) {
    (listeners[event] || []).forEach(fn => {
        try { fn(); } catch (e) { console.error(`Error en el aviso «${event}»:`, e); }
    });
}

export function isFavorite(recipeId) {
    return state.favorites.some(f => f.receta_id === recipeId);
}

export function categoryName(id) {
    const c = state.categories.find(cat => cat.id === id);
    return c ? c.categoria : 'Sin categoría';
}
