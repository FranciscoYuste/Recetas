// Constantes de la app. La clave es la "publishable" de Supabase: es pública por diseño,
// la seguridad la pone RLS (supabase/seguridad_rls.sql).

export const SUPABASE_URL = 'https://vvhkuuuwpfbyqpthetos.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_KKUvsjeLk_gGNfOpdcg9aQ_4R0NTNyV';

export const DIAS = [
    { id: 1, nombre: 'Lunes', corto: 'Lun' },
    { id: 2, nombre: 'Martes', corto: 'Mar' },
    { id: 3, nombre: 'Miércoles', corto: 'Mié' },
    { id: 4, nombre: 'Jueves', corto: 'Jue' },
    { id: 5, nombre: 'Viernes', corto: 'Vie' },
    { id: 6, nombre: 'Sábado', corto: 'Sáb' },
    { id: 7, nombre: 'Domingo', corto: 'Dom' }
];
export const TIPOS_COMIDA = ['Comida', 'Cena'];
export const VIEWS = ['semana', 'recetas', 'compra'];
export const RECIPES_PAGE_SIZE = 60;

// localStorage
export const SESSION_KEY = 'recetario.sesion';
export const THERMOMIX_KEY = 'recetario.thermomix';

// Columnas/tablas que la app necesita (migraciones en supabase/). Si falta alguna se
// avisa de qué archivo ejecutar.
export const ESQUEMA_REQUERIDO = [
    { tabla: 'lista_compra', columnas: 'texto,comprado', sql: 'migracion_mejoras.sql' },
    { tabla: 'semanas_guardadas', columnas: 'creado_en', sql: 'migracion_mejoras.sql' },
    { tabla: 'recetas', columnas: 'propia,tipo,oculta,notas', sql: 'mejoras_datos.sql' },
    { tabla: 'compra_habitual', columnas: 'clave', sql: 'compra_habitual.sql' }
];
