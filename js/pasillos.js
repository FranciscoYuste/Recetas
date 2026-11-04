// Pasillos del súper para agrupar la lista de la compra. Sin DOM: se prueba en Node.
// Se comprueban de arriba abajo, lo más específico primero ("tomate frito" es
// despensa, "tomate" es verdura); el orden de la lista final es el de recorrido.

import { normalizeText } from './util.js';

const SECCIONES = [
    { titulo: '❄️ Congelados', palabras: ['congelado', 'congelada', 'helado', 'hielo'] },
    { titulo: '🥫 Despensa', palabras: ['lata', 'conserva', 'bote', 'tomate frito', 'tomate triturado', 'tomate natural triturado',
        'pan rallado', 'caldo', 'leche condensada', 'leche evaporada', 'chocolate', 'cacao', 'atun en aceite', 'atun claro'] },
    { titulo: '🧽 Limpieza y hogar', palabras: ['detergente', 'lavavajillas', 'suavizante', 'lejia', 'friegasuelos', 'limpiador',
        'papel de cocina', 'servilleta', 'bolsas de basura', 'bolsa de basura', 'estropajo', 'film', 'papel de aluminio',
        'papel aluminio', 'papel de horno', 'pila', 'bayeta', 'ambientador', 'quitagrasas'] },
    { titulo: '🧴 Higiene', palabras: ['champu', 'gel', 'desodorante', 'pasta de dientes', 'dentifrico', 'cepillo', 'compresa',
        'tampon', 'crema hidratante', 'crema solar', 'protector solar', 'maquinilla', 'cuchilla', 'colonia', 'jabon',
        'papel higienico', 'panal', 'toallita', 'bastoncillo', 'algodon', 'acondicionador', 'enjuague'] },
    { titulo: '🧃 Bebidas', palabras: ['agua', 'zumo', 'refresco', 'cerveza', 'vino', 'cava', 'tonica', 'coca cola', 'cola',
        'gaseosa', 'sidra', 'bebida', 'cafe', 'te', 'infusion', 'manzanilla', 'poleo'] },
    { titulo: '🥛 Lácteos y huevos', palabras: ['leche', 'yogur', 'yogurt', 'queso', 'mantequilla', 'nata', 'crema de leche', 'huevo',
        'kefir', 'requeson', 'mozzarella', 'parmesano', 'natilla', 'margarina', 'cuajada', 'bebida de avena', 'flan'] },
    { titulo: '🥩 Carne y charcutería', palabras: ['pollo', 'pechuga', 'muslo', 'contramuslo', 'alita', 'ternera', 'cerdo', 'carne',
        'lomo', 'solomillo', 'costilla', 'cordero', 'conejo', 'pavo', 'hamburguesa', 'salchicha', 'chorizo', 'jamon',
        'bacon', 'beicon', 'panceta', 'morcilla', 'fuet', 'salami', 'salchichon', 'pate', 'albondiga', 'filete', 'chuleta',
        'embutido', 'pato', 'mortadela', 'lacon', 'picada', 'carrillada', 'secreto', 'longaniza', 'butifarra', 'sobrasada'] },
    { titulo: '🐟 Pescado y marisco', palabras: ['pescado', 'merluza', 'salmon', 'atun', 'bacalao', 'gamba', 'langostino', 'mejillon',
        'almeja', 'calamar', 'sepia', 'pulpo', 'lubina', 'dorada', 'sardina', 'boqueron', 'rape', 'trucha', 'emperador',
        'marisco', 'surimi', 'anchoa', 'bonito', 'caballa', 'lenguado', 'pescadilla', 'chipiron', 'berberecho', 'navaja'] },
    { titulo: '🥬 Fruta y verdura', palabras: ['tomate', 'lechuga', 'cebolla', 'cebolleta', 'ajo', 'patata', 'papa', 'zanahoria', 'pimiento',
        'calabacin', 'berenjena', 'pepino', 'puerro', 'apio', 'espinaca', 'acelga', 'brocoli', 'coliflor', 'col', 'repollo',
        'champinon', 'seta', 'judia verde', 'judias verdes', 'alcachofa', 'esparrago', 'calabaza', 'aguacate', 'limon',
        'lima', 'naranja', 'mandarina', 'manzana', 'pera', 'platano', 'banana', 'fresa', 'uva', 'melon', 'sandia', 'pina',
        'mango', 'kiwi', 'melocoton', 'nectarina', 'cereza', 'frutos rojos', 'arandano', 'frambuesa', 'perejil', 'cilantro',
        'albahaca', 'hierbabuena', 'menta', 'jengibre', 'rucula', 'canonigo', 'canonigos', 'chalota', 'rabano',
        'remolacha', 'boniato', 'batata', 'fruta', 'verdura', 'lombarda', 'endivia', 'escarola', 'nabo', 'guindilla',
        'ensalada', 'brotes', 'granada', 'higo', 'ciruela', 'coco'] },
    { titulo: '🥖 Panadería', palabras: ['pan', 'barra', 'baguette', 'chapata', 'bolleria', 'croissant', 'cruasan', 'magdalena',
        'pan de molde', 'tortilla de trigo', 'tortillas de trigo', 'picos', 'regañas', 'bizcocho'] },
    { titulo: '🥫 Despensa', palabras: ['arroz', 'pasta', 'macarron', 'espagueti', 'spaghetti', 'fideo', 'tallarin', 'lasaña',
        'harina', 'azucar', 'sal', 'aceite', 'vinagre', 'lenteja', 'garbanzo', 'alubia', 'judia', 'legumbre', 'especia',
        'pimienta', 'pimenton', 'oregano', 'comino', 'canela', 'curry', 'laurel', 'tomillo', 'romero', 'levadura',
        'galleta', 'cereal', 'avena', 'miel', 'mermelada', 'frutos secos', 'almendra', 'nuez', 'nueces', 'cacahuete',
        'pasa', 'aceituna', 'mayonesa', 'ketchup', 'mostaza', 'salsa', 'maiz', 'quinoa', 'cuscus', 'tomate concentrado',
        'colorante', 'azafran', 'nuez moscada', 'maicena', 'pinon', 'sesamo', 'cacao', 'gelatina', 'legumbres',
        'soja', 'tahini', 'caldo', 'pastilla', 'vainilla', 'polvo de hornear', 'bicarbonato'] }
];
export const SECCION_OTROS = '📦 Otros';

const SECCIONES_RX = SECCIONES.map(s => ({
    titulo: s.titulo,
    // palabra entera, admitiendo plural: "tomate" casa con "2 tomates" pero no "sal" con "salsa"
    rx: new RegExp('(^|[^a-z])(' + s.palabras.map(p => normalizeText(p).replace(/\s+/g, '\\s+')).join('|') + ')(e?s)?([^a-z]|$)')
}));

export function sectionOf(nombre) {
    const text = normalizeText(nombre);
    const hit = SECCIONES_RX.find(s => s.rx.test(text));
    return hit ? hit.titulo : SECCION_OTROS;
}

// Agrupa por pasillo respetando el orden de SECCIONES (las dos «Despensa» se juntan en una).
export function groupBySection(items) {
    const order = [...new Set([...SECCIONES.map(s => s.titulo), SECCION_OTROS])];
    const map = new Map(order.map(t => [t, []]));
    items.forEach(item => map.get(sectionOf(item.nombre)).push(item));
    return [...map].filter(([, list]) => list.length).map(([titulo, list]) => ({ titulo, items: list }));
}
