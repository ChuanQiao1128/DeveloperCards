-- Display/navigation edits invalidate content_editing_snapshot (and bound receipts) as before,
-- but do not demote learned cards. This replaces only the protected-card trigger function from 050.
-- No rows, historical revisions, review evidence or progress are rewritten.
create or replace function content_release_card_lock() returns trigger language plpgsql as $$
declare did bigint; protected boolean; old_core jsonb; new_core jsonb;
begin
 did := case when TG_OP='DELETE' then OLD.deck_id else NEW.deck_id end;
 select slug='aws-saa-fundamentals' into protected from decks where id=did;
 if protected then perform id from decks where id=did for update; end if;
 if TG_OP='UPDATE' and OLD.deck_id<>NEW.deck_id then
   if protected or exists(select 1 from decks where id=OLD.deck_id and slug='aws-saa-fundamentals') then raise exception 'RELEASE_DECK_MOVE_FORBIDDEN'; end if;
 end if;
 if protected and TG_OP='UPDATE' then
   if OLD.is_deleted=1 and NEW.is_deleted=0 then raise exception 'SOFT_DELETED_UID'; end if;
   if NEW.stable_uid<>OLD.stable_uid then raise exception 'RELEASE_UID_IMMUTABLE'; end if;
   old_core := to_jsonb(OLD)-array['version','revision','updated_at','created_at','translations','translation_basis','tags','order_in_deck','topic','teaching'];
   new_core := to_jsonb(NEW)-array['version','revision','updated_at','created_at','translations','translation_basis','tags','order_in_deck','topic','teaching'];
   if old_core is distinct from new_core or (OLD.teaching-'zh-CN') is distinct from (NEW.teaching-'zh-CN') then
     NEW.revision := OLD.revision+1;
   end if;
 end if;
 if TG_OP='DELETE' then return OLD; end if;
 return NEW;
end $$;
