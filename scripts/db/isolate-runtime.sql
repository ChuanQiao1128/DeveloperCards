-- EXPLICIT OWNER CUTOVER ONLY. Not a numbered migration, never run by normal deployment.
-- Provision three distinct roles/passwords out-of-band first; never put passwords in this file or Terraform.
-- Execute as the local/RDS owner after maintenance version and alias checks in the runbook.
begin;
do $preflight$
begin
 if not exists(select 1 from pg_roles where rolname='developercards_schema' and not rolcanlogin and not rolsuper and not rolcreaterole and not rolcreatedb and not rolreplication and not rolbypassrls)
 or not exists(select 1 from pg_roles where rolname='developercards_migrator' and rolcanlogin and not rolsuper and not rolcreaterole and not rolcreatedb and not rolreplication and not rolbypassrls)
 or not exists(select 1 from pg_roles where rolname='developercards_app' and rolcanlogin and not rolsuper and not rolcreaterole and not rolcreatedb and not rolreplication and not rolbypassrls)
 then raise exception 'Dedicated non-admin schema, maintenance and runtime roles required'; end if;
 if to_regclass('public.account_deletions') is null or to_regclass('public.publish_manifest_delivery') is null then
   raise exception 'Apply migrations 052 and 053 before cutover'; end if;
end $preflight$;
-- RDS master is not a PostgreSQL superuser; explicit membership permits ownership transfer.
grant developercards_schema to current_user;
revoke developercards_schema, developercards_migrator from developercards_app;
grant developercards_schema to developercards_migrator;
alter role developercards_app noinherit;
alter role developercards_migrator noinherit;
-- The runtime must not retain ownership through a legacy database/schema owner or role membership.
do $ownership$
declare r record;
begin
 if exists(select 1 from pg_auth_members where member=(select oid from pg_roles where rolname='developercards_app')) then
   raise exception 'Remove every runtime role membership before cutover'; end if;
 execute format('alter database %I owner to developercards_schema',current_database());
 execute format('revoke create, temporary on database %I from public, developercards_app',current_database());
 execute format('grant connect on database %I to developercards_app, developercards_migrator',current_database());
 for r in select tablename from pg_tables where schemaname='public' loop
   execute format('alter table public.%I owner to developercards_schema',r.tablename);
 end loop;
 for r in select sequencename from pg_sequences where schemaname='public' loop
   execute format('alter sequence public.%I owner to developercards_schema',r.sequencename);
 end loop;
 for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') loop
   execute format('alter function %s owner to developercards_schema',r.signature);
 end loop;
end $ownership$;
alter schema public owner to developercards_schema;
revoke all on schema public from public, developercards_app;
grant usage on schema public to developercards_app;
revoke all on all tables in schema public from public, developercards_app;
revoke all on all sequences in schema public from public, developercards_app;
revoke execute on all functions in schema public from public, developercards_app;
-- Explicit business DML inventory; new tables remain inaccessible until deliberately added.
grant select, insert, update, delete on
 decks, cards, admin_deck_permissions, users, user_entitlements, user_subscriptions,
 user_progress_events, user_progress, analytics_daily, analytics_deck_daily, deck_publishes,
 rc_webhook_events, user_premium_state, user_draw_owned, user_draw_meta, user_wallet, user_deck_wallet,
 webhook_subscriptions, webhook_deliveries, automation_baselines, automation_events, automation_ledger_meta,
 ai_drafts, automation_runners, source_watch_targets, source_watch_events, authoring_queue_items,
 source_watch_feed_items, automation_runs, automation_eval_gates, automation_draft_decisions,
 automation_qa_spend, automation_draft_findings, automation_publishes, automation_notifications,
 ai_qa_runs, ai_qa_items, ai_qa_findings, card_reports, anon_funnel_events, revenuecat_deletions,
 publish_dispatch, publish_manifest_delivery
 to developercards_app;
-- Append-only evidence and indefinite deletion fence: no UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER.
grant select, insert on admin_audit, ai_review_events, automation_decision_events,
 content_release_actions, content_review_receipts, content_review_revocations, account_deletions to developercards_app;
grant select on schema_migrations to developercards_app;
grant execute on function content_editing_snapshot(bigint) to developercards_app;
-- Existing optional search/embedding endpoints retain their extension operations.
do $optional$
declare r record;
begin
 if to_regclass('public.card_embeddings') is not null then
   grant select,insert,update,delete on card_embeddings to developercards_app;
 end if;
 for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   join pg_depend d on d.objid=p.oid and d.deptype='e' join pg_extension e on e.oid=d.refobjid
   where n.nspname='public' and e.extname in ('pg_trgm','vector') and not p.prosecdef
 loop execute format('grant execute on function %s to developercards_app',r.signature); end loop;
end $optional$;
-- USAGE is sufficient for nextval/currval, and does not permit setval.
grant usage on all sequences in schema public to developercards_app;
-- Existing explicit/default grants by earlier owners must not return blanket privileges on future objects.
alter default privileges for role developercards_schema in schema public revoke all on tables from developercards_app;
alter default privileges for role developercards_schema in schema public revoke execute on functions from public;
commit;
