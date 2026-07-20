import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
    expect(bash("local_pg_validate_reset_target '/tmp/session/pgdata' '/tmp/session' && printf ok")).toBe('ok')
    const outside = spawnSync('/bin/bash', ['-c', `source "${helpers}"; local_pg_validate_reset_target '/Users/shared/pgdata' '/tmp/session'`], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
    expect(outside.status).not.toBe(0)
  })

  it('resolve o diretório de extensões pelo pg_config do PostgreSQL selecionado', () => {
    const bin = tempBin()
    const pgConfig = join(bin, 'pg_config')
    writeFileSync(pgConfig, '#!/bin/sh\nprintf /opt/postgresql-16/share\n')
    chmodSync(pgConfig, 0o755)

    expect(bash(`local_pg_extension_dir '${bin}'`)).toBe('/opt/postgresql-16/share/extension')
  })
})
