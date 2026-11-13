-- Additive recovery: old jobs keep legacy semantics; no historical dispatch is invented.
alter table deck_publishes add column if not exists publish_editing_snapshot text;
create table if not exists publish_dispatch (
 job_id varchar(100) primary key references deck_publishes(job_id),
 deck_id bigint not null references decks(id), action_id text, request_hash text,
 actor_superadmin boolean not null default false,
 attempts integer not null default 0, lease_token text, lease_until timestamptz,
 next_attempt_at timestamptz not null default now(), delivered_at timestamptz, last_error text,
 unique(deck_id,action_id)
);
create index if not exists publish_dispatch_due on publish_dispatch(next_attempt_at) where attempts<5;
create table if not exists publish_manifest_delivery (
 job_id varchar(100) primary key references deck_publishes(job_id),
 state text not null default 'pending' check(state in('pending','delivered','needs_attention')),
 attempts integer not null default 0, lease_token text, lease_until timestamptz,
 next_attempt_at timestamptz not null default now(), last_error text, delivered_at timestamptz
);
create index if not exists publish_manifest_due on publish_manifest_delivery(next_attempt_at) where state='pending';
-- All card writes share the deck lock with final commit, including ordinary decks.
-- The existing protected-card trigger retains UID/revision rules.
create or replace function publish_card_serialization() returns trigger language plpgsql as $$
begin
 if TG_OP='UPDATE' and OLD.deck_id<>NEW.deck_id then
   perform id from decks where id in(OLD.deck_id,NEW.deck_id) order by id for update;
 else
   perform id from decks where id=case when TG_OP='DELETE' then OLD.deck_id else NEW.deck_id end for update;
 end if;
 if TG_OP='DELETE' then return OLD; end if;
 return NEW;
end $$;
drop trigger if exists a_publish_card_serialization on cards;
create trigger a_publish_card_serialization before insert or update or delete on cards for each row execute function publish_card_serialization();
create or replace function publish_snapshot_guard() returns trigger language plpgsql as $$
begin
 if TG_OP='UPDATE' and OLD.publish_editing_snapshot is not null and NEW.publish_editing_snapshot is distinct from OLD.publish_editing_snapshot then
   raise exception 'PUBLISH_SNAPSHOT_IMMUTABLE' using errcode='P0001';
 end if;
 if NEW.publish_editing_snapshot is not null and (TG_OP='INSERT' or NEW.status='SUCCESS' and OLD.status<>'SUCCESS' or NEW.publish_editing_snapshot is distinct from OLD.publish_editing_snapshot) then
   perform id from decks where id=NEW.deck_id for update;
   if NEW.publish_editing_snapshot is distinct from content_editing_snapshot(NEW.deck_id)
      or not exists(select 1 from decks where id=NEW.deck_id and is_deleted=0) then
     raise exception 'PUBLISH_SNAPSHOT_STALE' using errcode='P0001';
   end if;

 end if;
 if TG_OP='UPDATE' and OLD.publish_editing_snapshot is not null and OLD.status in('SUCCESS','FAILED') and NEW.status<>OLD.status then
   raise exception 'PUBLISH_TERMINAL' using errcode='P0001';
 end if;
 return NEW;
end $$;
drop trigger if exists publish_snapshot_guard on deck_publishes;
create trigger publish_snapshot_guard before insert or update on deck_publishes for each row execute function publish_snapshot_guard();
