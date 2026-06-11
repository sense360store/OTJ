-- =====================================================================
-- OTJ Training Hub - video media embeds
-- Migration 0013_video_media
--
-- REVIEW REQUIRED. One structural change: media gains a nullable
-- embed_url so a media row can point at a third party video player
-- instead of a stored file. No policy, enum or constraint change.
--
-- The new video kind: a video media row (type 'video') carries an
-- embed_url and no storage_path; an uploaded clip carries a storage_path
-- and no embed_url. This backs the FA video session import, where a
-- session page delivers its content as a Vimeo embed rather than drill
-- diagrams. The FA video is embedded from its host, never downloaded.
-- =====================================================================

alter table public.media add column embed_url text;

comment on column public.media.embed_url is
  'Third party video player URL for an embedded video. A video media row (type video) has an embed_url and no storage_path; an uploaded clip has a storage_path and no embed_url.';
