select cron.schedule('hub-web-push-every-minute','* * * * *',$job$
select net.http_post(
 url:='https://tswdxgefmhjvjwafaxjl.supabase.co/functions/v1/hub-web-push',
 headers:=jsonb_build_object('Content-Type','application/json','x-hub-push-key',(select worker_key from private.hub_push_config where id)),
 body:='{}'::jsonb,timeout_milliseconds:=55000)
where exists(select 1 from private.hub_push_subscriptions where enabled);
$job$);
