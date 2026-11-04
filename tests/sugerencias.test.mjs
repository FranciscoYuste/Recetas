import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseWeekRecipes, fridgeItems, rankFridge } from '../js/sugerencias.js';
import { sectionOf, groupBySection } from '../js/pasillos.js';

const CATS = { 1: 'Carnes', 2: 'Pescados y Mariscos', 3: 'Legumbres', 4: 'Verduras', 5: 'Pastas', 6: 'Ensaladas', 7: 'Huevos' };
const catName = id => CATS[id] || 'Sin categoría';
const semana = () => {
    const slots = [];
    for (let d = 1; d <= 7; d++) for (const t of ['Comida', 'Cena']) slots.push({ dia: d, tipo: t });
    return slots;
};
const candidatas = () => {
    const out = [];
    let id = 1;
    for (let k = 0; k < 6; k++) for (const c of [1, 1, 3, 5, 2, 4, 6, 7]) out.push({ id: id++, title: 'r' + id, categoria: c });
    return out;
};

test('rellenar semana: variado y sin repetir', () => {
    const res = chooseWeekRecipes(semana(), candidatas(), {}, catName);
    assert.equal(res.length, 14);
    assert.equal(new Set(res.map(r => r.recipe.id)).size, 14);
    const porCategoria = {};
    res.forEach(r => { porCategoria[r.recipe.categoria] = (porCategoria[r.recipe.categoria] || 0) + 1; });
    assert.ok(Object.values(porCategoria).every(n => n <= 3), 'como mucho 3 por categoría');
    for (const r of res) {
        const otra = res.find(x => x.dia === r.dia && x.tipo !== r.tipo);
        assert.notEqual(r.recipe.categoria, otra.recipe.categoria, 'comida y cena distintas');
        if (r.tipo === 'Cena') assert.ok(![3, 5].includes(r.recipe.categoria), 'nada pesado de cena');
    }
});

test('rellenar semana: respeta lo ya planificado y para si no hay más', () => {
    const plan = { '1_Comida': { categoria: 1 } };
    const res = chooseWeekRecipes([{ dia: 1, tipo: 'Cena' }], [{ id: 9, categoria: 1 }, { id: 10, categoria: 4 }], plan, catName);
    assert.equal(res[0].recipe.id, 10);
    assert.equal(chooseWeekRecipes(semana(), candidatas().slice(0, 3), {}, catName).length, 3);
});

test('nevera: lo que tienes, en singular y sin tildes', () => {
    assert.deepEqual(fridgeItems('Huevos, patatas y cebolla'), ['huevo', 'patata', 'cebolla']);
    assert.deepEqual(fridgeItems(' , '), []);
});

test('nevera: primero la que no necesita compra', () => {
    const items = fridgeItems('huevos, patatas, cebolla');
    const ranked = rankFridge([
        { id: 1, title: 'Patatas con nata', ingredients: '4 patatas 200 ml de nata Queso rallado' },
        { id: 2, title: 'Tortilla de patatas', ingredients: '6 huevos 4 patatas 1 cebolla Aceite de oliva Sal' },
        { id: 3, title: 'Gazpacho', ingredients: '1 kg de tomates 1 pepino Sal' }
    ], items);
    assert.deepEqual(ranked.map(s => s.recipe.id), [2, 1]);
    assert.deepEqual(ranked[0].missing, []);
    assert.equal(ranked[1].missing.length, 2);
});

test('pasillos del súper', () => {
    const casos = {
        '2 tomates': '🥬 Fruta y verdura', 'Tomate frito': '🥫 Despensa', 'Sal': '🥫 Despensa',
        '200 gramos de pechuga de pollo': '🥩 Carne y charcutería', 'Leche': '🥛 Lácteos y huevos',
        'leche condensada': '🥫 Despensa', 'Papel higiénico': '🧴 Higiene', 'Lavavajillas': '🧽 Limpieza y hogar',
        'Salmón': '🐟 Pescado y marisco', 'Barra de pan': '🥖 Panadería', 'guisantes congelados': '❄️ Congelados',
        'Cerveza': '🧃 Bebidas', '1 lata de atún': '🥫 Despensa', 'Gel de ducha': '🧴 Higiene', 'gelatina': '🥫 Despensa',
        'cosa rara': '📦 Otros'
    };
    for (const [nombre, pasillo] of Object.entries(casos)) assert.equal(sectionOf(nombre), pasillo, nombre);
    const grupos = groupBySection([{ nombre: 'arroz' }, { nombre: 'tomate' }, { nombre: 'lata de maíz' }]);
    assert.deepEqual(grupos.map(g => g.titulo), ['🥫 Despensa', '🥬 Fruta y verdura']);
    assert.equal(grupos[0].items.length, 2);
});
