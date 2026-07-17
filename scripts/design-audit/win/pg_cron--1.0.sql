-- Stub pg_cron: real pg_cron has no Windows binary, so we fake the surface the
-- migrations touch (create extension, cron.schedule/unschedule, cron.job table).
-- No jobs ever run — the app never depends on the scheduler for UI/audit.
create schema cron;
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$ select 0::bigint $$;
create function cron.schedule(schedule text, command text) returns bigint language sql as $$ select 0::bigint $$;
create function cron.unschedule(job_name text) returns boolean language sql as $$ select true $$;
create function cron.unschedule(job_id bigint) returns boolean language sql as $$ select true $$;
create table cron.job (jobid bigint, jobname text, schedule text, command text);
grant usage on schema cron to public;
grant select on cron.job to public;
