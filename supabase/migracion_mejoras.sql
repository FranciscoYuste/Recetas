-- Migración opcional para las mejoras de uso (rama feature/mejoras-uso).
-- Ejecutar UNA vez en Supabase → SQL Editor. Es segura de repetir.
-- La app funciona sin ella, pero con ella se activan:
--   * Lista de la compra: tachar productos (se sincroniza entre móviles) y
--     añadir texto libre / ingredientes sin crear productos en el catálogo.
--   * Menús guardados: fecha de guardado.
--   * Recetas: filtro "Mis recetas" (las que añadís vosotros).

alter table lista_compra add column if not exists texto text;
alter table lista_compra add column if not exists comprado boolean not null default false;
alter table lista_compra alter column id_producto drop not null;

alter table semanas_guardadas add column if not exists creado_en timestamptz not null default now();

alter table recetas add column if not exists propia boolean not null default false;

-- Opcional: marcar como "propias" las recetas que ya habéis añadido a mano.
-- Las importadas son las que tienen URL; ajustad el filtro si no os encaja.
-- update recetas set propia = true where url is null or url = '';
