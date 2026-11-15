-- Repair 056's owner self-revoke without granting isolated runtime ledger writes.
-- Also executed transactionally before 059, whose trigger creation needs TRIGGER.
do $repair$
declare rollback_owner oid; ledger_owner oid; decks_owner oid; is_definer boolean;
begin
 select proowner,prosecdef into rollback_owner,is_definer from pg_proc
 where oid=to_regprocedure('public.content_release_rollback(bigint,text,text,text,text,text,text)');
 select relowner into ledger_owner from pg_class where oid=to_regclass('public.content_rollback_actions');
 select relowner into decks_owner from pg_class where oid=to_regclass('public.decks');
 if rollback_owner is null or ledger_owner is null or decks_owner is null
   or not is_definer or rollback_owner<>ledger_owner or rollback_owner<>decks_owner then
   raise exception 'ROLLBACK_OWNER_MISMATCH';
 end if;
 execute format('grant insert,trigger on table public.content_rollback_actions to %I',pg_get_userbyid(rollback_owner));
end
$repair$;
