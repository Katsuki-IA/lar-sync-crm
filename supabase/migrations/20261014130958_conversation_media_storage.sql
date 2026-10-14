insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('conversation-attachments','conversation-attachments',false,104857600,array['image/jpeg','image/png','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy conversation_attachments_company_read on storage.objects for select to authenticated
using(bucket_id='conversation-attachments' and auth.uid() is not null and public.crm_current_role() is not null
 and (public.crm_current_role()='super_admin' or split_part(name,'/',1)=public.crm_current_empresa_id()::text));
-- Uploads are issued by the authenticated Edge handler after assignment/window validation.
-- No public SELECT or direct client write policy is granted.

