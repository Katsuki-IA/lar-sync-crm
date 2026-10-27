-- Activate only alongside the released frontend, after validating worker compatibility.
-- Do not enable external delivery for test companies as part of this migration.
select cron.schedule('hub-task-reminders-v1','* * * * *','select private.hub_dispatch_due_task_reminders()');
