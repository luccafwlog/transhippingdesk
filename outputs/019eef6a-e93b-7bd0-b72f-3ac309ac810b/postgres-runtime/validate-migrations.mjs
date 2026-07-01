import fs from 'node:fs/promises'
import path from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
const dataDir = path.join(import.meta.dirname, 'data')
const reportPath = path.join(import.meta.dirname, 'migration-validation.json')
const port = 55432

const database = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
  onError: (message) => console.error(message),
})

function withoutPgCronExtension(sql) {
  return sql.replace(
    /CREATE EXTENSION IF NOT EXISTS pg_cron(?: WITH SCHEMA extensions)?;/gi,
    '-- pg_cron replaced by a test-only scheduler stub',
  )
}

async function main() {
  console.log('migration-validation: removing previous cluster')
  await fs.rm(dataDir, { recursive: true, force: true })
  console.log('migration-validation: initialising PostgreSQL 17 cluster')
  await database.initialise()
  console.log('migration-validation: starting PostgreSQL 17 cluster')
  await database.start()

  try {
    console.log('migration-validation: creating app database')
    await database.createDatabase('app')
    const client = new pg.Client({
      host: '127.0.0.1',
      port,
      database: 'app',
      user: 'postgres',
      password: 'postgres',
    })
    await client.connect()

    try {
      console.log('migration-validation: applying Supabase bootstrap')
      const bootstrapPath = path.join(repoRoot, 'scripts', 'design-audit', 'bootstrap.sql')
      const bootstrap = withoutPgCronExtension(await fs.readFile(bootstrapPath, 'utf8'))
      await client.query(bootstrap)
      await client.query(`
        CREATE PUBLICATION supabase_realtime;
        CREATE SCHEMA IF NOT EXISTS cron;
        CREATE TABLE IF NOT EXISTS cron.job (
          jobid BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          jobname TEXT,
          schedule TEXT NOT NULL,
          command TEXT NOT NULL
        );
        CREATE OR REPLACE FUNCTION cron.schedule(
          p_name TEXT,
          p_schedule TEXT,
          p_command TEXT
        )
        RETURNS BIGINT
        LANGUAGE plpgsql
        AS $$
        DECLARE
          v_jobid BIGINT;
        BEGIN
          INSERT INTO cron.job(jobname, schedule, command)
          VALUES (p_name, p_schedule, p_command)
          RETURNING jobid INTO v_jobid;
          RETURN v_jobid;
        END;
        $$;
      `)

      const migrationsDir = path.join(repoRoot, 'supabase', 'migrations')
      const files = (await fs.readdir(migrationsDir))
        .filter((file) => file.endsWith('.sql'))
        .sort((left, right) => left.localeCompare(right))

      const applied = []
      for (const file of files) {
        console.log(`migration-validation: applying ${file}`)
        const sql = withoutPgCronExtension(await fs.readFile(path.join(migrationsDir, file), 'utf8'))
        try {
          await client.query('BEGIN')
          await client.query(sql)
          await client.query('COMMIT')
          applied.push(file)
        } catch (error) {
          await client.query('ROLLBACK')
          const report = {
            postgresVersion: (await client.query('SHOW server_version')).rows[0]?.server_version,
            appliedCount: applied.length,
            applied,
            failedMigration: file,
            error: {
              message: error instanceof Error ? error.message : String(error),
              code: error?.code ?? null,
              detail: error?.detail ?? null,
              hint: error?.hint ?? null,
              position: error?.position ?? null,
            },
          }
          await fs.writeFile(reportPath, JSON.stringify(report, null, 2))
          console.log(JSON.stringify(report, null, 2))
          process.exitCode = 1
          return
        }
      }

      const report = {
        postgresVersion: (await client.query('SHOW server_version')).rows[0]?.server_version,
        appliedCount: applied.length,
        applied,
        failedMigration: null,
      }
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2))
      console.log(JSON.stringify(report, null, 2))
    } finally {
      await client.end()
    }
  } finally {
    await database.stop()
  }
}

await main()
