DROP POLICY IF EXISTS "crm_leads: acesso por empresa" ON public.crm_leads;
CREATE POLICY "crm_leads: acesso por empresa"
ON public.crm_leads
FOR ALL
USING (id_empresa = (SELECT u.id_empresa FROM public.crm_users u WHERE u.auth_user_id = auth.uid()))
WITH CHECK (id_empresa = (SELECT u.id_empresa FROM public.crm_users u WHERE u.auth_user_id = auth.uid()));