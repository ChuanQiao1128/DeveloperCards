-- Run in exact PRODUCTION DB for EACH isolated login/owner before enabling it.
-- $1=exact newly created role, bound parameter. No production data is selected.
select n.nspname,c.relname
from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast'
  and c.relkind in ('r','p','v','m','f')
  and has_table_privilege($1,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
order by n.nspname,c.relname limit 101;

select n.nspname,p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where p.prosecdef and n.nspname not in ('pg_catalog','information_schema')
  and has_function_privilege($1,p.oid,'EXECUTE')
order by n.nspname,p.proname,p.oid limit 101;

select parent.rolname
from pg_catalog.pg_auth_members m
join pg_catalog.pg_roles child on child.oid=m.member
join pg_catalog.pg_roles parent on parent.oid=m.roleid
where child.rolname=$1 order by parent.rolname limit 101;
