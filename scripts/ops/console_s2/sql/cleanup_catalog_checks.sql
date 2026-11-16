-- Read-only inputs to root's fixed drop operation. $1=exact owned new database;
-- $2=text[] exact three role names. Require full live ownership registry match
-- AND exact names before root invokes terminate/drop. Never use prefix-only proof.
select oid,datname,pg_catalog.pg_get_userbyid(datdba) as owner,datallowconn
from pg_catalog.pg_database where datname=$1;

select rolname from pg_catalog.pg_roles where rolname=any($2::text[]) order by rolname;

-- Expose cross-database shared dependencies so unexpected privilege/ownership
-- causes cleanup to stop instead of issuing DROP OWNED/CASCADE in production.
select r.rolname,d.datname,s.deptype,count(*) as dependency_count
from pg_catalog.pg_shdepend s
join pg_catalog.pg_roles r on r.oid=s.refobjid
left join pg_catalog.pg_database d on d.oid=s.dbid
where s.refclassid='pg_catalog.pg_authid'::regclass and r.rolname=any($2::text[])
group by r.rolname,d.datname,s.deptype order by r.rolname,d.datname,s.deptype limit 101;

-- Root must separately require empty post-drop pg_database/pg_roles readbacks.
-- Fixed owner helper may use pg_terminate_backend for the exact new DB only,
-- DROP DATABASE with psycopg.sql.Identifier, then DROP ROLE for exact new roles.
-- No DROP OWNED, REASSIGN OWNED, CASCADE or production ACL mutation is permitted.
