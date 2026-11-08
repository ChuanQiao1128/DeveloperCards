-- =========================
-- 051_card_teaching_tags.sql
-- Structured teaching payload and navigation tags on cards (owner-approved 2026-11-09):
--   * cards.teaching: the structured back face, {"schema":"teaching-v1","answer","keyPoint","watchOut"?,
--     "mustAnswer":[..], "prerequisites":[stableUid..]?, "goal"?, "zh-CN":{"answer","keyPoint","watchOut"?, "goal"?}}.
--     English is the source of truth; the zh-CN sub-object mirrors it like cards.translations does for the
--     prose fields. watchOut and an empty prerequisites list are stored absent (jsonb null), so a card that
--     has no teaching row hashes and serializes exactly as before this migration.
--   * cards.tags: navigation tags {"domain"?: "1".."4", "examTask"?: "1.1"..}, free-form-but-small; no CHECK,
--     validated at the API boundary like translations.
-- Additive and nullable; every reader goes through the row's jsonb image (to_jsonb(c) -> 'teaching'), so a
-- code deploy before the Migrate sees SQL null on both sides and a Migrate before the deploy is inert.
-- Deploy order: code, then migrate (the console's Migrate ships with the code), as for 047/049.
alter table cards add column if not exists teaching jsonb;
alter table cards add column if not exists tags jsonb;
