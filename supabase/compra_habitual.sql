-- Lista de la compra: «⚡ Lo de siempre».
-- Ejecutar UNA vez en Supabase → SQL Editor (es seguro repetirlo).
--
-- Guarda lo que añadís a mano a la lista (cuántas veces y cuándo) para ofrecerlo con
-- un toque, y los productos marcados como fijos (📌) para añadirlos todos de golpe.
-- La app funciona sin esta tabla; simplemente no muestra «Lo de siempre».

create table if not exists public.compra_habitual (
    clave      text primary key,          -- nombre normalizado: "tomate" para "2 Tomates"
    nombre     text not null,             -- cómo se muestra: "Tomates"
    veces      integer not null default 0,
    fijo       boolean not null default false,
    ultima_vez timestamptz
);

-- Mismo acceso que el resto de tablas (ver seguridad_rls.sql).
alter table public.compra_habitual enable row level security;
drop policy if exists acceso_casa on public.compra_habitual;
create policy acceso_casa on public.compra_habitual for all to authenticated
    using ((select public.es_usuario_permitido()))
    with check ((select public.es_usuario_permitido()));
grant select, insert, update, delete on public.compra_habitual to authenticated;
