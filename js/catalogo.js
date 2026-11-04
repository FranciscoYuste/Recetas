// Datos del catálogo compartidos por varias pantallas: categorías, favoritas, filtros
// de las consultas y recetas al azar.

import { db, dbCount, dbInsert, dbDelete } from './api.js';
import { state, emit, isFavorite } from './state.js';
import { showToast } from './ui.js';

export async function loadCategories() {
    state.categories = await db('categoria_recetas', '?select=id,categoria&order=categoria.asc') || [];
    emit('categorias');
}

export async function loadFavorites() {
    try {
        state.favorites = await db('recetas_favoritas', '?select=id,receta_id') || [];
        const ids = [...new Set(state.favorites.map(f => f.receta_id))];
        state.favoriteRecipes = ids.length === 0 ? [] : await db('recetas',
            `?select=id,title,url,categoria,ingredients,tipo,oculta&id=in.(${ids.join(',')})&order=title.asc`) || [];
    } catch (e) {
        console.error('Error cargando favoritos:', e);
        state.favorites = [];
        state.favoriteRecipes = [];
    }
    emit('favoritos');
}

export async function toggleFavorite(recipeId) {
    const was = isFavorite(recipeId);
    try {
        if (was) await dbDelete('recetas_favoritas', `?receta_id=eq.${recipeId}`);
        else await dbInsert('recetas_favoritas', { receta_id: recipeId });
        await loadFavorites();
        showToast(was ? 'Quitada de favoritas' : '⭐ Añadida a favoritas');
    } catch (e) {
        showToast('No se pudo actualizar la favorita: ' + e.message, true);
    }
}

// Filtros comunes de las consultas al catálogo: sin ocultas, sin Thermomix (salvo que se
// pida en Ajustes) y, para sugerir menús, solo los tipos indicados. Las recetas sin
// tipo (añadidas a mano antes de existir la columna) pasan siempre.
export function applyCatalogFilters(params, { tipos = null, sinTipos = null, ocultas = false } = {}) {
    params.append('oculta', ocultas ? 'is.true' : 'is.false');
    if (tipos) params.append('or', `(tipo.is.null,tipo.in.(${tipos.join(',')}))`);
    else if (sinTipos) params.append('or', `(tipo.is.null,tipo.not.in.(${sinTipos.join(',')}))`);
    if (!state.showThermomix && !ocultas) params.append('title', 'not.imatch.thermomix');
    return params;
}

// ¿Sirve para proponerla como comida o cena? (para las que ya están en memoria)
export function isMenuRecipe(r) {
    return (!r.tipo || r.tipo === 'principal') && !r.oculta && (state.showThermomix || !/thermomix/i.test(r.title || ''));
}

// n platos principales al azar del servidor.
export async function randomServerRecipes(n) {
    const filters = () => applyCatalogFilters(new URLSearchParams(), { tipos: ['principal'] });
    const key = filters().toString();
    if (state.randomPool.key !== key) {
        const p = filters();
        p.set('select', 'id');
        p.set('limit', '1');
        const { total } = await dbCount('recetas', p);
        state.randomPool = { key, total };
    }
    const total = state.randomPool.total;
    if (!total) return [];
    const offsets = new Set();
    while (offsets.size < Math.min(n, total)) offsets.add(Math.floor(Math.random() * total));
    const rows = await Promise.all([...offsets].map(offset => {
        const p = filters();
        p.set('select', 'id,title,categoria');
        p.set('order', 'id.asc');
        p.set('offset', String(offset));
        p.set('limit', '1');
        return db('recetas', '?' + p).then(d => d && d[0]);
    }));
    return rows.filter(Boolean);
}

// Favorita (70 % de las veces si hay bastantes) o descubrimiento al azar.
export async function getRandomRecipe() {
    const favs = state.favoriteRecipes.filter(isMenuRecipe);
    const useFavorites = favs.length > 0 && Math.random() < (favs.length >= 5 ? 0.7 : 0.5);
    if (useFavorites) return favs[Math.floor(Math.random() * favs.length)];
    const [recipe] = await randomServerRecipes(1);
    return recipe || favs[0] || null;
}

// Al cambiar el filtro de Thermomix u ocultar una receta, el total cambia.
export function resetRandomPool() {
    state.randomPool = { key: null, total: 0 };
}
