using Npgsql;
using static RecallSmith.Lambda.Vpc.Db.DbUtil;

namespace RecallSmith.Lambda.Vpc.Db;

internal static class MigrationDiagnostics
{
  // Fixed catalog-only inventory: never execute caller SQL or read application rows.
  internal static async Task<object> ReadAsync(NpgsqlConnection conn)
  {
    var session = await QueryAsync(conn, null, """
      select current_user::text as "currentUser", session_user::text as "sessionUser",
        current_setting('default_transaction_isolation') as "defaultTransactionIsolation",
        pg_get_userbyid(n.nspowner) as "publicSchemaOwner",
        has_schema_privilege(current_user,n.oid,'CREATE') as "canCreateInPublic",
        exists(select 1 from pg_extension where extname='vector') as "vectorExtensionInstalled",
        (select extversion from pg_extension where extname='vector') as "vectorExtensionVersion",
        to_regclass('public.card_embeddings') is not null as "vectorTableExists"
      from pg_namespace n where n.nspname='public'
      """, []);
    var tables = await QueryAsync(conn, null, """
      select v.name, c.oid is not null as "exists", pg_get_userbyid(c.relowner) as owner,
        case when c.oid is not null then pg_has_role(current_user,c.relowner,'USAGE') end as "canAlterAsCurrentRole",
        case when c.oid is not null then has_table_privilege(current_user,c.oid,'SELECT') end as "canSelect",
        case when c.oid is not null then has_table_privilege(current_user,c.oid,'INSERT') end as "canInsert",
        case when c.oid is not null then has_table_privilege(current_user,c.oid,'UPDATE') end as "canUpdate",
        case when c.oid is not null then has_table_privilege(current_user,c.oid,'TRIGGER') end as "canCreateTrigger"
      from (values ('schema_migrations'),('admin_audit'),('users'),('user_entitlements'),
        ('user_subscriptions'),('user_progress_events'),('user_progress'),('user_draw_owned'),
        ('user_draw_meta'),('user_wallet'),('user_deck_wallet'),('user_premium_state'),
        ('rc_webhook_events'),('card_reports'),('revenuecat_deletions'),('account_deletions'),
        ('decks'),('cards'),('deck_publishes'),('content_review_receipts'),('content_review_revocations'),
        ('content_rollback_actions'),('publish_dispatch'),('publish_manifest_delivery'),('card_embeddings')) v(name)
      left join pg_class c on c.oid=to_regclass('public.'||v.name) order by v.name
      """, []);
    var functions = await QueryAsync(conn, null, """
      select v.signature, p.oid is not null as "exists", pg_get_userbyid(p.proowner) as owner,
        p.prosecdef as "securityDefiner",
        case when p.oid is not null then pg_has_role(current_user,p.proowner,'USAGE') end as "canAlterAsCurrentRole"
      from (values ('enforce_account_deletion_barrier()'),('publish_card_serialization()'),
        ('publish_snapshot_guard()'),('content_release_card_lock()'),('content_release_live_guard()'),
        ('content_release_immutable()'),('content_release_rollback(bigint,text,text,text,text,text,text)'),
        ('content_rollback_record_delivery()'),('publish_committed_build_guard()')) v(signature)
      left join pg_proc p on p.oid=to_regprocedure('public.'||v.signature) order by v.signature
      """, []);
    var rollback = await QueryAsync(conn, null, """
      select pg_get_userbyid(p.proowner) as "functionOwner",
        p.proowner=d.relowner as "ownerMatchesDecks", p.proowner=l.relowner as "ownerMatchesLedger",
        case when p.oid is not null and l.oid is not null then has_table_privilege(p.proowner,l.oid,'INSERT') end as "ownerCanInsertLedger",
        case when p.oid is not null and l.oid is not null then has_table_privilege(p.proowner,l.oid,'SELECT') end as "ownerCanSelectLedger"
      from (values(1)) v(dummy)
      left join pg_proc p on p.oid=to_regprocedure('public.content_release_rollback(bigint,text,text,text,text,text,text)')
      left join pg_class d on d.oid=to_regclass('public.decks')
      left join pg_class l on l.oid=to_regclass('public.content_rollback_actions')
      """, []);
    return new { session = session.Single(), tables, functions, rollback = rollback.Single() };
  }
}
