#!/usr/bin/env python3
"""Verifica o invariante de autorização das migrations, sem tocar no banco.

Motivação (achados 1 a 4 do relatório): o cliente do Portal e o operador interno
recebem o MESMO role `authenticated` do Supabase Auth. Uma função SECURITY
DEFINER ignora RLS por definição — então toda função DEFINER concedida a
`authenticated` PRECISA de guarda própria no corpo, ou o cliente do Portal lê e
escreve dados de outros clientes. Hoje isso depende de disciplina humana
repetida em ~200 funções. Este script transforma essa disciplina em verificação.

O que ele faz, reproduzindo as migrations em ordem para obter o estado FINAL:

  1. Toda tabela tem RLS habilitada.
  2. Nenhuma policy viva é permissiva (USING (true) ou auth.role() =
     'authenticated'), que é o padrão que vaza para o Portal.
  3. Toda função SECURITY DEFINER concedida a `authenticated` tem guarda —
     própria ou em alguma função da sua cadeia de delegação.

Blocos `DO $$ ... FOREACH ... $$` são expandidos: boa parte das policies do
projeto nasce dentro deles e um grep simples não as enxerga.

Uso:
    python3 docs/security-audit/verificar_guardas.py            # relatório
    python3 docs/security-audit/verificar_guardas.py --ci       # sai 1 se falhar

Limites conhecidos (ponytail: análise estática, não o catálogo do Postgres):
  - Revogações feitas por loop sobre `pg_proc` (migrations 093, 292, 296) não
    são visíveis aqui; funções que dependem SÓ delas aparecem como falso
    positivo. Registre-as em EXCECOES com a migration que as cobre.
  - Sobrecargas são agrupadas pelo nome, sem distinguir assinatura.
  Para verificação exata, consulte pg_policies/pg_proc no banco.
"""
from __future__ import annotations

import argparse
import glob
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MIGRATIONS = os.path.join(RAIZ, 'supabase', 'migrations')

# Tokens que caracterizam uma guarda de autorização no corpo da função.
GUARDAS = [
    'is_active_read_user', 'is_admin(', 'is_active_user', 'current_portal_customer_id',
    '_portal_actor_role', 'portal_current_role', 'current_user_role', '_portal_inspect_guard',
    'is_financeiro_user', 'has_department', 'is_equipamentos', '42501',
    # 28000 = sessão inválida; usado pelas RPCs que resolvem a conta por auth.uid().
    '28000',
]

# Funções cujo ACL é fechado por loop sobre pg_proc, invisível para a análise
# estática. Chave: nome. Valor: migration que a cobre.
EXCECOES = {
    'resolve_customer_portal_session': '093 (revoga anon em todas as DEFINER)',
    'portal_get_session_overview': '093 — guardada pelo segredo do token de sessão',
    'portal_list_pending_bls': '093 — guardada pelo segredo do token de sessão',
    'portal_logout': '093 — guardada pelo segredo do token de sessão',
    'portal_login': '093 — recebe a senha, verificada no corpo',
    # Predicados de autorização: SÃO a guarda, não algo que precisa de guarda.
    # Retornam um booleano sobre o próprio chamador e não expõem dado de terceiro.
    'can_edit_customers': 'predicado de RBAC usado dentro de policies (215)',
    'can_edit_voyages': 'predicado de RBAC usado dentro de policies (215)',
    'can_edit_local_charges': 'predicado de RBAC usado dentro de policies (291)',
    'is_active_non_equipamentos_user': 'predicado de RBAC usado dentro de policies (211)',
    'current_actor_role': 'resolve o papel do próprio chamador (294)',
    'audit_row_changes': 'função de trigger; roda como owner, sem parâmetro do chamador (294)',
    # Falsos positivos da análise estática, confirmados à mão na auditoria:
    'save_granite_bl_review': (
        'delega a save_granite_bl_review_legacy_148, criada por ALTER ... RENAME '
        '(286) — o corpo com is_active_user() está em 148 e o parser não o associa'),
    'set_voyage_route_ce_master': (
        'a sobrecarga de 6 argumentos tem a guarda (350:51); a de 5 delega a ela. '
        'O parser agrupa sobrecargas pelo nome'),
}


def arquivos():
    return sorted(glob.glob(os.path.join(MIGRATIONS, '*.sql')),
                  key=lambda p: int(os.path.basename(p).split('_')[0]))


def expandir_do(bloco: str) -> str:
    """Expande FOREACH sobre ARRAY dentro de um bloco DO, resolvendo format()."""
    saida = []
    arrays = {}
    for m in re.finditer(r"(\w+)\s+TEXT\[\]\s*:=\s*ARRAY\s*\[(.*?)\]\s*;", bloco, re.S | re.I):
        arrays[m.group(1)] = re.findall(r"'([^']+)'", m.group(2))
    padrao = r"FOREACH\s+(\w+)\s+IN\s+ARRAY\s+(?:ARRAY\s*\[(.*?)\]|(\w+))\s*LOOP(.*?)END\s+LOOP\s*;"
    for m in re.finditer(padrao, bloco, re.S | re.I):
        var, inline, nomeado, corpo = m.groups()
        valores = re.findall(r"'([^']+)'", inline) if inline else arrays.get(nomeado, [])
        for v in valores:
            b = corpo

            def resolver(mm, _v=v, _var=var):
                tmpl, args = mm.group(1), mm.group(2)
                partes = [a.strip() for a in re.split(r",(?![^()]*\))", args)] if args else []
                res = []
                for a in partes:
                    a = re.sub(r"\b%s\b" % re.escape(_var), "'%s'" % _v, a.strip())
                    a = re.sub(r"'\s*\|\|\s*'", "", a)
                    res.append(re.sub(r"^'|'$", "", a))
                out = tmpl
                for r in res:
                    out = re.sub(r"%[IsL]", r, out, count=1)
                return out

            b = re.sub(r"format\(\s*'((?:[^']|'')*)'\s*(?:,(.*?))?\)", resolver, b, flags=re.S)
            b = re.sub(r"\b%s\b" % re.escape(var), v, b)
            saida.append(b)
    return "\n".join(saida)


def estado_final():
    tabelas, rls, policies = {}, set(), {}
    fns, grants = {}, {}

    def dividir_funcoes(s):
        for m in re.finditer(r'CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\(',
                             s, re.I):
            ini, nome = m.start(), m.group(1)
            tag = re.search(r'AS\s+(\$\w*\$)', s[ini:ini + 4000], re.I)
            if not tag:
                fim = s.find(';', ini)
                yield nome, s[ini:fim if fim > 0 else ini + 2000]
                continue
            t = tag.group(1)
            b0 = ini + tag.end()
            b1 = s.find(t, b0)
            yield nome, s[ini:(b1 + len(t) if b1 > 0 else ini + 8000)]

    for f in arquivos():
        bruto = open(f, encoding='utf-8', errors='replace').read()
        base = os.path.basename(f)
        for nome, txt in dividir_funcoes(bruto):
            fns[nome] = {'corpo': txt, 'arquivo': base,
                         'secdef': bool(re.search(r'SECURITY\s+DEFINER', txt, re.I))}

        s = re.sub(r'^\s*--.*$', '', bruto, flags=re.M)
        exp = s
        for dm in re.finditer(r"DO\s*\$\$(.*?)\$\$\s*;", s, re.S | re.I):
            exp += "\n" + expandir_do(dm.group(1))

        for m in re.finditer(r'create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?', exp, re.I):
            tabelas.setdefault(m.group(1), base)
        for m in re.finditer(r'drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?', exp, re.I):
            tabelas.pop(m.group(1), None)
        for m in re.finditer(
                r'alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?\s+enable\s+row\s+level\s+security',
                exp, re.I):
            rls.add(m.group(1))

        for m in re.finditer(r'DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?\s+ON\s+(?:public\.)?"?(\w+)"?', exp, re.I):
            policies.pop((m.group(2), m.group(1)), None)
        for m in re.finditer(r'CREATE\s+POLICY\s+"?(\w+)"?\s+ON\s+(?:public\.)?"?(\w+)"?(.*?)(?=;)', exp, re.S | re.I):
            policies[(m.group(2), m.group(1))] = {'corpo': ' '.join(m.group(3).split()), 'arquivo': base}
        for m in re.finditer(r'ALTER\s+POLICY\s+"?(\w+)"?\s+ON\s+(?:public\.)?"?(\w+)"?(.*?)(?=;)', exp, re.S | re.I):
            k = (m.group(2), m.group(1))
            if k in policies:
                policies[k] = {'corpo': ' '.join(m.group(3).split()), 'arquivo': base}

        for m in re.finditer(r'GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\([^)]*\)\s*TO\s+([^;]+);', s, re.I):
            for r in m.group(2).split(','):
                grants.setdefault(m.group(1), set()).add(r.strip().lower())
        for m in re.finditer(r'REVOKE\s+(?:ALL|EXECUTE)(?:\s+ON\s+FUNCTION)\s+(?:public\.)?"?(\w+)"?\s*\([^)]*\)\s*FROM\s+([^;]+);', s, re.I):
            for r in m.group(2).split(','):
                grants.setdefault(m.group(1), set()).discard(r.strip().lower())

    return tabelas, rls, policies, fns, grants


def tem_guarda(nome, fns, prof=0, vistos=None):
    """Procura guarda na função e, recursivamente, na cadeia de delegação."""
    vistos = vistos if vistos is not None else set()
    if nome in vistos or prof > 4:
        return None
    vistos.add(nome)
    v = fns.get(nome)
    if not v:
        return None
    baixo = v['corpo'].lower()
    for g in GUARDAS:
        if g in baixo:
            return f'{nome} -> {g}'
    for m in re.finditer(r'public\.(\w+)\s*\(', v['corpo'], re.I):
        alvo = m.group(1).lower()
        if alvo == nome.lower():
            continue
        r = tem_guarda(alvo, fns, prof + 1, vistos)
        if r:
            return f'{nome} -> {r}'
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ci', action='store_true', help='sai com código 1 se houver falha')
    args = ap.parse_args()

    tabelas, rls, policies, fns, grants = estado_final()
    falhas = []

    print(f'Migrations analisadas : {len(arquivos())}')
    print(f'Tabelas               : {len(tabelas)}')
    print(f'Policies vivas        : {len(policies)}')
    print(f'Funções               : {len(fns)}')
    print()

    sem_rls = sorted(t for t in tabelas if t not in rls)
    print(f'[1] RLS habilitada em todas as tabelas .......... '
          f'{"OK" if not sem_rls else "FALHA (%d)" % len(sem_rls)}')
    for t in sem_rls:
        falhas.append(f'tabela sem RLS: {t} ({tabelas[t]})')
        print(f'      - {t} ({tabelas[t]})')

    permissivas = []
    for (t, n), v in sorted(policies.items()):
        b = v['corpo'].lower()
        if (re.search(r"using\s*\(\s*true\s*\)", b)
                or re.search(r"with\s+check\s*\(\s*true\s*\)", b)
                or re.search(r"auth\.role\(\)\s*\)?\s*=\s*'authenticated'", b)):
            permissivas.append((t, n, v))
    print(f'[2] Nenhuma policy permissiva viva ............. '
          f'{"OK" if not permissivas else "FALHA (%d)" % len(permissivas)}')
    for t, n, v in permissivas:
        falhas.append(f'policy permissiva: {t}.{n} ({v["arquivo"]})')
        print(f'      - {t}.{n} ({v["arquivo"]})')

    expostas = []
    for n, v in sorted(fns.items()):
        if 'authenticated' not in grants.get(n, set()) or not v['secdef']:
            continue
        if tem_guarda(n, fns):
            continue
        if n in EXCECOES:
            continue
        expostas.append((n, v))
    print(f'[3] Toda SECURITY DEFINER exposta tem guarda .... '
          f'{"OK" if not expostas else "FALHA (%d)" % len(expostas)}')
    for n, v in expostas:
        falhas.append(f'DEFINER sem guarda concedida a authenticated: {n} ({v["arquivo"]})')
        print(f'      - {n} ({v["arquivo"]})')

    print()
    if falhas:
        print(f'{len(falhas)} verificação(ões) falharam.')
        print('Revise cada item: ou adicione a guarda, ou feche o ACL '
              '(REVOKE ... FROM authenticated), ou registre a exceção com justificativa.')
        if args.ci:
            sys.exit(1)
    else:
        print('Todas as verificações passaram.')


if __name__ == '__main__':
    main()
