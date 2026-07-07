# Plan 005: Adicionar script `typecheck` e gate `size-limit` no CI

> **Executor instructions**: Siga este plano passo a passo. Rode cada comando
> de verificação e confirme o resultado esperado antes do próximo passo. Se
> qualquer condição de STOP ocorrer, pare e reporte — não improvise. Ao
> terminar, atualize a linha deste plano em `plans/README.md`.
>
> **Drift check (rode primeiro)**:
> `git diff --stat 86cb5ac..HEAD -- package.json .github/workflows/ci.yml WORKFLOW.md`
> Se algum arquivo em escopo mudou desde a escrita do plano, compare os
> trechos de "Estado atual" com o código vivo antes de prosseguir; em caso de
> divergência, trate como condição de STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (aditivo; pior caso é o gate novo ficar vermelho e exigir um
  ajuste único de budget)
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `86cb5ac`, 2026-07-07

## Por que isso importa

O repo definiu um budget de bundle (`size-limit`, 250 kB gzip para o JS de
carga inicial) e o documenta em `WORKFLOW.md` como o guard de tamanho — mas o
CI nunca o executa, então qualquer PR pode estourar o budget silenciosamente.
Além disso, não existe script de typecheck isolado: a única forma de checar
tipos é `npm run build` (tsc + bundle Vite completo, exigindo env
`VITE_SUPABASE_*`), o que torna o loop de feedback de agentes e humanos mais
lento que o necessário. Duas adições pequenas fecham os dois buracos.

## Estado atual

Arquivos relevantes:

- `package.json` — scripts (linhas 6–17) e bloco `size-limit` (linhas 18–32).
- `.github/workflows/ci.yml` — único workflow de CI (job `checks`):
  `npm ci --legacy-peer-deps` → `docs:check` → `lint` → `build` (com env
  `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` de secrets) → `test`.
- `WORKFLOW.md` — documenta o gate local (linhas ~362–367, lista
  `npm run build` como passo de tipos) e o budget (linhas ~371–382).

Scripts atuais (`package.json:6-17`) — não há `typecheck`:

```json
  "scripts": {
    "sync": "git fetch origin --prune && git pull --ff-only",
    "sync:hard": "git fetch origin --prune && git reset --hard origin/main && git clean -fd",
    "dev": "vite",
    "docs:check": "node scripts/check-docs.mjs",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "test": "vitest run",
    "test:integration": "vitest run src/integration/supabase.integration.test.ts",
    "size-limit": "size-limit",
    "preview": "vite preview"
  },
```

Fim do `ci.yml` atual (o passo Test é o último; não há size-limit):

```yaml
      - name: Build (tsc + vite)
        run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}

      - name: Test
        run: npm test
```

O bloco `size-limit` do `package.json` aponta para `dist/assets/*.js` — ou
seja, o passo do CI precisa rodar DEPOIS do build (o `dist/` já existe nesse
ponto do job).

Convenções: mudanças em comandos/CI exigem atualizar a documentação viva no
mesmo change (contrato de documentação do `CLAUDE.md`); o doc afetado é
`WORKFLOW.md`.

## Comandos necessários

| Propósito | Comando | Esperado em sucesso |
|-----------|---------|---------------------|
| Instalar | `npm ci --legacy-peer-deps` | exit 0 |
| Typecheck novo | `npm run typecheck` | exit 0 |
| Build | `npm run build` | exit 0 (requer env `VITE_SUPABASE_*`) |
| Budget | `npm run size-limit` | exit 0, tabela dentro do limite |
| Docs | `npm run docs:check` | exit 0 |

## Escopo

**Em escopo** (únicos arquivos a modificar):
- `package.json` (adicionar script `typecheck`)
- `.github/workflows/ci.yml` (passo size-limit após o build)
- `WORKFLOW.md` (refletir o script novo e o gate de CI)
- `plans/README.md` (status)

**Fora de escopo** (NÃO tocar):
- O valor do budget (250 kB) e a lista de chunks do bloco `size-limit` —
  mudá-los é decisão do mantenedor (ver STOP).
- Hardening do workflow (permissions, pinning) — já coberto pelo plano 005 da
  auditoria de segurança em `docs/plans/security-audit-2026-07-07/`; não
  misturar.
- `package-lock.json` — nenhuma dependência nova é necessária
  (`size-limit` e `@size-limit/file` já estão em devDependencies).

## Git workflow

- Branch designada pelo operador; commit no estilo do repo, ex.:
  `ci: roda size-limit no CI e adiciona script typecheck`.
- Não faça push nem abra PR a menos que o operador instrua.

## Passos

### Passo 1: Script `typecheck`

Em `package.json`, adicione aos scripts (mantendo a ordem/estilo):

```json
    "typecheck": "tsc -b",
```

`tsc -b` usa os `tsconfig.*.json` do projeto e não emite bundle; não requer
env `VITE_*`.

**Verify**: `npm run typecheck` → exit 0.

### Passo 2: Passo `size-limit` no CI

Em `.github/workflows/ci.yml`, adicione após o passo "Build (tsc + vite)" e
antes de "Test" (o `dist/` do build é o input):

```yaml
      - name: Bundle size budget
        run: npm run size-limit
```

**Verify**: arquivo YAML válido —
`node -e "console.log(require('js-yaml') ? 'skip' : '')"` não é necessário;
use `npx --yes yaml-lint .github/workflows/ci.yml` se disponível, senão
inspeção de indentação + o run de CI do PR como verificação final.

### Passo 3: Validar o budget localmente

Rode `npm run build` (exporte `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`
com valores dummy sintaticamente válidos se o ambiente não os tiver — ex.:
`VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=dummy npm run build`)
e então `npm run size-limit`.

**Verify**: `npm run size-limit` → exit 0 e todos os itens dentro do limite.
Se estourar o limite, isso é condição de STOP (ver abaixo) — o budget não é
seu para ajustar.

### Passo 4: Atualizar WORKFLOW.md

- Na seção do gate local (~linhas 362–367): adicione `npm run typecheck` como
  o passo rápido de tipos (o `build` continua sendo o gate completo).
- Na seção do budget (~linhas 371–382): registre que o CI agora executa
  `size-limit` após o build em todo PR.

**Verify**: `npm run docs:check` → exit 0.

## Plano de testes

Sem testes unitários — a verificação é executar os próprios comandos
(`typecheck`, `size-limit`, `docs:check`) e o run de CI do PR ficar verde com
o passo novo visível no log.

## Critérios de conclusão

- [ ] `npm run typecheck` existe e sai com 0
- [ ] `.github/workflows/ci.yml` contém o passo `Bundle size budget` entre
  Build e Test
- [ ] `npm run size-limit` local sai com 0 (com `dist/` do build atual)
- [ ] `npm run docs:check` sai com 0
- [ ] `git status` mostra somente arquivos do escopo modificados
- [ ] Linha do plano 005 atualizada em `plans/README.md`

## Condições de STOP

Pare e reporte (não improvise) se:

- `npm run size-limit` local FALHAR o budget com o código atual — o gate novo
  nasceria vermelho; a decisão de subir o limite ou emagrecer o bundle é do
  mantenedor (o achado "Sentry no bundle inicial" do backlog auditado em
  `plans/README.md` é o candidato natural).
- `npm run typecheck` falhar com erros de tipo pré-existentes — não corrija
  código de produto neste plano; reporte a lista.
- O workflow tiver mudado estruturalmente desde `86cb5ac` (ex.: job dividido,
  passos renomeados) — reavalie o ponto de inserção antes de aplicar.

## Notas de manutenção

- O bloco `size-limit` do `package.json` lista chunks por prefixo de nome
  (`index-*`, `vendor-*`, etc.); renomeações de chunk no Vite podem fazer o
  gate medir menos do que deveria sem falhar — revisor de mudanças no
  `vite.config.ts` deve conferir essa lista.
- Se o plano 005 da auditoria de segurança (hardening do workflow) rodar
  depois deste, haverá merge trivial no `ci.yml`; ambos são aditivos.
