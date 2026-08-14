import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const auditSql = readFileSync('supabase/migrations/294_audit_trail_actor_and_triggers.sql', 'utf8')
const writesSql = readFileSync('supabase/migrations/295_internal_writes_global.sql', 'utf8')

describe('rastros e escrita interna global', () => {
  it('congela o departamento sem preencher o histórico antigo', () => {
    expect(auditSql).toMatch(/ALTER TABLE public\.audit_logs ADD COLUMN IF NOT EXISTS actor_role TEXT;/)
    expect(auditSql).toMatch(/ALTER COLUMN actor_role SET DEFAULT public\.current_actor_role\(\)/)
    expect(auditSql).not.toMatch(/UPDATE public\.audit_logs[\s\S]*actor_role/)
    expect(auditSql).toMatch(/audit_row_changes\(\)[\s\S]*SECURITY DEFINER/)
    expect(auditSql).toMatch(/AFTER UPDATE OR DELETE ON public\.%I/)
    expect(auditSql).toMatch(/import_baplie_staging_transactional[\s\S]*is_active_user\(\)[\s\S]*is_admin\(\)/)
  })

  it('mantém as exclusões operacionais atrás de is_admin', () => {
    expect(writesSql).toContain("v_read := 'public.is_admin()'")
    expect(writesSql).toMatch(/Migration 295 deixou uma policy DELETE aberta/)
    expect(writesSql).toMatch(/DROP FUNCTION IF EXISTS public\.can_edit_voyages/)
  })

  it('normaliza auth.role() sem deixar parênteses no padrão LIKE, e cobre policies FOR ALL no guard final', () => {
    // regexp_replace remove parênteses do qual/with_check antes de comparar; o
    // padrão do LIKE precisa estar igualmente normalizado, senão nunca casa.
    expect(writesSql).not.toMatch(/LIKE '%auth\.role\(\)=/)
    expect(writesSql).toMatch(/LIKE '%auth\.role='/)
    expect(writesSql).toMatch(/cmd IN \('DELETE', 'ALL'\)/)
  })

  it('audita bl_freight_lines pela chave composta e não duplica o rastro manual de voyages/baplie', () => {
    // bl_freight_lines não tem coluna id (PK é bl_id+seq); passar 'id' faria
    // todo UPDATE/DELETE falhar com NOT NULL violation em entity_id.
    expect(auditSql).toMatch(/v_key := CASE WHEN v_table = 'bl_freight_lines' THEN 'bl_id,seq' ELSE 'id' END/)
    expect(auditSql).toMatch(/string_to_array\(COALESCE\(TG_ARGV\[0\], 'id'\), ','\)/)
    // voyages já grava audit_logs manualmente (createVoyage/updateVoyage/cancelVoyage);
    // baplie_containers é staging reimportado por inteiro a cada importação.
    expect(auditSql).not.toMatch(/v_full_tables CONSTANT TEXT\[\] := ARRAY\[[^\]]*'voyages'/)
    expect(auditSql).not.toMatch(/v_line_tables CONSTANT TEXT\[\] := ARRAY\[[^\]]*'baplie_containers'/)
  })

  it('não congela route_summary com segmentos vazios quando pol/pod ficam em branco', () => {
    expect(auditSql).toMatch(/WHERE route IS NOT NULL AND route <> ''/)
    expect(auditSql).toMatch(/WHERE b\.route IS NOT NULL AND b\.route <> ''/)
  })

  it('abre leitura financeira e console para usuário interno ativo', () => {
    expect(writesSql).toMatch(/get_consolidated_invoice_item_breakdown[\s\S]*public\.is_active_user\(\)/)
    expect(writesSql).toMatch(/list_invoice_details[\s\S]*is_active_read_user\(\)/)
    expect(writesSql).toMatch(/portal_list_provisioning_events[\s\S]*equipamentos/)
  })
})
