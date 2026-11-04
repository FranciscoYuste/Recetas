// Edge Function «importar-receta»: recibe { url } y devuelve
// { title, ingredients: string[], steps: string[], image, url } leyendo la página.
//
// Casi todas las webs de recetas publican la receta en formato estándar (schema.org
// "Recipe" en un bloque JSON-LD) para que Google la entienda; se lee de ahí. Si no lo
// tienen, se prueba con microdatos (itemprop="recipeIngredient"...) y el <title>.
//
// Solo atiende a usuarios con sesión que estén en usuarios_permitidos (seguridad_rls.sql),
// para que no sirva de "proxy" abierto a cualquiera.
//
// Desplegar: Supabase → Edge Functions → Deploy a new function → Via Editor,
// nombre "importar-receta", pegar este archivo y Deploy. (Escrito en JavaScript
// compatible con TypeScript para poder probar el analizador también en Node.)

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const MAX_BYTES = 4_000_000;

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' }
    });
}

// ---------------------------------------------------------------- texto

const ENTIDADES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ordm: 'º', ordf: 'ª', deg: '°',
    aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', uuml: 'ü', ntilde: 'ñ',
    Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Uuml: 'Ü', Ntilde: 'Ñ',
    iexcl: '¡', iquest: '¿', frac12: '½', frac14: '¼', frac34: '¾', hellip: '…', ndash: '–',
    mdash: '—', laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', middot: '·',
    ccedil: 'ç', Ccedil: 'Ç', agrave: 'à', egrave: 'è', ograve: 'ò', iuml: 'ï', reg: '®', trade: '™'
};

function decodificar(texto) {
    return String(texto ?? '')
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
        .replace(/&([a-z]+);/gi, (m, n) => ENTIDADES[n] ?? m);
}

function limpiar(texto) {
    return decodificar(
        decodificar(String(texto ?? ''))            // algunas webs codifican dos veces
            .replace(/<\s*br\s*\/?>/gi, '\n')
            .replace(/<\/(p|li|div|h\d)>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
    )
        .replace(/[ \t ]+/g, ' ')
        .replace(/\s*\n\s*/g, '\n')
        .trim();
}

function lista(valor) {
    if (valor == null) return [];
    return Array.isArray(valor) ? valor : [valor];
}

// ---------------------------------------------------------------- JSON-LD

function esReceta(nodo) {
    return nodo && typeof nodo === 'object' &&
        lista(nodo['@type']).some(t => String(t).toLowerCase() === 'recipe');
}

// Todas las "Recipe" del bloque (algunas webs ponen una solo con las valoraciones y
// otra con la receta de verdad).
function buscarRecetas(nodo, encontradas = [], profundidad = 0) {
    if (!nodo || typeof nodo !== 'object' || profundidad > 6) return encontradas;
    if (Array.isArray(nodo)) {
        nodo.forEach(n => buscarRecetas(n, encontradas, profundidad + 1));
        return encontradas;
    }
    if (esReceta(nodo)) encontradas.push(nodo);
    for (const clave of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) {
        buscarRecetas(nodo[clave], encontradas, profundidad + 1);
    }
    return encontradas;
}

function pasosDesde(instrucciones) {
    const pasos = [];
    const visitar = (x) => {
        if (x == null) return;
        if (typeof x === 'string') {
            limpiar(x).split(/\n+/).forEach(p => p.trim() && pasos.push(p.trim()));
            return;
        }
        if (Array.isArray(x)) return x.forEach(visitar);
        if (typeof x === 'object') {
            if (x.itemListElement) {                       // HowToSection
                if (x.name) pasos.push(limpiar(x.name) + ':');
                return visitar(x.itemListElement);
            }
            visitar(x.text ?? x.name ?? x.description);    // HowToStep
        }
    };
    visitar(instrucciones);
    return pasos;
}

function imagenDesde(img) {
    const primera = lista(img)[0];
    if (!primera) return null;
    return typeof primera === 'string' ? primera : (primera.url || primera.contentUrl || null);
}

function desdeJsonLd(html) {
    const recetas = [];
    const bloques = html.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi);
    for (const [, contenido] of bloques) {
        let datos;
        try {
            datos = JSON.parse(contenido.trim());
        } catch {
            try { datos = JSON.parse(contenido.replace(/[\u0000-\u001f]+/g, ' ').trim()); } catch { continue; }
        }
        buscarRecetas(datos, recetas);
    }
    if (recetas.length === 0) return null;
    // De cada campo, el primero que lo tenga.
    const campo = (...nombres) => {
        for (const r of recetas) for (const n of nombres) if (r[n] && lista(r[n]).length) return r[n];
        return null;
    };
    return {
        title: limpiar(campo('name', 'headline') || ''),
        ingredients: lista(campo('recipeIngredient', 'ingredients')).map(limpiar).filter(Boolean),
        steps: pasosDesde(campo('recipeInstructions')),
        image: imagenDesde(campo('image'))
    };
}

// ---------------------------------------------------------------- microdatos / HTML

function textosItemprop(html, nombres) {
    const rx = new RegExp(`<(\\w+)[^>]*itemprop=["'](?:${nombres})["'][^>]*>([\\s\\S]*?)</\\1>`, 'gi');
    return [...html.matchAll(rx)].map(m => limpiar(m[2])).filter(Boolean);
}

function meta(html, propiedad) {
    const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${propiedad}["'][^>]*content=["']([^"']*)["']`, 'i'))
        || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${propiedad}["']`, 'i'));
    return m ? limpiar(m[1]) : '';
}

function desdeHtml(html) {
    const titulo = textosItemprop(html, 'name')[0] || meta(html, 'og:title') ||
        limpiar((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
    const pasosBloque = textosItemprop(html, 'recipeInstructions');
    return {
        title: titulo,
        ingredients: textosItemprop(html, 'recipeIngredient|ingredients'),
        steps: pasosBloque.flatMap(p => p.split(/\n+/)).map(p => p.trim()).filter(Boolean),
        image: meta(html, 'og:image') || null
    };
}

function extraerReceta(html) {
    const ld = desdeJsonLd(html);
    const alt = desdeHtml(html);
    const receta = {
        title: (ld && ld.title) || alt.title,
        ingredients: ld && ld.ingredients.length ? ld.ingredients : alt.ingredients,
        steps: ld && ld.steps.length ? ld.steps : alt.steps,
        image: (ld && ld.image) || alt.image
    };
    // El <title> de la página trae el nombre de la web: "Pollo al curry - Fácil | MiWeb"
    if (!(ld && ld.title)) {
        let t = receta.title;
        while (/\s[|–—-]\s/.test(t)) {
            const corto = t.replace(/\s+[|–—-]\s+(?!.*\s[|–—-]\s).*$/, '');
            if (corto.length < 8) break;
            t = corto;
        }
        receta.title = t;
    }
    receta.title = receta.title
        .replace(/^receta (de|del)\s+/i, '')
        .replace(/^./, c => c.toUpperCase())
        .trim();
    // Quitar duplicados consecutivos y pasos vacíos
    receta.steps = receta.steps.filter((p, i, a) => p && p !== a[i - 1]);
    receta.ingredients = [...new Set(receta.ingredients)];
    return receta;
}

// ---------------------------------------------------------------- servidor

function urlPermitida(texto) {
    let u;
    try { u = new URL(texto); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h === '0.0.0.0' ||
        /^(127|10|0)\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.includes(':') || h.startsWith('[')) return null;
    return u;
}

async function usuarioPermitido(req) {
    const auth = req.headers.get('authorization');
    const apikey = req.headers.get('apikey') || Deno.env.get('SUPABASE_ANON_KEY');
    if (!auth || !apikey) return false;
    const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/es_usuario_permitido`, {
        method: 'POST',
        headers: { apikey, Authorization: auth, 'Content-Type': 'application/json' },
        body: '{}'
    });
    return r.ok && (await r.json()) === true;
}

async function descargar(url) {
    const r = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'es-ES,es;q=0.9'
        }
    });
    if (!r.ok) throw new Error(`La web respondió con ${r.status}`);
    const bytes = new Uint8Array(await r.arrayBuffer()).slice(0, MAX_BYTES);
    const charset = ((r.headers.get('content-type') || '').match(/charset=([\w-]+)/i) || [])[1] || 'utf-8';
    let html = new TextDecoder(charset.toLowerCase()).decode(bytes);
    const declarado = (html.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1];
    if (declarado && declarado.toLowerCase() !== charset.toLowerCase()) {
        try { html = new TextDecoder(declarado.toLowerCase()).decode(bytes); } catch { /* charset raro: se queda */ }
    }
    return html;
}

async function atender(req) {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
    try {
        if (!(await usuarioPermitido(req))) return json({ error: 'No autorizado' }, 401);
        const { url } = await req.json().catch(() => ({}));
        const destino = urlPermitida(String(url || '').trim());
        if (!destino) return json({ error: 'La dirección no es válida' }, 400);
        const receta = extraerReceta(await descargar(destino.toString()));
        if (!receta.ingredients.length && !receta.steps.length) {
            return json({ error: 'No he encontrado una receta en esa página', title: receta.title }, 422);
        }
        return json({ ...receta, url: destino.toString() });
    } catch (e) {
        const msg = e && e.name === 'TimeoutError' ? 'La web tarda demasiado en responder' : String(e && e.message || e);
        return json({ error: msg }, 502);
    }
}

if (typeof Deno !== 'undefined') Deno.serve(atender);
