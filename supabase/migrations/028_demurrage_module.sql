-- ============================================================
-- 028_demurrage_module.sql
-- Módulo de Demurrage integrado ao Transhipping Desk
-- Porta a lógica do Demurrage Manager para o sistema principal
-- ============================================================

-- ── bl_containers: campos de rastreamento de demurrage ────────
ALTER TABLE bl_containers ADD COLUMN IF NOT EXISTS discharge_date date;
ALTER TABLE bl_containers ADD COLUMN IF NOT EXISTS return_date date;
ALTER TABLE bl_containers ADD COLUMN IF NOT EXISTS demurrage_status text
  DEFAULT 'within_free_time'
  CHECK (demurrage_status IN ('within_free_time', 'overdue', 'returned'));

-- ── bls: overrides de taxa e ROE por BL ───────────────────────
ALTER TABLE bls ADD COLUMN IF NOT EXISTS demurrage_rate_override_p1_usd numeric(10,2);
ALTER TABLE bls ADD COLUMN IF NOT EXISTS demurrage_rate_override_p2_usd numeric(10,2);
ALTER TABLE bls ADD COLUMN IF NOT EXISTS demurrage_roe_manual boolean DEFAULT false;
ALTER TABLE bls ADD COLUMN IF NOT EXISTS demurrage_roe numeric(10,4);

-- ── demurrage_invoices: ciclo completo (draft → issued → paid) ─
CREATE TABLE IF NOT EXISTS demurrage_invoices (
  id                    bigserial PRIMARY KEY,
  doc_number            text NOT NULL UNIQUE,
  bl_id                 text NOT NULL REFERENCES bls(id),
  customer_id           bigint NOT NULL REFERENCES customers(id),

  -- Datas do ciclo de faturamento
  doc_date              date DEFAULT CURRENT_DATE,
  due_date              date,
  billed_at             date,
  first_billed_at       date,
  paid_at               date,
  ready_at              date,

  -- Valores (vivos até congelamento na emissão)
  total_usd             numeric(12,2) NOT NULL DEFAULT 0,
  roe                   numeric(10,4),
  roe_manual            boolean DEFAULT false,
  frozen_roe            numeric(10,4),
  frozen_total_brl      numeric(14,2),

  -- Desconto
  discount_type         text CHECK (discount_type IN ('comercial','datas','cortesia','acordo','erro')),
  discount_value        numeric(12,2),
  discount_mode         text CHECK (discount_mode IN ('percent','fixed')),
  discount_justification text,
  discount_approver     text,

  -- Disputa
  dispute_open          boolean DEFAULT false,
  dispute_subject       text,
  dispute_reason        text,
  dispute_status        text CHECK (dispute_status IN ('aberto','resolvido','cancelado')),
  dispute_notes         text,

  -- PIX
  pix_payload           text,
  pix_txid              text,
  conciliated_by_extract boolean DEFAULT false,

  status                text DEFAULT 'draft'
                        CHECK (status IN ('draft','issued','paid','cancelled')),
  notes                 text,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

-- ── demurrage_invoice_items: linha por container ───────────────
CREATE TABLE IF NOT EXISTS demurrage_invoice_items (
  id              bigserial PRIMARY KEY,
  invoice_id      bigint NOT NULL REFERENCES demurrage_invoices(id) ON DELETE CASCADE,
  container_id    bigint NOT NULL REFERENCES bl_containers(id),
  container_number text NOT NULL,
  container_type  text NOT NULL,
  discharge_date  date NOT NULL,
  return_date     date NOT NULL,
  total_days      integer NOT NULL,
  free_days       integer NOT NULL,
  days_p1         integer NOT NULL DEFAULT 0,
  rate_p1_usd     numeric(10,2) NOT NULL DEFAULT 0,
  days_p2         integer NOT NULL DEFAULT 0,
  rate_p2_usd     numeric(10,2) NOT NULL DEFAULT 0,
  subtotal_usd    numeric(12,2) NOT NULL,
  created_at      timestamptz DEFAULT now()
);

-- ── Trigger: discharge_date automático via voyages.ata ────────
CREATE OR REPLACE FUNCTION set_container_discharge_date()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_ata date;
BEGIN
  SELECT v.ata::date INTO v_ata
  FROM bls b
  JOIN voyages v ON v.id = b.voyage_id
  WHERE b.id = NEW.bl_id;
  IF v_ata IS NOT NULL THEN
    NEW.discharge_date := v_ata;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_container_discharge_date ON bl_containers;
CREATE TRIGGER trg_container_discharge_date
  BEFORE INSERT ON bl_containers
  FOR EACH ROW
  WHEN (NEW.discharge_date IS NULL)
  EXECUTE FUNCTION set_container_discharge_date();

-- ── updated_at trigger para demurrage_invoices ────────────────
CREATE OR REPLACE FUNCTION touch_demurrage_invoice_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_demurrage_invoice_updated_at ON demurrage_invoices;
CREATE TRIGGER trg_demurrage_invoice_updated_at
  BEFORE UPDATE ON demurrage_invoices
  FOR EACH ROW
  EXECUTE FUNCTION touch_demurrage_invoice_updated_at();

-- ── RLS para demurrage_invoices e demurrage_invoice_items ──────
ALTER TABLE demurrage_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE demurrage_invoice_items ENABLE ROW LEVEL SECURITY;

-- Authenticated users podem ler/escrever (mesma política dos invoices existentes)
CREATE POLICY "authenticated_read_demurrage_invoices"
  ON demurrage_invoices FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "authenticated_insert_demurrage_invoices"
  ON demurrage_invoices FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "authenticated_update_demurrage_invoices"
  ON demurrage_invoices FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_delete_demurrage_invoices"
  ON demurrage_invoices FOR DELETE
  TO authenticated USING (true);

CREATE POLICY "authenticated_read_demurrage_items"
  ON demurrage_invoice_items FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "authenticated_insert_demurrage_items"
  ON demurrage_invoice_items FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "authenticated_delete_demurrage_items"
  ON demurrage_invoice_items FOR DELETE
  TO authenticated USING (true);
