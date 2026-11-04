// Ingredientes y pasos: de la cadena importada (muy irregular) a listas limpias.
// Sin DOM ni red: se prueba con `node --test` (tests/ingredientes.test.mjs).
//
// Los ingredientes importados vienen en una sola cadena con formatos muy distintos:
//   "6 piezas de Pollo 500 gramos de Jitomate 2 piezas de Chile ancho"
//   "1 cubo de CALDO MAGGI® (10 g)      3 tazas de agua (750 ml)"
//   "5 frutillas1/2 bananaTrozos de ananáJugo de 1 naranja"
//   "Mejillones Ajo Cebolla fresca Pimiento verde Guindilla (opcional)"
// Se trocean por saltos de línea y espacios múltiples, por palabras pegadas
// ("frutillas1/2") y, palabra a palabra, antes de una cantidad o de una palabra en
// Mayúscula, salvo que vengan detrás de un enlace ("de", "con", "y"...).

import { normalizeText } from './util.js';

const UNIDADES = 'unidad(?:es)?|tazas?|cucharadas?(?:\\s+soperas?|\\s+postre)?|cucharaditas?|cdas?\\.?|cditas?\\.?|cdtas?\\.?|' +
    'pocillos?|ud\\.?|uds\\.?|' +
    'manojos?|gr\\.?|grs\\.?|gramos?|g|kg\\.?|kilos?|ml|mililitros?|cl|l|litros?|pizcas?|dientes?|latas?|vasos?|' +
    'chorritos?|chorros?|ramitas?|ramas?|hojas?|rebanadas?|lonchas?|piezas?|sobres?|paquetes?|botes?|tarros?|' +
    'cubos?|cubitos?|pastillas?|rodajas?|puñados?|copas?|onzas?|oz|lb|libras?|trozos?|tiras?|vainas?|cabezas?|' +
    'pellizcos?|hebras?|bolsas?|potes?|envases?|tabletas?|barras?|vasitos?|tacitas?|cucharones?';
const RX_UNIDAD = new RegExp(`^(${UNIDADES})$`, 'i');
const ENLACES = new Set(['de', 'del', 'con', 'y', 'e', 'o', 'u', 'a', 'al', 'en', 'para', 'la', 'el', 'las', 'los',
    'por', 'sin', 'tipo', 'estilo', 'muy', 'bien', 'más', 'mas', 'un', 'una', 'unos', 'unas', 'cada', 'aprox.', 'aprox']);
const RX_CANTIDAD = /^(\d+([.,/]\d+)?|½|¼|¾|⅓|⅔)/;
const RX_MAYUSCULA = /^[A-ZÁÉÍÓÚÑ¿¡]/;
// Palabras que suelen ir en Mayúscula pero completan el ingrediente anterior:
// "Jamón Serrano", "Queso Manchego", "Pimiento Rojo", "Aceite de oliva Virgen Extra".
const COMPLEMENTOS = new Set(['serrano', 'serranos', 'iberico', 'ibericos', 'york', 'manchego', 'curado', 'semicurado',
    'tierno', 'parmesano', 'reggiano', 'grana', 'padano', 'philadelphia', 'cheddar', 'emmental', 'gouda', 'edam',
    'virgen', 'extra', 'light', 'fresco', 'fresca', 'frescos', 'frescas', 'natural', 'rojo', 'roja', 'rojos', 'rojas',
    'verde', 'verdes', 'amarillo', 'amarilla', 'negro', 'negra', 'negros', 'negras', 'blanco', 'blanca', 'blancos',
    'blancas', 'dulce', 'picante', 'molido', 'molida', 'rallado', 'rallada', 'en', 'de', 'del', 'y']);

// Lo que se da por hecho que hay en casa (no cuenta como "falta" ni se propone comprar).
export const BASICOS_DESPENSA = new RegExp('^(sal|sal gruesa|sal fina|pimienta( negra| blanca)?|aceite|agua|vinagre|azucar|ajo|' +
    'especia|oregano|comino|pimenton|perejil|laurel|tomillo|romero|canela|nuez moscada|curry|colorante|azafran|' +
    'hielo|cubito de hielo|caldo|pastilla de caldo|edulcorante|levadura|bicarbonato|harina|maicena|mantequilla|' +
    'aceite de oliva|aceite de girasol|aceite vegetal|sal y pimienta|pimienta y sal)\\b');

function splitIngredientChunk(chunk) {
    const words = chunk.split(/\s+/).filter(Boolean);
    const items = [];
    let current = [];
    const isUpperWord = w => w.length > 1 && w === w.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(w);
    words.forEach((w, i) => {
        const prev = words[i - 1];
        const prevLower = prev ? prev.toLowerCase() : '';
        const startsQty = RX_CANTIDAD.test(w);
        const startsUpper = RX_MAYUSCULA.test(w) && !COMPLEMENTOS.has(normalizeText(w).replace(/[^a-z]/g, ''));
        const afterLink = ENLACES.has(prevLower) || /[(:]$/.test(prev || '');
        const prevIsQty = prev && (RX_CANTIDAD.test(prev) || /^(un|una|media|medio)$/i.test(prev));
        const insideCaps = isUpperWord(w) && prev && isUpperWord(prev.replace(/[®™]/g, ''));
        const prevIsUnit = prev && RX_UNIDAD.test(prev);
        // tras una unidad ("200 g") no se parte, salvo que venga otra cantidad ("175 g 1 limón")
        const split = current.length > 0 && !afterLink && !prevIsQty && !(prevIsUnit && !startsQty) && !insideCaps &&
            (startsQty || startsUpper) && !/^\(/.test(w);
        if (split) {
            items.push(current.join(' '));
            current = [];
        }
        current.push(w);
    });
    if (current.length) items.push(current.join(' '));
    return items;
}

export function parseIngredients(raw) {
    const seen = new Set();
    const result = [];
    String(raw ?? '')
        .replace(/[®™]/g, '')
        .replace(/^\s*ingredientes:?\s*/i, '')
        // palabras pegadas: "frutillas1/2", "lenguado1 puñado", "bananaTrozos", "azúcar1 cda."
        .replace(/([a-záéíóúüñ]\.?|\))(?=[A-ZÁÉÍÓÚÑ]|\d)/g, '$1\n')
        .split(/\n+|\s{3,}|\t+|\s+,\s+|;\s*|•/)
        .flatMap(splitIngredientChunk)
        .map(s => s.trim().replace(/^[-–*·)\],.:]+\s*/, '').replace(/[,.;]+$/, '').trim())
        .filter(s => s.length > 2 && !/^ingredientes:?$/i.test(s) && !ENLACES.has(s.toLowerCase()))
        .filter(s => ingredientParts(s).nombre.length > 1)   // fuera restos sueltos como "175 g"
        .forEach(s => {
            const key = normalizeText(s);
            if (seen.has(key)) return;
            seen.add(key);
            result.push(s);
        });
    return result;
}

// "200 gr. de pechuga de pollo (en filetes)" -> { cantidad: "200 gr.", nombre: "Pechuga de pollo" }
// "Sal y pimienta a gusto" -> { cantidad: "", nombre: "Sal y pimienta" }
export function ingredientParts(line) {
    let s = String(line || '').trim().replace(/\(s\)/gi, 's');  // "cebolla(s)" -> "cebollas"
    let cantidad = '';
    const qty = s.match(new RegExp(
        `^((?:\\d+(?:[.,/]\\d+)?(?:\\s*[½¼¾⅓⅔])?|[½¼¾⅓⅔])(?:\\s+(?:\\d+/\\d+|y\\s+medi[oa]|o\\s+\\d+))?|un[oa]?|medi[oa])\\s*` +
        `((?:${UNIDADES})\\b\\.?)?\\s*(?:de\\s+|del\\s+)?`, 'i'));
    if (qty && qty[0].trim()) {
        cantidad = (qty[1] + (qty[2] ? ' ' + qty[2] : '')).trim();
        s = s.slice(qty[0].length);
    }
    const nombre = s
        .replace(/\s*\([^)]*\)\s*/g, ' ')                     // "(250 g)", "(opcional)"
        .replace(/\s*,.*$/, '')                               // ", picada finamente"
        .replace(/\s+(a gusto|al gusto|c\/n|cantidad necesaria|opcional|para decorar|para servir)\b.*$/i, '')
        // preparación: "finamente picada", "pelada y cortada en dados", "sin piel"
        .replace(/\s+(y\s+)?(pelad|picad|cortad|troce|lavad|limpi|cocid|escurrid|desmenuzad|batid|derretid|tamizad|machacad|triturad|laminad|filetead|deshuesad|finamente|sin piel|sin hueso|en (tiras|dados|rodajas|trozos|tajadas|juliana|cubos|cubitos|láminas|laminas|polvo para))\S*.*$/i, '')
        .replace(/\s+(mediano|mediana|medianos|medianas|grande|grandes|pequeño|pequeña|pequeños|pequeñas|maduro|madura|maduros|maduras)\b/gi, '')
        .replace(/\s+v\.?\s*e\.?$/i, ' virgen extra')
        .replace(/(\s+(de|del|en|y|o|con|a|al|para))+$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    const bonito = nombre === nombre.toUpperCase() ? nombre.toLowerCase() : nombre; // "CALDO DE POLLO" -> "caldo de pollo"
    return { cantidad, nombre: bonito ? bonito.charAt(0).toUpperCase() + bonito.slice(1) : '' };
}

// Texto para la lista de la compra: "Pechuga de pollo (200 gr.)"
export function ingredientListName(line) {
    const { cantidad, nombre } = ingredientParts(line);
    if (!nombre) return String(line || '').trim();
    return cantidad && !/^(un[oa]?|1)$/i.test(cantidad) ? `${nombre} (${cantidad})` : nombre;
}

// Clave para comparar productos: sin cantidades, sin tildes y en singular.
// "2 Tomates", "tomate" y "Tomates (500 g)" -> "tomate"
function singularWord(w) {
    // palabras acabadas en l, n, r hacen el plural en -es: limones, tallarines, cereales, panes
    if (w.length > 4 && /[aeiou][lnr]es$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && /[aeiou]s$/.test(w)) return w.slice(0, -1);         // tomates -> tomate
    return w;
}

export function shoppingKey(text) {
    const { nombre } = ingredientParts(text);
    return normalizeText(nombre || text)
        .replace(/[^a-z0-9 ]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .map(singularWord)
        .join(' ');
}

export function isPantryBasic(line) {
    return BASICOS_DESPENSA.test(shoppingKey(line)) || /\b(a gusto|al gusto)\b/i.test(line);
}

// Ingredientes de varias recetas en una sola lista, juntando los repetidos:
// [{ key, nombre, lineas: ["2 cebollas", "1 cebolla"], recetas: ["Pisto", "Lentejas"], basico }]
export function mergeIngredients(recipes) {
    const map = new Map();
    recipes.forEach(r => parseIngredients(r.ingredients).forEach(line => {
        const key = shoppingKey(line);
        if (!key) return;
        if (!map.has(key)) map.set(key, { key, nombre: ingredientParts(line).nombre || line, lineas: [], recetas: [], basico: isPantryBasic(line) });
        const item = map.get(key);
        item.lineas.push(line);
        if (!item.recetas.includes(r.title)) item.recetas.push(r.title);
    }));
    return [...map.values()];
}

// Pasos: "1 Lavamos... 2 Cortamos..." o párrafos -> ["Lavamos...", "Cortamos..."]
export function parseSteps(steps, title) {
    let s = String(steps ?? '').trim();
    if (title && s.toLowerCase().startsWith(String(title).toLowerCase())) s = s.slice(title.length).trim();
    s = s.replace(/^preparaci[oó]n:?\s*/i, '');
    if (!s) return [];
    let parts = s.split(/\n+/);
    if (parts.length === 1) parts = s.split(/\s(?=\d{1,2}[.)-]?\s+[A-ZÁÉÍÓÚÑ¡¿])/);
    return parts
        .map(p => p.trim().replace(/^(paso\s*)?\d{1,2}\s*[.):-]?\s+(?=\S)/i, '').trim())
        .filter(Boolean);
}
