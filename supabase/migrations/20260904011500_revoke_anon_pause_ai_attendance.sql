-- A funcao e destinada somente a gestores autenticados e ao backend.

revoke all on function public.crm_pause_ai_attendance(bigint) from public;
revoke all on function public.crm_pause_ai_attendance(bigint) from anon;
grant execute on function public.crm_pause_ai_attendance(bigint) to authenticated;
grant execute on function public.crm_pause_ai_attendance(bigint) to service_role;
