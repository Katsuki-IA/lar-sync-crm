-- Ativar somente após instalar v2 e v3 e validar as regras no ambiente.
-- pg_cron executa como o administrador instalador; a função não é exposta ao cliente.
select cron.schedule('hub-sales-queue-worker-v3','* * * * *',
 'select private.hub_run_sales_queue_worker(200);');
