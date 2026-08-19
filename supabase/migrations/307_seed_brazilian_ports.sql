-- Migration 307 — catálogo mínimo de portos brasileiros da operação
-- Intent: garantir que as escalas existentes e novas encontrem um ports.id
-- antes de a migration 306 começar a exigir esse vínculo nas RPCs.
-- Affected object: public.ports.
-- Consumers: escala unificada, Cadastro de Terminais, ADR e Line-Up.
-- Additive/idempotent: preserva registros existentes e insere somente LOCODEs
-- canônicos ausentes. Rollback: em ambiente descartável, remova apenas as
-- linhas inseridas por esta migration depois de confirmar que nenhum FK aponta
-- para elas; não remova dados do catálogo em produção.

-- BRVIT é um alias legado aceito pelo app, mas BRVIX é o LOCODE canônico que
-- normalizePortCode persiste e que as RPCs da escala procuram.
UPDATE public.ports
SET locode = 'BRVIX'
WHERE upper(btrim(locode)) = 'BRVIT'
  AND NOT EXISTS (
    SELECT 1 FROM public.ports AS canonical
    WHERE upper(btrim(canonical.locode)) = 'BRVIX'
  );

WITH seed(name, locode) AS (
  VALUES
    ('Vitória', 'BRVIX'),
    ('Salvador', 'BRSSA'),
    ('Pecém', 'BRPEC'),
    ('Suape', 'BRSUA'),
    ('Santos', 'BRSSZ'),
    ('Itaguaí', 'BRIGI'),
    ('Navegantes', 'BRNVT'),
    ('Paranaguá', 'BRPNG'),
    ('Rio Grande', 'BRRIG'),
    ('Rio de Janeiro', 'BRRIO')
)
INSERT INTO public.ports (name, locode, country)
SELECT seed.name, seed.locode, 'Brasil'
FROM seed
WHERE NOT EXISTS (
  SELECT 1
  FROM public.ports AS existing
  WHERE upper(btrim(existing.locode)) = seed.locode
);
