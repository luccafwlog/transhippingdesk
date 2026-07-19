import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/205_bl_document_fields.sql', 'utf8')

describe('205_bl_document_fields', () => {
  it('adiciona as colunas documentais em bls', () => {
    for (const col of ['place_of_receipt', 'movement_from', 'movement_to', 'issue_place']) {
      expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${col} TEXT`))
    }
  })

  it('reaplica import_bl_freight_transactional cobrindo os novos campos', () => {
    const fn = sql.match(/CREATE OR REPLACE FUNCTION public\.import_bl_freight_transactional[\s\S]*?\$function\$;/i)?.[0] ?? ''
    for (const col of ['place_of_receipt', 'movement_from', 'movement_to', 'issue_place']) {
      expect((fn.match(new RegExp(col, 'g')) ?? []).length).toBeGreaterThanOrEqual(5)
    }
  })

  it('reaplica save_bl_review aceitando os novos campos editaveis', () => {
    const fn = sql.match(/CREATE(?: OR REPLACE)? FUNCTION public\.save_bl_review[\s\S]*?(?:\$\$|\$function\$);/i)?.[0] ?? ''
    for (const col of ['place_of_receipt', 'movement_from', 'movement_to', 'issue_place', 'place_of_delivery', 'bl_emission_date']) {
      expect(fn).toMatch(new RegExp(`p_update_payload \\? '${col}'`))
    }
  })

  it('preserva o contrato canonico JSONB do review gate', () => {
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.save_bl_review\(TEXT, TIMESTAMPTZ, JSONB, JSONB, UUID\)/i)
    expect(sql).toMatch(/CREATE FUNCTION public\.save_bl_review[\s\S]*?RETURNS JSONB/i)
    expect(sql).toMatch(/CREATE FUNCTION public\.save_bl_review[\s\S]*?SECURITY DEFINER/i)
    expect(sql).toMatch(/CREATE FUNCTION public\.save_bl_review[\s\S]*?compute_bl_review_pendencies/i)
  })
})
