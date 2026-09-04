import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/008_portal_contact_boxes.sql', 'utf8')

describe('issue 609 — caixas de comunicação', () => {
  it('cria catálogo, mapa de modelos, vínculos e trilha agrupada (replay-safe)', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.customer_communication_boxes/i)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.customer_communication_box_kinds/i)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.customer_contact_box_links/i)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.customer_contact_change_events/i)
    expect(sql).toMatch(/email_normalized.*GENERATED ALWAYS/i)
    expect(sql).toMatch(/deactivated_at\s+(timestamptz|timestamp with time zone)/i)
    expect(sql).toMatch(/UNIQUE INDEX.*customer_contacts.*email_normalized/i)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.find_due_customer_communication_automations/i)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.claim_due_demurrage_dunning_invoices/i)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.portal_get_contact_configuration\(\)/i)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.portal_inspect_get_contact_configuration\(p_customer_id bigint\)/i)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.portal_save_contact_configuration\(p_contacts jsonb\)/i)
  })

  it('semeia exatamente as três caixas e os pacotes atuais', () => {
    expect(sql).toMatch(/'\s*documentacao_operacao\s*'/i)
    expect(sql).toMatch(/'\s*financeiro\s*'/i)
    expect(sql).toMatch(/'\s*demurrage\s*'/i)
    expect(sql).toMatch(/aviso_chegada_noa/i)
    expect(sql).toMatch(/aviso_prontidao_nor/i)
    expect(sql).toMatch(/aviso_atracacao_nob/i)
    expect(sql).toMatch(/ce_mercante_taxas/i)
    expect(sql).toMatch(/cobranca_demurrage/i)
  })

  it('expõe RPC própria do Portal e wrapper de Inspeção sem customer_id no save', () => {
    expect(sql).toMatch(/CREATE( OR REPLACE)? FUNCTION public\.portal_save_contact_configuration\(p_contacts jsonb\)/i)
    expect(sql).toMatch(/CREATE( OR REPLACE)? FUNCTION public\.portal_get_contact_configuration\(\)/i)
    expect(sql).toMatch(/CREATE( OR REPLACE)? FUNCTION public\.portal_inspect_get_contact_configuration\(p_customer_id bigint\)/i)
    expect(sql).toMatch(/current_portal_customer_id\(\)/i)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\._apply_customer_contact_configuration/i)
  })

  it('fecha escrita direta em eventos e exige leitura interna', () => {
    expect(sql).toMatch(/REVOKE .*INSERT.*UPDATE.*DELETE.*customer_contact_change_events/i)
    expect(sql).toMatch(/CREATE POLICY .*customer_contact_change_events.*SELECT.*is_active_read_user/i)
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS trg_seed_customer_contact_preferences/i)
  })

  it('implementa repair_customer_contact_box_fallbacks fechado a cross-tenant com auditoria agrupada', () => {
    expect(sql).toMatch(/CREATE( OR REPLACE)? FUNCTION public\.repair_customer_contact_box_fallbacks/i)
    expect(sql).toMatch(/Permissão negada para reparar caixas de contato/i)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.repair_customer_contact_box_fallbacks\(bigint, text, text\) FROM PUBLIC, anon, authenticated/i)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.repair_customer_contact_box_fallbacks\(bigint, text, text\) TO service_role/i)
    expect(sql).toMatch(/bounce_fallback_repair/i)
    expect(sql).toMatch(/CREATE( OR REPLACE)? FUNCTION public\.customer_communication_recipient_allowed/i)
  })

  it('assegura integridade de tipos, catálogo de alertas e grants de contatos', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS updated_at timestamptz/i)
    expect(sql).toMatch(/related_bl_id\s+text/i)
    expect(sql).toMatch(/INSERT INTO public\.alert_type_catalog[\s\S]*caixa_sem_destinatario[\s\S]*cliente_sem_contato_principal/i)
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.ensure_customer_contact_email\(bigint, text, text, text\)/i)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.ensure_customer_contact_email\(bigint, text, text, text, text\) TO authenticated, service_role/i)
    expect(sql).toMatch(/upsert_alert_item\(\s*'caixa_sem_destinatario',\s*'customer'/i)
    expect(sql).toMatch(/upsert_alert_item\(\s*'cliente_sem_contato_principal',\s*'customer'/i)
  })

  it('sanitiza duplicados reescrevendo o e-mail (desativar sozinho seria no-op no índice)', () => {
    expect(sql).toMatch(/SET deactivated_at = COALESCE\(deactivated_at, now\(\)\),\s*email = NULL/i)
  })

  it('substitui o seed legado por trigger de vínculos + trigger de updated_at', () => {
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS trg_seed_customer_contact_preferences/i)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.seed_customer_contact_box_links\(\)/i)
    expect(sql).toMatch(/CREATE TRIGGER trg_seed_customer_contact_box_links/i)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.touch_customer_contact_updated_at\(\)/i)
    expect(sql).toMatch(/CREATE TRIGGER trg_touch_customer_contact_updated_at/i)
  })

  it('gate de revisão ignora contatos desativados e RLS não chama função que levanta exceção', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.compute_bl_review_pendencies\(p_customer_id bigint, p_cargo_mode text, p_bb_weight_ton numeric\)/i)
    expect(sql).toMatch(/c\.deactivated_at IS NULL/i)
    expect(sql).toMatch(/customer_portal_accounts a\s+WHERE a\.auth_user_id = auth\.uid\(\) AND a\.active = true/i)
    expect(sql).not.toMatch(/USING \(public\.is_active_read_user\(\) OR public\.current_portal_customer_id\(\) IS NOT NULL\)/i)
  })

  it('núcleo valida duplicada inclusive contra inativo, suporta swaps e não trava bounce', () => {
    expect(sql).toMatch(/inclusive contra um registro inativo/i)
    expect(sql).toMatch(/v_ids_with_email/i)
    expect(sql).toMatch(/SET email = NULL/i)
    expect(sql).toMatch(/v_suppressed_only_boxes/i)
    expect(sql).toMatch(/caixa_sem_destinatario/i)
  })

  it('save interno exige permissão customer_communications (não qualquer ativo)', () => {
    expect(sql).toMatch(/role IN \('administrativo', 'admin', 'documentacao', 'operator', 'equipamentos'\)/i)
  })
})
