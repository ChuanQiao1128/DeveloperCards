-- Additive; do not reconstruct event identity or scheduler snapshots for legacy rows.
-- NULL is the fixed legacy baseline, below every UUID at an equal review time.
alter table user_progress add column if not exists last_review_event_id uuid;
