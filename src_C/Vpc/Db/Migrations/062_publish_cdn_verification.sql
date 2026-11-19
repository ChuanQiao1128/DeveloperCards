-- A row certifies the exact exported bytes checked by the Worker before upload.
-- Existing builds have no certificate and retain the original recovery path.
create table if not exists publish_cdn_verification (
 job_id varchar(100) primary key references deck_publishes(job_id),
 sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
 card_count integer not null check (card_count > 0),
 verified_at timestamptz,
 failure_code text,
 check (verified_at is null or failure_code is null)
);
