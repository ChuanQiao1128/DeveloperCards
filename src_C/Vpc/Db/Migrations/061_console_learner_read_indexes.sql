-- The console directory's C-ordered cursor must use the same collation in its index.
create index if not exists idx_users_sub_c on public.users (user_sub COLLATE "C");

-- A pre-existing name alone does not prove that the cursor has a usable index.
do $$
begin
  if not exists (
    select 1 from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_am a on a.oid = c.relam
    where i.indexrelid = to_regclass('public.idx_users_sub_c')
      and i.indrelid = 'public.users'::regclass
      and a.amname = 'btree'
      and i.indisvalid and i.indisready
      and not i.indisunique
      and i.indnkeyatts = 1 and i.indnatts = 1
      and i.indexprs is null and i.indpred is null
      and i.indcollation[0] = 'pg_catalog."C"'::regcollation
      and i.indkey[0] = (select attnum from pg_attribute
        where attrelid = 'public.users'::regclass and attname = 'user_sub' and not attisdropped)
  ) then
    raise exception 'CONSOLE_LEARNER_INDEX_DEFINITION_MISMATCH';
  end if;
end $$;
