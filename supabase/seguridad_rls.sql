-- Seguridad: activa Row-Level Security (RLS) en todas las tablas y deja acceso solo a
-- los usuarios de casa que hayan iniciado sesión. Quita el aviso crítico
-- "rls_disabled_in_public" de Supabase.
--
-- ANTES de ejecutarlo:
--   1. Authentication → Users → "Add user" → "Create new user": crea vuestro usuario
--      (email + contraseña, marcando "Auto Confirm User"). Uno compartido o uno por persona.
--   2. Authentication → Sign In / Providers → desactiva "Allow new users to sign up",
--      para que nadie pueda crearse una cuenta con la clave pública.
--   3. Publica la versión de la app con login y comprueba que podéis entrar.
--   4. Pon vuestros emails abajo (paso B) y ejecuta TODO este archivo en SQL Editor.
--
-- Es seguro repetirlo. Para añadir otra persona más adelante: créala en Authentication
-- y vuelve a ejecutar solo el paso B con su email.

-- A. Lista de usuarios con acceso. Sin políticas: no se puede leer desde la app.
create table if not exists public.usuarios_permitidos (
    user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.usuarios_permitidos enable row level security;

-- B. Vuestros emails (los mismos con los que creasteis los usuarios en Authentication).
insert into public.usuarios_permitidos (user_id)
select id from auth.users
where lower(email) in ('tu@email.com' /* , 'otro@email.com' */)  -- ← CAMBIAR, en minúsculas
on conflict do nothing;

-- C. ¿El usuario de la petición está en la lista? (security definer para poder leerla).
create or replace function public.es_usuario_permitido()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (select 1 from public.usuarios_permitidos where user_id = auth.uid());
$$;
revoke execute on function public.es_usuario_permitido() from public, anon;
grant execute on function public.es_usuario_permitido() to authenticated;

-- D. RLS + una política "todo permitido a los de la lista" en cada tabla de public.
--    Sin sesión (rol anon) no hay ninguna política, así que no se puede leer ni escribir nada.
do $$
declare t text;
begin
    for t in
        select tablename from pg_tables
        where schemaname = 'public' and tablename <> 'usuarios_permitidos'
    loop
        execute format('alter table public.%I enable row level security', t);
        execute format('drop policy if exists acceso_publico on public.%I', t);
        execute format('drop policy if exists acceso_casa on public.%I', t);
        execute format(
            'create policy acceso_casa on public.%I for all to authenticated '
            'using ((select public.es_usuario_permitido())) '
            'with check ((select public.es_usuario_permitido()))', t);
    end loop;
end $$;

-- Comprobación: todas deberían salir con rls = true.
select tablename, rowsecurity as rls
from pg_tables
where schemaname = 'public'
order by tablename;

-- Si algo va mal y necesitáis volver a abrirlo todo temporalmente:
-- do $$ declare t text; begin
--   for t in select tablename from pg_tables where schemaname = 'public' loop
--     execute format('alter table public.%I disable row level security', t);
--   end loop; end $$;
