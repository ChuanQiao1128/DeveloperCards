-- Additive: historical provenance stays unknown; applied migration 056 is unchanged.
alter table content_rollback_actions add column if not exists actor_sub text;
alter table content_rollback_actions add column if not exists reason text;
alter table content_rollback_actions add column if not exists release_generation bigint;

-- Runs inside the existing restricted security-definer rollback function, under its owner.
-- No new definer function or privilege grant is introduced.
create or replace function content_rollback_record_delivery() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare target_job varchar(100);
begin
 NEW.actor_sub:=coalesce(nullif(current_setting('recallsmith.rollback_actor',true),''),session_user);
 NEW.reason:=coalesce(nullif(current_setting('recallsmith.rollback_reason',true),''),'legacy caller: reason not supplied');
 select release_generation into NEW.release_generation from public.decks where id=NEW.deck_id;
 select job_id into target_job from public.deck_publishes
   where deck_id=NEW.deck_id and build_id=NEW.request->>'target' and status='SUCCESS';
 if target_job is null then raise exception 'RESTORE_BUILD_INVALID'; end if;
 insert into public.publish_manifest_delivery(job_id) values(target_job)
 on conflict(job_id) do update set state='pending',attempts=0,lease_token=null,lease_until=null,
   next_attempt_at=clock_timestamp(),last_error=null,delivered_at=null;
 return NEW;
end $$;
revoke all on function content_rollback_record_delivery() from public;
drop trigger if exists content_rollback_record_delivery on content_rollback_actions;
create trigger content_rollback_record_delivery before insert on content_rollback_actions
 for each row execute function content_rollback_record_delivery();

-- Preserve operational bookkeeping, but never rewrite the identity or bytes of a committed build.
create or replace function publish_committed_build_guard() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if OLD.status='SUCCESS' and (
   TG_OP='DELETE' or (NEW.deck_id,NEW.deck_slug,NEW.job_id,NEW.status,NEW.build_id,NEW.s3_key,NEW.content_sha256,NEW.content_bytes,NEW.package_key)
     is distinct from (OLD.deck_id,OLD.deck_slug,OLD.job_id,OLD.status,OLD.build_id,OLD.s3_key,OLD.content_sha256,OLD.content_bytes,OLD.package_key))
 then raise exception 'PUBLISH_BUILD_IMMUTABLE'; end if;
 if TG_OP='DELETE' then return OLD; end if;
 return NEW;
end $$;
revoke all on function publish_committed_build_guard() from public;
drop trigger if exists publish_committed_build_guard on deck_publishes;
create trigger publish_committed_build_guard before update or delete on deck_publishes
 for each row execute function publish_committed_build_guard();
