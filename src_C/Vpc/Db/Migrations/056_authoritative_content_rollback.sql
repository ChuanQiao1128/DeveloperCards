-- Owner-context rollback only: runtime custom GUCs cannot bypass the live guard.
create table if not exists content_rollback_actions (
 deck_id bigint not null references decks(id), release_id text not null, action_id text not null,
 payload_hash text not null, request jsonb not null, result jsonb not null,
 created_at timestamptz not null default now(), primary key(deck_id,release_id,action_id)
);
revoke all on content_rollback_actions from public;
drop trigger if exists content_rollback_action_immutable on content_rollback_actions;
create trigger content_rollback_action_immutable before update or delete on content_rollback_actions
 for each row execute function content_release_immutable();

create or replace function content_release_live_guard() returns trigger language plpgsql security invoker
set search_path=pg_catalog,public as $$
begin
 if OLD.slug='aws-saa-fundamentals' then
   if NEW.slug<>OLD.slug then raise exception 'RELEASE_SLUG_IMMUTABLE'; end if;
   if NEW.live_build_id is distinct from OLD.live_build_id and not (
     current_user=pg_get_userbyid((select relowner from pg_class where oid='public.decks'::regclass))
     and coalesce(current_setting('recallsmith.rollback_deck',true),'')=OLD.id::text) then
     if not exists(select 1 from public.deck_publishes p join public.content_review_receipts r on r.id=p.release_receipt_id
       where p.deck_id=OLD.id and p.build_id=NEW.live_build_id and p.status='SUCCESS'
       and p.release_generation=NEW.release_generation and p.release_expected_live is not distinct from OLD.live_build_id
       and r.expires_at>clock_timestamp() and not exists(select 1 from public.content_review_revocations x where x.receipt_id=r.id)
       and r.editing_snapshot=public.content_editing_snapshot(OLD.id)) then raise exception 'RELEASE_LIVE_COMMIT_DENIED'; end if;
   end if;
 end if;
 return NEW;
end $$;

create or replace function content_release_rollback(
 did bigint, rid text, aid text, target text, expected text, target_hash text, request_hash text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.decks%rowtype; failed_generation bigint; saved public.content_rollback_actions%rowtype;
 input jsonb; output jsonb; previous_setting text;
begin
 if coalesce(length(rid),0) not between 1 and 160 or coalesce(length(aid),0) not between 1 and 160
 or coalesce(length(target),0) not between 1 and 160 or coalesce(length(expected),0) not between 1 and 160
 or target_hash is null or target_hash !~ '^[0-9a-f]{64}$' or request_hash is null or request_hash !~ '^[0-9a-f]{64}$'
 then raise exception 'ROLLBACK_ARGUMENT_INVALID'; end if;
 select * into d from public.decks where id=did for update;
 if not found or d.slug<>'aws-saa-fundamentals' or d.is_deleted<>0 then raise exception 'ROLLBACK_DECK_INVALID'; end if;
 input:=jsonb_build_object('target',target,'expected',expected,'targetHash',target_hash);
 select * into saved from public.content_rollback_actions where deck_id=did and release_id=rid and action_id=aid;
 if found then
   if saved.payload_hash<>request_hash or saved.request<>input then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
   return saved.result;
 end if;
 if not exists(select 1 from public.deck_publishes where deck_id=did and build_id=target and status='SUCCESS' and content_sha256=target_hash)
 then raise exception 'RESTORE_BUILD_INVALID'; end if;
 if d.live_build_id is distinct from target and d.live_build_id is distinct from expected then raise exception 'LIVE_BUILD_CONFLICT'; end if;
 select p.release_generation into failed_generation from public.deck_publishes p
 join public.content_review_receipts r on r.id=p.release_receipt_id and r.deck_id=p.deck_id
 where p.deck_id=did and p.build_id=expected and r.release_id=rid;
 if failed_generation is null or failed_generation>d.release_generation then raise exception 'FAILED_BUILD_SCOPE'; end if;
 if d.live_build_id is distinct from target and exists(select 1 from public.deck_publishes
   where deck_id=did and release_generation>failed_generation and status in('PENDING','PROCESSING'))
 then raise exception 'RELEASE_GENERATION_CONFLICT'; end if;
 if d.live_build_id is distinct from target or d.release_generation=failed_generation then
   previous_setting:=current_setting('recallsmith.rollback_deck',true);
   perform set_config('recallsmith.rollback_deck',did::text,true);
   update public.decks set release_generation=release_generation+1,live_build_id=target where id=did;
   perform set_config('recallsmith.rollback_deck',coalesce(previous_setting,''),true);
   update public.deck_publishes set status='FAILED',error_message='RELEASE_ROLLED_BACK',updated_at=now()
     where deck_id=did and status in('PENDING','PROCESSING');
 end if;
 output:=jsonb_build_object('deckId',did,'liveBuildId',target,'previousBuildId',d.live_build_id,
   'rollbackCommitted',true,'alreadyRestored',d.live_build_id is not distinct from target,
   'editingDatabaseRestored',false,'manifestVerified',false);
 insert into public.content_rollback_actions(deck_id,release_id,action_id,payload_hash,request,result)
 values(did,rid,aid,request_hash,input,output);
 return output;
end $$;
revoke all on function content_release_rollback(bigint,text,text,text,text,text,text) from public;
do $$ begin
 if exists(select 1 from pg_roles where rolname='developercards_app') then
   revoke all on content_rollback_actions from developercards_app;
   grant select on content_rollback_actions to developercards_app;
   grant execute on function content_release_rollback(bigint,text,text,text,text,text,text) to developercards_app;
 end if;
end $$;
