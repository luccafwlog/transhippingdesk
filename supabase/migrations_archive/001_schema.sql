-- Transhipping Desk - schema compartilhado v2
-- Todas as tabelas operacionais usam base compartilhada: sem owner_id/user_id.

CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin', 'operator')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by UUID REFERENCES auth.users(id),
  changed_at TIMESTAMPTZ DEFAULT now(),
  justification TEXT
);

CREATE TABLE IF NOT EXISTS public.alerts (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'closed')),
  assigned_to UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  closed_at TIMESTAMPTZ,
  notified_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.carriers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  scac TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vessels (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  imo TEXT,
  carrier_id BIGINT REFERENCES public.carriers(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ports (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  locode TEXT,
  country TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.voyages (
  id BIGSERIAL PRIMARY KEY,
  vessel_id BIGINT REFERENCES public.vessels(id),
  voyage_number TEXT NOT NULL,
  pol_id BIGINT REFERENCES public.ports(id),
  pod_id BIGINT REFERENCES public.ports(id),
  etd TIMESTAMPTZ,
  eta TIMESTAMPTZ,
  ata TIMESTAMPTZ,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.import_batches (
  id BIGSERIAL PRIMARY KEY,
  voyage_id BIGINT REFERENCES public.voyages(id),
  filename TEXT NOT NULL,
  uploaded_by UUID REFERENCES auth.users(id),
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'partial', 'failed')),
  total_bls INTEGER DEFAULT 0,
  total_containers INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.import_errors (
  id BIGSERIAL PRIMARY KEY,
  batch_id BIGINT REFERENCES public.import_batches(id),
  row_number INTEGER,
  bl_number TEXT,
  error_type TEXT NOT NULL,
  error_message TEXT,
  raw_data JSONB
);

CREATE TABLE IF NOT EXISTS public.customers (
  id BIGSERIAL PRIMARY KEY,
  cnpj_cpf TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  trade_name TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  notes TEXT,
  pending_balance NUMERIC(14,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.charge_tables (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  pod TEXT,
  carrier_id BIGINT REFERENCES public.carriers(id),
  valid_from DATE NOT NULL,
  valid_to DATE,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.charge_table_items (
  id BIGSERIAL PRIMARY KEY,
  charge_table_id BIGINT REFERENCES public.charge_tables(id),
  name TEXT NOT NULL,
  applies_to TEXT NOT NULL CHECK (applies_to IN ('bl', 'container', 'teu')),
  container_type TEXT,
  cargo_profile TEXT CHECK (cargo_profile IN ('standard', 'oog', 'imo', 'any')),
  value_brl NUMERIC(12,2) NOT NULL,
  currency TEXT DEFAULT 'BRL',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customer_contacts (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT REFERENCES public.customers(id),
  name TEXT,
  email TEXT,
  phone TEXT,
  purpose TEXT CHECK (purpose IN ('faturamento', 'operacional', 'financeiro', 'geral')),
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customer_rate_overrides (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT REFERENCES public.customers(id),
  charge_item_id BIGINT REFERENCES public.charge_table_items(id),
  override_value NUMERIC(12,2) NOT NULL,
  valid_from DATE,
  valid_to DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bls (
  id TEXT PRIMARY KEY,
  voyage_id BIGINT REFERENCES public.voyages(id),
  batch_id BIGINT REFERENCES public.import_batches(id),
  shipper TEXT,
  consignee TEXT,
  notify_party TEXT,
  customer_id BIGINT REFERENCES public.customers(id),
  pol TEXT,
  pod TEXT,
  place_of_delivery TEXT,
  cargo_description TEXT,
  total_weight_kg NUMERIC(12,3),
  total_cbm NUMERIC(10,3),
  incoterm TEXT,
  payment_type TEXT CHECK (payment_type IN ('PREPAID', 'COLLECT')),
  financial_status TEXT DEFAULT 'pending' CHECK (financial_status IN ('pending', 'invoiced', 'paid', 'cancelled')),
  review_status TEXT DEFAULT 'ok' CHECK (review_status IN ('ok', 'pending_review', 'reviewed')),
  free_time_override INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bl_containers (
  id BIGSERIAL PRIMARY KEY,
  bl_id TEXT REFERENCES public.bls(id) ON DELETE CASCADE,
  container_number TEXT NOT NULL,
  seal_number TEXT,
  type TEXT,
  tare_weight_kg NUMERIC(10,3),
  gross_weight_kg NUMERIC(10,3),
  cbm NUMERIC(10,3),
  is_oog BOOLEAN DEFAULT false,
  is_imo BOOLEAN DEFAULT false,
  imo_class TEXT,
  un_number TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.charge_calculations (
  id BIGSERIAL PRIMARY KEY,
  bl_id TEXT REFERENCES public.bls(id) ON DELETE CASCADE,
  charge_table_id BIGINT REFERENCES public.charge_tables(id),
  charge_item_id BIGINT REFERENCES public.charge_table_items(id),
  container_id BIGINT REFERENCES public.bl_containers(id),
  quantity NUMERIC(10,3) DEFAULT 1,
  unit_value_brl NUMERIC(12,2),
  total_value_brl NUMERIC(14,2),
  override_applied BOOLEAN DEFAULT false,
  calculated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invoices (
  id BIGSERIAL PRIMARY KEY,
  invoice_number TEXT UNIQUE NOT NULL,
  customer_id BIGINT REFERENCES public.customers(id),
  bl_id TEXT REFERENCES public.bls(id),
  issued_at TIMESTAMPTZ DEFAULT now(),
  due_date DATE,
  total_brl NUMERIC(14,2) NOT NULL,
  status TEXT DEFAULT 'issued' CHECK (status IN ('issued', 'paid', 'cancelled', 'overdue')),
  pix_payload TEXT,
  notes TEXT,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invoice_items (
  id BIGSERIAL PRIMARY KEY,
  invoice_id BIGINT REFERENCES public.invoices(id) ON DELETE CASCADE,
  charge_calculation_id BIGINT REFERENCES public.charge_calculations(id),
  description TEXT NOT NULL,
  quantity NUMERIC(10,3) DEFAULT 1,
  unit_value_brl NUMERIC(12,2),
  total_value_brl NUMERIC(14,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.payments (
  id BIGSERIAL PRIMARY KEY,
  invoice_id BIGINT REFERENCES public.invoices(id),
  amount_brl NUMERIC(14,2) NOT NULL,
  payment_method TEXT CHECK (payment_method IN ('pix', 'ted', 'doc', 'boleto', 'outros')),
  paid_at TIMESTAMPTZ,
  registered_by UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bls_voyage_id ON public.bls(voyage_id);
CREATE INDEX IF NOT EXISTS idx_bls_customer_id ON public.bls(customer_id);
CREATE INDEX IF NOT EXISTS idx_bls_review_status ON public.bls(review_status);
CREATE INDEX IF NOT EXISTS idx_bls_financial_status ON public.bls(financial_status);
CREATE INDEX IF NOT EXISTS idx_bl_containers_bl_id ON public.bl_containers(bl_id);
CREATE INDEX IF NOT EXISTS idx_bl_containers_number ON public.bl_containers(container_number);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_import_errors_batch_id ON public.import_errors(batch_id);
