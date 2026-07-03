#!/usr/bin/env bash
# Provisiona um Postgres 16 LOCAL e DESCARTÁVEL com o schema completo do
# Transhipping Desk, para validar migrations sem tocar no Supabase de produção
# (WORKFLOW.md §5: "banco descartável"). Idempotente. Nunca conecta em produção.
#
#   Uso:  scripts/setup-local-pg.sh [--reset]
#   Saída: exporta/echo DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/transhipping_test
#
# Requisitos (já presentes no contêiner de dev): pacote postgresql-16 + cluster
# 16/main (Debian), runuser. Aplica shims Supabase (auth, roles, extensions,
# pg_cron stub, publicação realtime) que o vanilla PG não traz.
set -euo pipefail

DB=transhipping_test
PORT=5432
EXTDIR="/usr/share/postgresql/16/extension"
RESET="${1:-}"

psql_su() { runuser -u postgres -- psql -p "$PORT" "$@"; }

# 1. Cluster de pé
if ! pg_lsclusters 2>/dev/null | awk '$1==16 && $2=="main"{print $4}' | grep -q online; then
  pg_ctlcluster 16 main start >/dev/null 2>&1 || true
  sleep 2
fi

# 2. Stub do pg_cron (extensão gerida pelo Supabase; não existe no vanilla PG).
#    No-op: o schema/funcs `cron` vêm do shim abaixo.
if [ ! -f "$EXTDIR/pg_cron.control" ]; then
  printf "comment = 'stub pg_cron'\ndefault_version = '1.0'\nrelocatable = true\n" > "$EXTDIR/pg_cron.control"
  printf -- '-- no-op stub; cron schema+funcs vêm do shim\n' > "$EXTDIR/pg_cron--1.0.sql"
fi

# 3. Senha p/ acesso TCP local
psql_su -q -tc "ALTER USER postgres PASSWORD 'postgres';" >/dev/null 2>&1 || true

# 4. Já pronto? (fast-path, salvo --reset)
if [ "$RESET" != "--reset" ] && [ -n "$(psql_su -d "$DB" -tAc "select to_regclass('public.bls')" 2>/dev/null | tr -d '[:space:]')" ]; then
  echo "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:${PORT}/${DB}"
  echo "# (schema já presente — use --reset para recriar do zero)"
  exit 0
fi

# 5. Recria o banco + shims + replay das migrations
psql_su -q -tc "DROP DATABASE IF EXISTS ${DB};" >/dev/null
psql_su -q -tc "CREATE DATABASE ${DB};" >/dev/null

psql_su -d "$DB" -v ON_ERROR_STOP=1 -q <<'SQL'
DO $$ BEGIN CREATE ROLE anon NOLOGIN;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT);
CREATE OR REPLACE FUNCTION auth.uid()  RETURNS UUID LANGUAGE sql STABLE AS $f$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS $f$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated') $f$;
CREATE OR REPLACE FUNCTION auth.jwt()  RETURNS JSONB LANGUAGE sql STABLE AS $f$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $f$;
GRANT USAGE ON SCHEMA auth, extensions TO anon, authenticated, service_role;
CREATE SCHEMA IF NOT EXISTS cron;
CREATE OR REPLACE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $f$ SELECT 0::bigint $f$;
CREATE OR REPLACE FUNCTION cron.schedule(schedule text, command text)                RETURNS bigint LANGUAGE sql AS $f$ SELECT 0::bigint $f$;
CREATE OR REPLACE FUNCTION cron.unschedule(job_name text)                            RETURNS boolean LANGUAGE sql AS $f$ SELECT true $f$;
DO $$ BEGIN CREATE PUBLICATION supabase_realtime; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
SQL

for f in $(ls supabase/migrations/*.sql | sort -V); do
  if ! psql_su -d "$DB" -v ON_ERROR_STOP=1 -q < "$f" >/tmp/pg_replay.log 2>&1; then
    echo "❌ FALHOU em $(basename "$f"):" >&2
    tail -8 /tmp/pg_replay.log >&2
    exit 1
  fi
done

echo "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:${PORT}/${DB}"
echo "# ✅ $(ls supabase/migrations/*.sql | wc -l) migrations aplicadas no Postgres 16 descartável."
