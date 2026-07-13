# Renomear Repositório GitHub para transhippingdesk — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Renomear `luccafwlog/transhipping-desk2` para `luccafwlog/transhippingdesk` e alinhar o checkout e as referências operacionais do projeto sem alterar os IDs ou integrações de Firebase e Supabase.

**Architecture:** A identidade do repositório GitHub será alterada no GitHub; o checkout local passará a apontar para a nova URL do `origin`. Referências do repositório em documentação viva e planos atuais serão atualizadas, enquanto documentos arquivados manterão os links antigos como histórico. A configuração de deploy continuará usando o projeto Firebase `transhipping-desk`, e a configuração Supabase continuará usando o ref do projeto Supabase.

**Tech Stack:** Git, GitHub CLI/API, GitHub Actions, Firebase Hosting, Supabase CLI/configuração, Markdown, npm/Vite.

## Global Constraints

- O novo nome exato do repositório é `transhippingdesk`, sem hífen.
- O branch padrão continua `main`.
- O Firebase Project ID e Hosting target continuam `transhipping-desk`.
- O ref/projeto Supabase continua inalterado.
- Não alterar documentos em `docs/archive/` apenas para remover URLs históricas.
- Preservar mudanças locais não relacionadas; o checkout deve terminar limpo.
- Validar `npm run docs:check`, `npm run lint`, `npm test` e `npm run build` antes de declarar conclusão.

---

### Task 1: Registrar o plano e atualizar referências operacionais

**Files:**
- Create: `docs/superpowers/plans/2026-07-13-renomear-repositorio-github.md`
- Modify: `docs/agents/issue-tracker.md`
- Modify: `docs/plans/2026-07-10-painel-viagens.md`
- Modify: `docs/superpowers/plans/2026-07-13-portal-provisionamento-00-roadmap.md`
- Do not modify: `docs/archive/**`

**Interfaces:**
- Consumes: links atuais para `https://github.com/luccafwlog/transhipping-desk2` encontrados no checkout.
- Produces: referências atuais para `https://github.com/luccafwlog/transhippingdesk`, sem alteração de conteúdo de domínio ou infraestrutura.

- [ ] **Step 1: Confirmar referências operacionais atuais**

```powershell
rg -n --hidden -g '!node_modules' -g '!.git' -i --fixed-strings 'transhipping-desk2' docs/agents docs/plans docs/superpowers/plans
```

Expected: somente referências dos três arquivos operacionais listados acima.

- [ ] **Step 2: Substituir somente os links operacionais**

Replace the repository path in the three listed files:

```text
https://github.com/luccafwlog/transhipping-desk2
```

with:

```text
https://github.com/luccafwlog/transhippingdesk
```

Do not change archived snapshots or Firebase/Supabase identifiers.

- [ ] **Step 3: Verificar que referências históricas foram preservadas**

```powershell
rg -n --hidden -g '!node_modules' -g '!.git' -i --fixed-strings 'transhipping-desk2' docs/archive
```

Expected: historical references remain only under `docs/archive/`.

- [ ] **Step 4: Validate documentation**

Run: `npm run docs:check`

Expected: exit code 0 with no broken documentation references introduced.

- [ ] **Step 5: Commit the repository-reference changes**

```powershell
git add docs/agents/issue-tracker.md docs/plans/2026-07-10-painel-viagens.md docs/superpowers/plans/2026-07-13-portal-provisionamento-00-roadmap.md docs/superpowers/plans/2026-07-13-renomear-repositorio-github.md
git commit -m "docs: align references with renamed repository"
```

Expected: one commit containing only the plan and current-document URL changes.

### Task 2: Rename the GitHub repository and realign the local remote

**Files:**
- Modify: local `.git/config` through `git remote set-url`; do not edit `.git/config` manually.

**Interfaces:**
- Consumes: authenticated GitHub CLI session for `luccafwlog/transhipping-desk2`.
- Produces: GitHub repository `luccafwlog/transhippingdesk` and local `origin` pointing to its canonical URL.

- [ ] **Step 1: Confirm the current repository identity and authorization**

```powershell
gh auth status
gh repo view luccafwlog/transhipping-desk2 --json nameWithOwner,defaultBranchRef
```

Expected: authenticated account `luccafwlog`, repository name `transhipping-desk2`, default branch `main`.

- [ ] **Step 2: Rename the GitHub repository**

```powershell
gh api --method PATCH repos/luccafwlog/transhipping-desk2 -f name=transhippingdesk
```

Expected: API response reports `name: transhippingdesk` and `full_name: luccafwlog/transhippingdesk`.

- [ ] **Step 3: Update the checkout remote**

```powershell
git remote set-url origin https://github.com/luccafwlog/transhippingdesk.git
git remote -v
```

Expected: fetch and push URLs both use `luccafwlog/transhippingdesk.git`.

- [ ] **Step 4: Verify the renamed repository and branch**

```powershell
git fetch origin
gh repo view luccafwlog/transhippingdesk --json nameWithOwner,defaultBranchRef,url
git status --short --branch
```

Expected: repository exists under the new name, default branch is `main`, and no unrelated changes are present.

### Task 3: Verify third-party integrations and deployment identity

**Files:**
- Inspect only: `.firebaserc`, `firebase.json`, `.github/workflows/firebase-deploy.yml`, `supabase/config.toml`, `supabase/.temp/linked-project.json`.
- Modify: none unless verification finds an actual repository-name dependency.

**Interfaces:**
- Consumes: renamed GitHub repository and existing Firebase/Supabase configuration.
- Produces: evidence that Firebase Hosting still targets `transhipping-desk` and Supabase still targets its existing project ref.

- [ ] **Step 1: Verify Firebase identity remains unchanged**

```powershell
rg -n 'transhipping-desk|FIREBASE_SERVICE_ACCOUNT|--project' .firebaserc firebase.json .github/workflows/firebase-deploy.yml
```

Expected: Firebase project, Hosting target, and service-account secret remain `transhipping-desk`-based.

- [ ] **Step 2: Verify Supabase identity remains unchanged**

```powershell
rg -n 'project_id|fgmkhbzhaeebrsizwccx|transhipping-desk2|transhippingdesk' supabase
```

Expected: Supabase project identifiers remain unchanged and no GitHub repository name is embedded in runtime configuration.

- [ ] **Step 3: Audit workflow action references**

```powershell
rg -n '^\s*uses:|transhipping-desk2|transhippingdesk' .github
```

Expected: no workflow uses the old repository as a reusable Action and no operational workflow reference remains stale.

- [ ] **Step 4: Check Supabase CLI linkage without mutating the project**

```powershell
supabase projects list
```

Expected: if no Supabase token is configured, record that live GitHub integration status could not be queried; do not run `supabase link`, migrations, or deploy commands.

### Task 4: Run repository gates and verify the final remote state

**Files:**
- Inspect: all changed files and Git metadata.

**Interfaces:**
- Consumes: renamed remote and committed document updates.
- Produces: clean checkout, synchronized `main`, passing project validation, and no stale operational repository references.

- [ ] **Step 1: Run the required project checks**

```powershell
npm run docs:check
npm run lint
npm test
npm run build
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 2: Confirm local and remote commit identity**

```powershell
git fetch origin
git rev-parse HEAD
git rev-parse origin/main
git diff --quiet HEAD origin/main
```

Expected: both commit IDs match and the final command exits 0.

- [ ] **Step 3: Confirm no stale active repository URL remains**

```powershell
rg -n --hidden -g '!node_modules' -g '!.git' -i --fixed-strings 'luccafwlog/transhipping-desk2' docs/agents docs/plans docs/superpowers/plans .github README.md WORKFLOW.md CONTEXT.md
```

Expected: no matches in active operational files; matches may remain only under `docs/archive/`.

- [ ] **Step 4: Final status**

```powershell
git status --short --branch
git remote -v
gh repo view luccafwlog/transhippingdesk --json nameWithOwner,defaultBranchRef,url
```

Expected: clean `main`, new canonical remote, and the renamed GitHub repository visible.

