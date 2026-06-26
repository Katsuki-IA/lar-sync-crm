-- Evita conflito no PostgREST entre a RPC antiga por ID numerico e a nova por token.

drop function if exists public.crm_public_lead_history(bigint, text);

grant execute on function public.crm_public_lead_history(text, text) to anon;
grant execute on function public.crm_public_lead_history(text, text) to authenticated;

notify pgrst, 'reload schema';
