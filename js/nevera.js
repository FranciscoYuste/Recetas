// "¿Qué hay en la nevera?": recetas que usan lo que tienes, ordenadas por lo poco que
// te falta (la puntuación está en sugerencias.js, sin red, y tiene pruebas).

import { db } from './api.js';
import { categoryName, isFavorite } from './state.js';
import { $, escapeHtml, accentInsensitivePattern, plural } from './util.js';
import { registerActions, openModal, showToast } from './ui.js';
import { applyCatalogFilters } from './catalogo.js';
import { fridgeItems, rankFridge } from './sugerencias.js';
import { ingredientParts, ingredientListName } from './ingredientes.js';
import { addShoppingTexts } from './compra.js';

let missingByRecipe = {}; // id receta -> líneas de ingredientes que faltan

function query(items, limit) {
    const p = applyCatalogFilters(new URLSearchParams({ select: 'id,title,categoria,ingredients', limit: String(limit) }),
        { tipos: ['principal'] });
    items.forEach(it => p.append('ingredients', 'imatch.' + accentInsensitivePattern(it)));
    return db('recetas', '?' + p).then(d => d || []);
}

async function search() {
    const items = fridgeItems($('fridgeInput').value);
    const box = $('fridgeResults');
    if (items.length === 0) {
        box.innerHTML = '<p class="hint">Escribe al menos un ingrediente.</p>';
        return;
    }
    box.innerHTML = '<p class="hint">Buscando…</p>';
    // Primero las que llevan todo; si salen pocas, también las que llevan alguno.
    const found = await query(items, 300);
    if (found.length < 25 && items.length > 1) {
        const seen = new Set(found.map(r => r.id));
        (await Promise.all(items.map(it => query([it], 120)))).flat().forEach(r => {
            if (!seen.has(r.id)) {
                seen.add(r.id);
                found.push(r);
            }
        });
    }
    const ranked = rankFridge(found, items).slice(0, 30);
    missingByRecipe = {};
    if (ranked.length === 0) {
        box.innerHTML = '<p class="hint">No he encontrado recetas con eso. Prueba con menos ingredientes o con otro nombre (p. ej. «patata» en vez de «papas»).</p>';
        return;
    }
    box.innerHTML = `<p class="hint">${plural(ranked.length, 'idea', 'ideas')}: primero las que usan más de lo que tienes y piden menos compra.</p>` +
        ranked.map(s => {
            missingByRecipe[s.recipe.id] = s.missing;
            const faltan = s.missing.map(l => ingredientParts(l).nombre || l);
            return `<article class="fridge-item">` +
                `<button class="fridge-title" type="button" data-action="open-recipe" data-id="${s.recipe.id}">` +
                `${isFavorite(s.recipe.id) ? '⭐ ' : ''}${escapeHtml(s.recipe.title)}</button>` +
                `<p class="fridge-meta">${escapeHtml(categoryName(s.recipe.categoria))} · ✅ usa ${escapeHtml(s.used.join(', '))}</p>` +
                (faltan.length
                    ? `<p class="fridge-missing">🛒 Te falta: ${escapeHtml(faltan.join(', '))}</p>` +
                      `<button class="link-btn" type="button" data-action="fridge-add-missing" data-id="${s.recipe.id}">+ Añadir lo que falta a la lista</button>`
                    : '<p class="fridge-missing ok">🎉 ¡Tienes todo lo necesario!</p>') +
                `</article>`;
        }).join('');
}

async function addMissing(id) {
    const lines = missingByRecipe[id] || [];
    if (lines.length === 0) return;
    await addShoppingTexts(lines.map(ingredientListName));
    showToast(`🛒 ${plural(lines.length, 'ingrediente añadido', 'ingredientes añadidos')} a la lista`);
}

export function setupFridge() {
    $('fridgeForm').addEventListener('submit', (e) => {
        e.preventDefault();
        search().catch(err => {
            console.error(err);
            $('fridgeResults').innerHTML = '<p class="hint">No se pudo buscar. Revisa la conexión.</p>';
        });
    });
}

registerActions({
    'open-fridge': () => openModal('fridgeModal'),
    'fridge-add-missing': (el) => addMissing(Number(el.dataset.id))
});
