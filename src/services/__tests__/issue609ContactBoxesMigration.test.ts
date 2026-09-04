import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/008_portal_contact_boxes.sql', 'utf8')

describe('issue 609 — caixas de comunicação', () => {
  it('cria catálogo, mapa de modelos, vínculos e trilha agrupada', () => {
    expect(sql).toMatch(/CREATE TABLE public\.customer_communication_boxes/i)
    expect(sql).toMatch(/CREATE TABLE public\.customer_communication_box_kinds/i)
    expect(sql).toMatch(/CREATE TABLE public\.customer_contact_box_links/i)
    expect(sql).toMatch(/CREATE TABLE public\.customer_contact_change_events/i)
    expect(sql).toMatch(/email_normalized.*GENERATED ALWAYS/i)
    expect(sql).toMatch(/deactivated_at\s+(timestamptz|timestamp with time zone)/i)
    expect(sql).toMatch(/UNIQUE INDEX.*customer_contacts.*email_normalized/i)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.find_due_customer_communication_automations/i)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.claim_due_demurrage_dunning_invoices/i)
  })

  it('semeia exatamente as três caixas e os pacotes atuais', () => {
    expect(sql).toMatch(/documentacao_operacao/i)
    expect(sql).toMatch(/financeiro/i)
    expect(sql).toMatch(/demurrage/i)
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

  it('implementa repair_customer_contact_box_fallbacks e customer_communication_recipient_allowed', () => {
    expect(sql).toMatch(/CREATE( OR REPLACE)? FUNCTION public\.repair_customer_contact_box_fallbacks/i)
    expect(sql).toMatch(/CREATE( OR REPLACE)? FUNCTION public\.customer_communication_recipient_allowed/i)
  })
})
