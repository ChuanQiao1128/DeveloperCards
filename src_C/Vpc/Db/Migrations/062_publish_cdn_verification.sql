-- A row certifies the exact exported bytes checked by the Worker before upload.
-- Existing builds have no certificate and retain the original recovery path.
create table if not exists publish_cdn_verification (
 job_id varchar(100) primary key references deck_publishes(job_id),
 sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
 card_count integer not null check (card_count > 0),
 requested_at timestamptz,
 verified_at timestamptz,
 failure_code text,
 check (verified_at is null or failure_code is null)
);

-- A maintenance migration can run after the app role has lost schema ownership.
do $$
begin
 if current_user <> 'developercards_app' and exists(select 1 from pg_roles where rolname='developercards_app') then
   grant select,insert,update on public.publish_cdn_verification to developercards_app;
 end if;
end $$;
