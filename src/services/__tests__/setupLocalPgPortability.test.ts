import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const helpers = 'scripts/lib/local-pg-platform.sh'
const tempDirs: string[] = []

function tempBin() {
  const dir = mkdtempSync(join(tmpdir(), 'transhipping-pg-platform-'))
  tempDirs.push(dir)
  return dir
}

function bash(script: string, env: NodeJS.ProcessEnv = {}) {
  return execFileSync('/bin/bash', ['-c', `source "${helpers}"; ${script}`], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  }).trim()
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('setup-local-pg — seleção e segurança portáveis', () => {
  it('seleciona o caminho Debian somente quando pg_ctlcluster existe', () => {
    const bin = tempBin()
    const pgCtlCluster = join(bin, 'pg_ctlcluster')
    writeFileSync(pgCtlCluster, '#!/bin/sh\nexit 0\n')
    chmodSync(pgCtlCluster, 0o755)

    expect(bash('local_pg_has_debian_cluster && printf debian', { PATH: bin })).toBe('debian')
    expect(bash('local_pg_has_debian_cluster || printf macos', { PATH: tempBin() })).toBe('macos')
  })

  it('aceita reset apenas dentro do TMPDIR informado', () => {
    const sandbox = tempBin()
    const session = join(sandbox, 'session')
    const pgdata = join(session, 'pgdata')
    mkdirSync(session)
    mkdirSync(pgdata)
    expect(bash(`local_pg_validate_reset_target '${pgdata}' '${session}' && printf ok`)).toBe('ok')
    const outside = spawnSync('/bin/bash', ['-c', `source "${helpers}"; local_pg_validate_reset_target '${sandbox}' '${session}'`], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
    expect(outside.status).not.toBe(0)
  })

  it('rejeita traversal canônico antes de parar ou remover o cluster', () => {
    const sandbox = tempBin()
    const sessionTmp = join(sandbox, 'session', 'nested')
    const outside = join(sandbox, 'outside')
    const bin = join(sandbox, 'bin')
    const log = join(sandbox, 'pg_ctl.log')
    const marker = join(outside, 'must-survive')
    mkdirSync(sessionTmp, { recursive: true })
    mkdirSync(outside)
    mkdirSync(bin)
    writeFileSync(marker, 'safe')

    for (const name of ['psql', 'initdb']) {
      const executable = join(bin, name)
      writeFileSync(executable, '#!/bin/sh\nexit 1\n')
      chmodSync(executable, 0o755)
    }
    writeFileSync(join(bin, 'dirname'), '#!/bin/sh\nprintf scripts\n')
    chmodSync(join(bin, 'dirname'), 0o755)
    writeFileSync(join(bin, 'id'), '#!/bin/sh\nprintf test-user\n')
    chmodSync(join(bin, 'id'), 0o755)
    writeFileSync(join(bin, 'pg_config'), `#!/bin/sh\nprintf '${sandbox}/share'\n`)
    chmodSync(join(bin, 'pg_config'), 0o755)
    writeFileSync(join(bin, 'pg_ctl'), `#!/bin/sh\ncase "$*" in *status*) exit 0;; *stop*) printf stop >> '${log}'; exit 0;; esac\nexit 1\n`)
    chmodSync(join(bin, 'pg_ctl'), 0o755)

    const result = spawnSync('/bin/bash', ['scripts/setup-local-pg.sh', '--reset'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: bin,
        PG_BIN: bin,
        TMPDIR: sessionTmp,
        LOCAL_PGDATA: `${sessionTmp}/../../outside`,
      },
      encoding: 'utf8',
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('LOCAL_PGDATA deve estar sob TMPDIR para --reset')
    expect(existsSync(marker)).toBe(true)
    expect(existsSync(log) ? readFileSync(log, 'utf8') : '').not.toContain('stop')
  })

  it('resolve o diretório de extensões pelo pg_config do PostgreSQL selecionado', () => {
    const bin = tempBin()
    const pgConfig = join(bin, 'pg_config')
    writeFileSync(pgConfig, '#!/bin/sh\nprintf /opt/postgresql-16/share\n')
    chmodSync(pgConfig, 0o755)

    expect(bash(`local_pg_extension_dir '${bin}'`)).toBe('/opt/postgresql-16/share/extension')
  })
})
