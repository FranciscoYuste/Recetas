// npm test   (o: node --test "tests/*.test.mjs", desde app_web/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    parseIngredients, ingredientParts, ingredientListName, shoppingKey, mergeIngredients, parseSteps, isPantryBasic
} from '../js/ingredientes.js';

test('separa ingredientes de formatos muy distintos', () => {
    assert.deepEqual(parseIngredients('6 piezas de Pollo 500 gramos de Jitomate 2 piezas de Chile ancho'),
        ['6 piezas de Pollo', '500 gramos de Jitomate', '2 piezas de Chile ancho']);
    assert.deepEqual(parseIngredients('3 tazas de agua (750 ml)      2 cucharada de aceite (28 g)'),
        ['3 tazas de agua (750 ml)', '2 cucharada de aceite (28 g)']);
    assert.deepEqual(parseIngredients('5 frutillas1/2 bananaTrozos de ananá'),
        ['5 frutillas', '1/2 banana', 'Trozos de ananá']);
    assert.deepEqual(parseIngredients('Mejillones Ajo Cebolla fresca Pimiento verde Guindilla (opcional)'),
        ['Mejillones', 'Ajo', 'Cebolla fresca', 'Pimiento verde', 'Guindilla (opcional)']);
    assert.deepEqual(parseIngredients('4 huevos 2 o 3 cebollas blancas grandes Sal Pimienta'),
        ['4 huevos', '2 o 3 cebollas blancas grandes', 'Sal', 'Pimienta']);
});

test('no parte nombres compuestos en Mayúscula', () => {
    assert.deepEqual(parseIngredients('150 gr de Jamón Serrano 2 Huevos'), ['150 gr de Jamón Serrano', '2 Huevos']);
    assert.deepEqual(parseIngredients('1 pieza de Queso Manchego Aceite de oliva Virgen Extra Sal'),
        ['1 pieza de Queso Manchego', 'Aceite de oliva Virgen Extra', 'Sal']);
    assert.deepEqual(parseIngredients('120 gr. de queso feta 50 gr. de aceitunas'),
        ['120 gr. de queso feta', '50 gr. de aceitunas']);
});

test('descarta restos y duplicados', () => {
    assert.deepEqual(parseIngredients('Ingredientes: 1 limón 175 g 1 limón'), ['1 limón']);
});

test('cantidad y nombre limpio', () => {
    assert.deepEqual(ingredientParts('200 gr. de pechuga de pollo (en filetes)'), { cantidad: '200 gr.', nombre: 'Pechuga de pollo' });
    assert.deepEqual(ingredientParts('1½ litros de Agua'), { cantidad: '1½ litros', nombre: 'Agua' });
    assert.deepEqual(ingredientParts('1 1/2 tazas de harina'), { cantidad: '1 1/2 tazas', nombre: 'Harina' });
    assert.equal(ingredientParts('1/2 cebolla mediana finamente picada').nombre, 'Cebolla');
    assert.equal(ingredientParts('Sal y pimienta a gusto').nombre, 'Sal y pimienta');
    assert.equal(ingredientParts('1 cubo de CALDO DE POLLO').nombre, 'Caldo de pollo');
    assert.deepEqual(ingredientParts('1 lámina de hojaldre'), { cantidad: '1', nombre: 'Lámina de hojaldre' });
    assert.deepEqual(ingredientParts('2 l de agua'), { cantidad: '2 l', nombre: 'Agua' });
});

test('nombre para la lista de la compra', () => {
    assert.equal(ingredientListName('200 gramos de pechuga de pollo'), 'Pechuga de pollo (200 gramos)');
    assert.equal(ingredientListName('1 cebolla mediana picada'), 'Cebolla');
    assert.equal(ingredientListName('3 dientes de ajo'), 'Ajo (3 dientes)');
});

test('misma clave = mismo producto', () => {
    const grupos = [['2 tomates', 'Tomate', 'Tomates (500 g)'], ['Champiñones', 'champiñón'], ['Limones', 'limón'],
        ['Pan', 'panes'], ['Huevos', '6 huevos'], ['Pechuga de pollo (200 gramos)', 'pechugas de pollo']];
    for (const g of grupos) assert.equal(new Set(g.map(shoppingKey)).size, 1, g.join(' / '));
    assert.notEqual(shoppingKey('Sal'), shoppingKey('Salsa'));
    assert.notEqual(shoppingKey('Leche'), shoppingKey('Leche condensada'));
});

test('básicos de despensa', () => {
    assert.ok(isPantryBasic('1 pizca de sal'));
    assert.ok(isPantryBasic('Aceite de oliva virgen extra'));
    assert.ok(isPantryBasic('Perejil a gusto'));
    assert.ok(!isPantryBasic('2 cebollas'));
    assert.ok(!isPantryBasic('100 g de ajonjolí'));
});

test('junta ingredientes repetidos de varias recetas', () => {
    const merged = mergeIngredients([
        { title: 'Pisto', ingredients: '2 cebollas 1 calabacín Sal' },
        { title: 'Lentejas', ingredients: '1 cebolla 300 g de lentejas Sal' }
    ]);
    const cebolla = merged.find(m => m.key === 'cebolla');
    assert.deepEqual(cebolla.recetas, ['Pisto', 'Lentejas']);
    assert.equal(cebolla.lineas.length, 2);
    assert.ok(merged.find(m => m.key === 'sal').basico);
    assert.equal(merged.length, 4);
});

test('pasos numerados', () => {
    assert.deepEqual(parseSteps('1 Lavamos las verduras. 2 Las cortamos en dados. 3 Freímos'),
        ['Lavamos las verduras.', 'Las cortamos en dados.', 'Freímos']);
    assert.deepEqual(parseSteps('Tortilla\nPaso 1: batir\nPaso 2: cuajar', 'Tortilla'), ['batir', 'cuajar']);
    assert.deepEqual(parseSteps(''), []);
});

test('un párrafo larguísimo se parte en pasos por frases', () => {
    const frase = 'Cortamos las verduras en trozos pequeños y las reservamos en un bol grande. ';
    const pasos = parseSteps(frase.repeat(8).trim());
    assert.ok(pasos.length >= 3, `salen ${pasos.length} pasos`);
    assert.ok(pasos.every(p => p.length <= 250 + frase.length));
    assert.equal(pasos.join(' '), frase.repeat(8).trim());
});
