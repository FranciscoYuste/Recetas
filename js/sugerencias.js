// Lógica pura de las sugerencias: "Rellenar huecos" de la semana y "¿Qué hay en la
// nevera?". Sin DOM ni red: se prueba con `node --test`.

import { parseIngredients, shoppingKey, isPantryBasic } from './ingredientes.js';

// ---------------------------------------------------------------- rellenar semana

const CATEGORIAS_PESADAS = ['legumbres', 'arroces', 'pastas']; // mejor a mediodía
const MAX_POR_CATEGORIA = 3;

// Elige una receta para cada hueco.
// plan: {`${dia}_${tipo}`: {categoria}} con lo ya planificado (se va completando);
// candidates: recetas en orden de preferencia; catName: id de categoría -> nombre.
// Reglas: no repetir receta; comida y cena del mismo día de distinta categoría; no la
// misma categoría que el día anterior a la misma hora; como mucho 3 por categoría;
// legumbres, arroz y pasta mejor a mediodía (se relajan si no hay otra cosa).
export function chooseWeekRecipes(slots, candidates, plan, catName) {
    const taken = new Set();
    const counts = {};
    Object.values(plan).forEach(e => {
        const c = catName(e.categoria);
        counts[c] = (counts[c] || 0) + 1;
    });
    const catAt = (dia, tipo) => plan[`${dia}_${tipo}`] ? catName(plan[`${dia}_${tipo}`].categoria) : null;
    const result = [];

    for (const slot of slots) {
        const otherMeal = catAt(slot.dia, slot.tipo === 'Comida' ? 'Cena' : 'Comida');
        const yesterday = catAt(slot.dia - 1, slot.tipo);
        const fits = (r, strict) => {
            if (r.categoria == null) return true; // sin categoría: no sabemos, no se restringe
            const c = catName(r.categoria);
            if (c === otherMeal || c === yesterday) return false;
            if ((counts[c] || 0) >= MAX_POR_CATEGORIA) return false;
            if (strict && slot.tipo === 'Cena' && CATEGORIAS_PESADAS.includes(c.toLowerCase())) return false;
            return true;
        };
        const pick = candidates.find(r => !taken.has(r.id) && fits(r, true))
            || candidates.find(r => !taken.has(r.id) && fits(r, false))
            || candidates.find(r => !taken.has(r.id));
        if (!pick) break;
        taken.add(pick.id);
        const c = catName(pick.categoria);
        counts[c] = (counts[c] || 0) + 1;
        plan[`${slot.dia}_${slot.tipo}`] = { categoria: pick.categoria };
        result.push({ ...slot, recipe: pick });
    }
    return result;
}

// ---------------------------------------------------------------- nevera

// "Pollo, pimientos y arroz" -> ["pollo", "pimiento", "arroz"]
export function fridgeItems(text) {
    return [...new Set(String(text || '').split(/,|\s+y\s+|\n/).map(t => shoppingKey(t)).filter(k => k.length > 1))].slice(0, 6);
}

export function scoreFridgeRecipe(recipe, items) {
    const lines = parseIngredients(recipe.ingredients);
    const titleKey = ' ' + shoppingKey(recipe.title) + ' ';
    const used = new Set();
    const missing = [];
    lines.forEach(line => {
        const key = ' ' + shoppingKey(line) + ' ';
        const hits = items.filter(it => key.includes(' ' + it));
        if (hits.length) hits.forEach(h => used.add(h));
        else if (!isPantryBasic(line) && !/\bopcional\b/i.test(line)) missing.push(line);
    });
    items.forEach(it => { if (titleKey.includes(' ' + it)) used.add(it); });
    return {
        recipe,
        used: items.filter(it => used.has(it)),
        missing,
        inTitle: items.filter(it => titleKey.includes(' ' + it)).length,
        total: lines.length
    };
}

// Primero las que usan más de lo que tienes, luego las que piden menos compra.
export function rankFridge(recipes, items) {
    return recipes
        .map(r => scoreFridgeRecipe(r, items))
        .filter(s => s.total > 0 && s.used.length > 0)
        .sort((a, b) => b.used.length - a.used.length || a.missing.length - b.missing.length ||
            b.inTitle - a.inTitle || a.total - b.total);
}
