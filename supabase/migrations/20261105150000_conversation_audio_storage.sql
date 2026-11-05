-- Only the authenticated Edge Function issues short-lived URLs after checking
-- conversation visibility through the existing Hub RPC. No direct client policy.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('conversation-audio', 'conversation-audio', false, 16777216,
  array['audio/ogg','audio/mpeg','audio/mp4','audio/aac','audio/amr','audio/wav'])
on conflict (id) do nothing;
