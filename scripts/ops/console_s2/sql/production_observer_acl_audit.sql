-- Read-only catalog audit in the EXACT production DB, after creating only the
-- dedicated noinherit observer login. $1 = exact observer role (bound parameter).
-- The root helper must check current_database/server identity before these fixed
-- statements and reject >100 findings. No grants/revokes are authorized here.
select rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolreplication,
       rolbypassrls, rolconnlimit
from pg_catalog.pg_roles where rolname = $1;

select parent.rolname as membership
from pg_catalog.pg_auth_members m
join pg_catalog.pg_roles child on child.oid=m.member
join pg_catalog.pg_roles parent on parent.oid=m.roleid
where child.rolname=$1 order by parent.rolname limit 101;

-- Any mutable capability, or SELECT outside the three observer tables, blocks.
select n.nspname, c.relname,
       has_table_privilege($1,c.oid,'INSERT') as can_insert,
       has_table_privilege($1,c.oid,'UPDATE') as can_update,
       has_table_privilege($1,c.oid,'DELETE') as can_delete,
       has_table_privilege($1,c.oid,'TRUNCATE') as can_truncate,
       has_table_privilege($1,c.oid,'TRIGGER') as can_trigger,
       has_table_privilege($1,c.oid,'SELECT') as can_select
from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast'
  and c.relkind in ('r','p','v','m','f')
  and (has_table_privilege($1,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
       or (has_table_privilege($1,c.oid,'SELECT') and not
          (n.nspname='public' and c.relname in
             ('deck_publishes','publish_dispatch','publish_manifest_delivery'))))
order by n.nspname,c.relname limit 101;

-- SECURITY DEFINER can bypass table ACLs; PUBLIC/default grants are included by
-- has_function_privilege. Names/signatures only; never invoke or return bodies.
select n.nspname,p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
       pg_catalog.pg_get_userbyid(p.proowner) as owner,p.proconfig
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where p.prosecdef and n.nspname not in ('pg_catalog','information_schema')
  and has_function_privilege($1,p.oid,'EXECUTE')
order by n.nspname,p.proname,p.oid limit 101;

select nspname from pg_catalog.pg_namespace
where nspname not in ('pg_catalog','information_schema') and nspname !~ '^pg_toast'
  and has_schema_privilege($1,oid,'CREATE') order by nspname limit 101;

select d.datname,has_database_privilege($1,d.oid,'CONNECT') as can_connect,
       has_database_privilege($1,d.oid,'CREATE') as can_create,
       has_database_privilege($1,d.oid,'TEMP') as can_temp
from pg_catalog.pg_database d where d.datname=current_database();

-- Inventory default privileges (including PUBLIC grantee=0); root reviews
-- future-access risk without automatically changing existing production ACLs.
select pg_catalog.pg_get_userbyid(a.defaclrole) as owner,
       coalesce(n.nspname,'*') as schema,a.defaclobjtype,x.grantee,x.privilege_type
from pg_catalog.pg_default_acl a
left join pg_catalog.pg_namespace n on n.oid=a.defaclnamespace
cross join lateral pg_catalog.aclexplode(a.defaclacl) x
where x.grantee=0 or x.grantee=(select oid from pg_catalog.pg_roles where rolname=$1)
order by owner,schema,a.defaclobjtype,x.privilege_type limit 101;
