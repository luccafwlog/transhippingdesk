export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

type Row<T> = {
  Row: T
  Insert: Partial<T>
  Update: Partial<T>
  Relationships: []
}

export type UserProfileRole = 'admin' | 'operator' | 'administrativo' | 'financeiro' | 'operacoes' | 'documentacao'

export type UserProfile = {
  id: string
  full_name: string
  role: UserProfileRole
  active: boolean
  created_at: string | null
}

export type Customer = {
  id: number
  cnpj_cpf: string
  name: string
  trade_name: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  notes: string | null
  pending_balance: number | null
  payment_terms_days: number | null
  discount_pct: number | null
  commercial_notes: string | null
  created_at: string | null
  updated_at: string | null
}

export type CustomerContact = {
  id: number
  customer_id: number | null
  name: string | null
  email: string | null
  phone: string | null
  purpose: 'faturamento' | 'operacional' | 'financeiro' | 'geral' | null
  is_primary: boolean | null
  created_at: string | null
}

export type CustomerRateOverride = {
  id: number
  customer_id: number | null
  charge_item_id: number | null
  override_value: number
  valid_from: string | null
  valid_to: string | null
  notes: string | null
  created_at: string | null
}

export type ChargeTable = {
  id: number
  name: string
  cargo_mode: 'container' | 'carga_solta' | null
  pod: string | null
  carrier_id: number | null
  valid_from: string
  valid_to: string | null
  active: boolean | null
  notes: string | null
  created_at: string | null
}

export type ChargeTableItem = {
  id: number
  charge_table_id: number | null
  name: string
  category: 'base' | 'other_charge' | null
  application_basis: 'bl' | 'container_distinct_voyage' | 'weight_ton' | 'teu' | null
  applies_to: 'bl' | 'container' | 'teu'
  container_type: string | null
  cargo_profile: 'standard' | 'oog' | 'imo' | 'any' | null
  value_brl: number
  unit_value_brl: number | null
  unit_value_usd: number | null
  currency: 'BRL' | 'USD' | string | null
  manual_only: boolean | null
  active: boolean | null
  sort_order: number | null
  created_at: string | null
}

export type ChargeCalculation = {
  id: number
  bl_id: string | null
  manifest_id: number | null
  charge_table_id: number | null
  charge_item_id: number | null
  container_id: number | null
  billing_run_id: number | null
  pricing_rule_version_id: number | null
  quantity: number | null
  unit_value_brl: number | null
  unit_value_usd: number | null
  total_value_brl: number | null
  total_value_usd: number | null
  override_applied: boolean | null
  source: 'auto' | 'manual' | null
  status: 'calculated' | 'review_required' | 'reviewed' | 'ready_for_billing' | 'exempt' | null
  calculation_key: string | null
  notes: string | null
  manual_reason: string | null
  review_reason: string | null
  created_by: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  calculated_at: string | null
}

export type Carrier = {
  id: number
  name: string
  scac: string | null
  created_at: string | null
}

export type Vessel = {
  id: number
  name: string
  imo: string | null
  carrier_id: number | null
  created_at: string | null
}

export type Voyage = {
  id: number
  vessel_id: number | null
  voyage_number: string
  pol_id: number | null
  pod_id: number | null
  etd: string | null
  eta: string | null
  ata: string | null
  status: 'active' | 'completed' | 'cancelled' | null
  created_at: string | null
}

export type Port = {
  id: number
  name: string
  locode: string | null
  country: string | null
  created_at: string | null
}

export type BL = {
  id: string
  voyage_id: number | null
  batch_id: number | null
  cargo_mode: 'container' | 'carga_solta' | null
  ce_mercante: string | null
  bb_machine_qty: number | null
  bb_packages_qty: number | null
  bb_packages_total: number | null
  bb_weight_ton: number | null
  shipper: string | null
  consignee: string | null
  notify_party: string | null
  customer_id: number | null
  manifest_customer_cnpj_cpf: string | null
  manifest_customer_name: string | null
  manifest_customer_email: string | null
  customer_reconciliation_status:
    | 'matched_document'
    | 'matched_name'
    | 'missing_customer'
    | 'reconciled'
    | 'rejected'
    | null
  customer_reconciliation_notes: string | null
  billing_hold_reason: string | null
  last_billing_run_id: number | null
  pol: string | null
  pod: string | null
  place_of_delivery: string | null
  cargo_description: string | null
  total_weight_kg: number | null
  total_cbm: number | null
  incoterm: string | null
  payment_type: 'PREPAID' | 'COLLECT' | null
  financial_status: 'pending' | 'invoiced' | 'paid' | 'cancelled' | null
  review_status: 'ok' | 'pending_review' | 'reviewed' | null
  charge_status: 'not_calculated' | 'calculated' | 'review_required' | 'reviewed' | 'ready_for_billing' | 'exempt' | null
  charges_calculated_at: string | null
  charges_reviewed_at: string | null
  charge_exemption_reason: string | null
  container_load_type: 'FCL' | 'LCL' | null
  free_time_override: number | null
  demurrage_rate_override_p1_usd: number | null
  demurrage_rate_override_p2_usd: number | null
  demurrage_roe_manual: boolean | null
  demurrage_roe: number | null
  notes: string | null
  created_at: string | null
  updated_at: string | null
}

export type BLContainer = {
  id: number
  bl_id: string | null
  container_number: string
  seal_number: string | null
  type: string | null
  tare_weight_kg: number | null
  gross_weight_kg: number | null
  cbm: number | null
  is_oog: boolean | null
  is_imo: boolean | null
  imo_class: string | null
  un_number: string | null
  discharge_date: string | null
  return_date: string | null
  demurrage_status: 'within_free_time' | 'overdue' | 'returned' | null
  created_at: string | null
}

export type BLBreakbulkItem = {
  id: number
  bl_id: string | null
  item_description: string
  package_qty: number | null
  package_unit: string | null
  gross_weight_kg: number | null
  cbm: number | null
  marks: string | null
  created_at: string | null
}

export type Vehicle = {
  id: number
  voyage_id: number
  container_id: number
  bl_id: string
  chassis: string
  brand: string
  model: string
  weight_kg: number
  cbm: number
  created_at: string | null
}

export type ImportBatch = {
  id: number
  voyage_id: number | null
  cargo_mode: 'container' | 'carga_solta' | null
  filename: string
  uploaded_by: string | null
  uploaded_at: string | null
  status: 'processing' | 'completed' | 'partial' | 'failed' | null
  total_bls: number | null
  total_containers: number | null
  error_count: number | null
  ce_master: string | null
}

export type ImportError = {
  id: number
  batch_id: number | null
  row_number: number | null
  bl_number: string | null
  error_type: string
  error_message: string | null
  raw_data: Json | null
}

export type AuditLog = {
  id: number
  entity_type: string
  entity_id: string
  field_name: string
  old_value: string | null
  new_value: string | null
  changed_by: string | null
  changed_at: string | null
  justification: string | null
}

export type Alert = {
  id: number
  type: string
  entity_type: string | null
  entity_id: string | null
  message: string
  status: 'open' | 'acknowledged' | 'closed'
  assigned_to: string | null
  created_at: string | null
  closed_at: string | null
  notified_at: string | null
}

export type Invoice = {
  id: number
  invoice_number?: string
  customer_id: number | null
  bl_id: string | null
  issued_at: string | null
  due_date: string | null
  total_brl: number
  status: InvoiceDocumentStatus | null
  invoice_type: InvoiceDocumentType
  obsolete_reason: string | null
  covered_by_invoice_id: number | null
  replaced_by_invoice_id: number | null
  pix_payload: string | null
  pix_txid: string | null
  conciliated_by_extract: boolean | null
  notes: string | null
  total_paid_brl: number | null
  balance_brl: number | null
  issued_by: string | null
  cancelled_at: string | null
  cancelled_by: string | null
  cancel_reason: string | null
  updated_at: string | null
  created_at: string | null
}

export type InvoiceItem = {
  id: number
  invoice_id: number | null
  charge_calculation_id: number | null
  description: string
  quantity: number | null
  unit_value_brl: number | null
  total_value_brl: number
  bl_id: string | null
  manifest_id: number | null
  charge_table_id: number | null
  charge_item_id: number | null
  source: string | null
  currency: string | null
  unit_value_usd: number | null
  total_value_usd: number | null
  pricing_rule_version_id: number | null
  billing_run_id: number | null
  calculation_key: string | null
  snapshot_payload: Json | null
}

export type InvoicePayment = {
  id: number
  invoice_id: number | null
  amount_brl: number
  payment_method: 'pix' | 'ted' | 'doc' | 'boleto' | 'outros' | null
  paid_at: string | null
  registered_by: string | null
  notes: string | null
  created_at: string | null
}

export type InvoiceBlLink = {
  id: number
  invoice_id: number
  bl_id: string
  charge_status_snapshot: string | null
  financial_status_snapshot: string | null
  subtotal_brl: number
  subtotal_usd: number
  created_at: string | null
}

export type BlReceivableStatus = 'open' | 'partially_settled' | 'settled' | 'void'
export type InvoiceDocumentType = 'individual' | 'consolidated' | 'granite'
export type InvoiceDocumentStatus =
  | 'draft'
  | 'issued'
  | 'partially_paid'
  | 'paid'
  | 'covered'
  | 'obsolete'
  | 'overdue'
  | 'cancelled'

export type BlReceivable = {
  id: number
  bl_id: string
  customer_id: number
  source: 'local_charges'
  original_amount_brl: number
  settled_amount_brl: number
  balance_brl: number
  status: BlReceivableStatus
  voyage_id: number | null
  cargo_mode: 'container' | 'carga_solta' | string | null
  pol: string | null
  pod: string | null
  created_at: string | null
  updated_at: string | null
}

export type InvoiceReceivableLink = {
  id: number
  invoice_id: number
  receivable_id: number
  bl_id: string
  subtotal_brl: number
  status: 'active' | 'settled_by_this_invoice' | 'settled_elsewhere' | 'obsolete'
  bl_snapshot: Json
  created_at: string | null
}

export type LedgerSettlement = {
  id: number
  payment_id: number | null
  receivable_id: number
  invoice_id: number | null
  amount_brl: number
  settled_at: string | null
  method: string | null
  pix_txid: string | null
  source: 'manual' | 'pix_extract' | 'backfill'
  created_at: string | null
}

export type InvoiceLifecycleEvent = {
  id: number
  invoice_id: number
  event_type:
    | 'issued'
    | 'paid'
    | 'partially_paid'
    | 'covered'
    | 'obsolete'
    | 'cancelled'
    | 'reconciled_by_txid'
    | 'backfilled'
  related_invoice_id: number | null
  receivable_id: number | null
  payload: Json
  actor: string | null
  created_at: string | null
}

export type ConsolidatableReceivable = {
  receivable_id: number
  bl_id: string
  customer_id: number
  customer_name: string
  customer_cnpj_cpf: string
  voyage_id: number | null
  vessel_name: string | null
  voyage_number: string | null
  individual_invoice_id: number | null
  individual_invoice_number: string | null
  balance_brl: number
  original_amount_brl: number
  receivable_status: BlReceivableStatus
  eligibility_status: 'eligible' | 'paid' | 'no_balance' | 'open_consolidated'
  eligibility_reason: string
}

export type LedgerPaymentResult = {
  invoice_id: number
  payment_id: number
  status: 'paid'
  amount_brl: number
  receivables_settled: number
  individuals_covered: number
  consolidated_obsoleted: number
}

export type ConsolidatedInvoiceResult = {
  invoice_id: number
  invoice_number: string
  status: 'issued'
  invoice_type: 'consolidated'
  receivable_count: number
  total_brl: number
}

export type IndividualInvoiceResult = {
  invoice_id: number
  invoice_number: string
  status: string
  invoice_type: 'individual'
  receivable_id: number
  customer_id: number
  bl_count: number
  total_brl: number
  balance_brl: number
  existing: boolean
}

export type ReconcileByTxidResult = {
  matched: boolean
  reason?: string
  invoice_id?: number
  settled?: boolean
  payment?: LedgerPaymentResult
}

export type InvoiceGraniteBlLink = {
  id: number
  invoice_id: number
  granite_bl_id: string
  subtotal_brl: number
  created_at: string | null
}

export type InvoiceSummary = Invoice & {
  customer?: Pick<Customer, 'id' | 'name' | 'cnpj_cpf'> | null
  invoice_bls?: Pick<InvoiceBlLink, 'id' | 'bl_id' | 'subtotal_brl' | 'subtotal_usd'>[] | null
}

export type Database = {
  public: {
    Tables: {
      user_profiles: Row<UserProfile>
      audit_logs: Row<AuditLog>
      alerts: Row<Alert>
      customers: Row<Customer>
      customer_contacts: Row<CustomerContact>
      customer_rate_overrides: Row<CustomerRateOverride>
      charge_tables: Row<ChargeTable>
      charge_table_items: Row<ChargeTableItem>
      charge_calculations: Row<ChargeCalculation>
      carriers: Row<Carrier>
      vessels: Row<Vessel>
      ports: Row<Port>
      voyages: Row<Voyage>
      import_batches: Row<ImportBatch>
      import_errors: Row<ImportError>
      bls: Row<BL>
      bl_containers: Row<BLContainer>
      bl_breakbulk_items: Row<BLBreakbulkItem>
      vehicles: Row<Vehicle>
      invoices: Row<Invoice>
      invoice_items: Row<InvoiceItem>
      payments: Row<InvoicePayment>
      invoice_bls: Row<InvoiceBlLink>
      bl_receivables: Row<BlReceivable>
      invoice_receivable_links: Row<InvoiceReceivableLink>
      ledger_settlements: Row<LedgerSettlement>
      invoice_lifecycle_events: Row<InvoiceLifecycleEvent>
      invoice_granite_bls: Row<InvoiceGraniteBlLink>
      demurrage_invoices: Row<DemurrageInvoice>
      demurrage_invoice_items: Row<DemurrageInvoiceItem>
      demurrage_rates: Row<DemurrageRate>
      granite_manifests: Row<GraniteManifest>
      granite_bls: Row<GraniteBl>
      granite_rates: Row<GraniteRate>
      granite_bl_charges: Row<GraniteBlCharge>
      vazios_manifests: Row<VaziosManifest>
      vazios_bookings: Row<VaziosBooking>
      vazios_importacao_manifests: Row<VaziosImportacaoManifest>
      vazios_importacao_containers: Row<VaziosImportacaoContainer>
      voyage_export_schedules: Row<VoyageExportSchedule>
      vessel_schedules: Row<VesselSchedule>
      ended_vessels: Row<EndedVessel>
    }
    Views: Record<string, never>
    Functions: {
      import_manifest_transactional: {
        Args: {
          p_filename: string
          p_voyage_id: number
          p_uploaded_by: string
          p_cargo_mode: string
          p_file_hash: string | null
          p_total_bls: number
          p_total_containers: number
          p_bls: unknown
          p_containers: unknown
          p_errors: unknown
        }
        Returns: number
      }
      save_bl_review: {
        Args: {
          p_bl_id: string
          p_expected_updated_at: string | null
          p_update_payload: unknown
          p_audit_rows: unknown
          p_changed_by: string
        }
        Returns: Json
      }
      apply_bl_review_gate_after_import: {
        Args: {
          p_bl_ids: string[]
          p_changed_by: string
        }
        Returns: number
      }
      apply_ce_mercante_update: {
        Args: {
          p_bl_id: string
          p_new_ce: string
          p_changed_by: string | null
        }
        Returns: string
      }
      set_import_batch_ce_master: {
        Args: {
          p_batch_id: number
          p_ce_master: string | null
          p_changed_by: string | null
        }
        Returns: undefined
      }
      import_vazios_bookings_transactional: {
        Args: {
          p_voyage_id: number
          p_description: string | null
          p_uploaded_by: string
          p_bookings: Json
        }
        Returns: Json
      }
      import_vazios_importacao_transactional: {
        Args: {
          p_voyage_id: number
          p_description: string | null
          p_uploaded_by: string
          p_containers: Json
        }
        Returns: Json
      }
      replace_vazios_from_baplie_transactional: {
        Args: {
          p_voyage_id: number
          p_description: string | null
          p_uploaded_by: string
          p_replace_existing: boolean
        }
        Returns: Json
      }
      save_bl_demurrage_config: {
        Args: {
          p_bl_id: string
          p_expected_updated_at: string | null
          p_free_time_override: number | null
          p_rate_p1_usd: number | null
          p_rate_p2_usd: number | null
          p_changed_by: string
        }
        Returns: undefined
      }
      save_granite_bl_review: {
        Args: {
          p_granite_bl_id: string
          p_client_id: number
          p_changed_by: string
        }
        Returns: undefined
      }
      calculate_bl_local_charges: {
        Args: {
          p_bl_id: string
          p_actor: string | null
          p_recalculate: boolean
        }
        Returns: Json
      }
      list_bl_local_charge_lines: {
        Args: {
          p_bl_id: string
        }
        Returns: Array<{
          id: number
          bl_id: string
          charge_table_id: number | null
          charge_item_id: number | null
          charge_name: string
          source: string | null
          status: string | null
          quantity: number | null
          currency: string | null
          unit_value_brl: number | null
          unit_value_usd: number | null
          total_value_brl: number | null
          total_value_usd: number | null
          override_applied: boolean | null
          calculation_key: string | null
          notes: string | null
          review_reason: string | null
          calculated_at: string | null
        }>
      }
      list_manual_charge_items_for_bl: {
        Args: {
          p_bl_id: string
        }
        Returns: Array<{
          charge_item_id: number
          charge_item_name: string
          charge_table_id: number
          charge_table_name: string
          cargo_mode: string
          pod: string
          currency: string
          default_unit_value_brl: number | null
          default_unit_value_usd: number | null
          effective_unit_value_brl: number | null
          effective_unit_value_usd: number | null
        }>
      }
      add_manual_bl_charge: {
        Args: {
          p_bl_id: string
          p_charge_item_id: number
          p_quantity: number
          p_notes: string | null
          p_actor: string | null
        }
        Returns: Json
      }
      update_manual_bl_charge: {
        Args: {
          p_charge_calculation_id: number
          p_quantity: number
          p_notes: string | null
          p_actor: string | null
        }
        Returns: Json
      }
      delete_manual_bl_charge: {
        Args: {
          p_charge_calculation_id: number
          p_actor: string | null
        }
        Returns: Json
      }
      mark_bl_charges_reviewed: {
        Args: {
          p_bl_id: string
          p_actor: string | null
        }
        Returns: Json
      }
      mark_bl_ready_for_billing: {
        Args: {
          p_bl_id: string
          p_actor: string | null
        }
        Returns: Json
      }
      mark_bls_ready_and_create_invoice: {
        Args: {
          p_bl_ids: string[]
          p_customer_id: number
          p_due_date: string | null
          p_notes: string | null
          p_actor: string | null
        }
        Returns: Json
      }
      update_customer_with_audit: {
        Args: {
          p_customer_id: number
          p_updates: Json
          p_changed_by: string
          p_justification: string
        }
        Returns: boolean
      }
      create_customer_with_contacts: {
        Args: {
          p_customer: Json
          p_contacts: Json
        }
        Returns: Json
      }
      import_granite_manifest_transactional: {
        Args: {
          p_voyage_id: number
          p_vessel_voyage: string
          p_loading_port: string | null
          p_discharge_port: string | null
          p_total_bls: number
          p_total_weight_kg: number
          p_uploaded_by: string
          p_bls: Json
        }
        Returns: {
          manifest_id: string
          inserted_bls: number
        }
      }
      create_invoice_from_granite_bls: {
        Args: {
          p_granite_bl_ids: string[]
          p_customer_id: number | null
          p_due_date: string | null
          p_notes: string | null
          p_actor: string | null
        }
        Returns: Json
      }
      create_invoice_from_bls: {
        Args: {
          p_bl_ids: string[]
          p_customer_id: number | null
          p_due_date: string | null
          p_notes: string | null
          p_issue_now: boolean
          p_actor: string | null
        }
        Returns: Json
      }
      archive_vessel_schedule: {
        Args: {
          p_vessel_id: string
        }
        Returns: Json
      }
      reorder_vessel_schedules: {
        Args: {
          p_order: Json
        }
        Returns: number
      }
      sync_local_charge_receivable: {
        Args: {
          p_bl_id: string
        }
        Returns: number
      }
      create_local_individual_invoice_from_receivable: {
        Args: {
          p_receivable_id: number
          p_due_date: string | null
          p_notes: string | null
          p_actor: string | null
        }
        Returns: Json
      }
      link_invoice_to_ledger: {
        Args: {
          p_invoice_id: number
        }
        Returns: undefined
      }
      backfill_local_charge_receivables: {
        Args: {
          p_limit: number | null
        }
        Returns: Json
      }
      backfill_invoice_receivable_links: {
        Args: {
          p_limit: number | null
        }
        Returns: Json
      }
      list_consolidatable_receivables: {
        Args: {
          p_customer_id: number
          p_voyage_id: number | null
          p_search: string | null
        }
        Returns: ConsolidatableReceivable[]
      }
      register_ledger_invoice_payment: {
        Args: {
          p_invoice_id: number
          p_amount_brl: number
          p_method: string
          p_paid_at: string | null
          p_pix_txid: string | null
          p_source: string
          p_notes: string | null
          p_actor: string | null
        }
        Returns: Json
      }
      create_local_consolidated_invoice: {
        Args: {
          p_customer_id: number
          p_receivable_ids: number[]
          p_due_date?: string | null
          p_notes?: string | null
          p_actor?: string | null
        }
        Returns: Json
      }
      obsolete_consolidated_invoice: {
        Args: {
          p_invoice_id: number
          p_reason: string | null
          p_actor: string | null
        }
        Returns: Json
      }
      reconcile_invoice_payment_by_txid: {
        Args: {
          p_txid: string
          p_amount_brl: number
          p_paid_at: string | null
        }
        Returns: Json
      }
      run_billing_for_import_batch: {
        Args: {
          p_batch_id: number
          p_actor: string | null
          p_recalculate: boolean
        }
        Returns: Json
      }
      list_billing_runs: {
        Args: {
          p_limit: number | null
        }
        Returns: Json
      }
      get_billing_run_details: {
        Args: {
          p_billing_run_id: number
        }
        Returns: Json
      }
      list_customer_reconciliation_queue: {
        Args: {
          p_status: string | null
          p_limit: number | null
        }
        Returns: Json
      }
      approve_customer_reconciliation: {
        Args: {
          p_queue_id: number
          p_customer_id: number | null
          p_notes: string | null
          p_actor: string | null
        }
        Returns: Json
      }
      reject_customer_reconciliation: {
        Args: {
          p_queue_id: number
          p_notes: string | null
          p_actor: string | null
        }
        Returns: Json
      }
      get_customer_portal_account: {
        Args: {
          p_customer_id: number
        }
        Returns: Json
      }
      upsert_customer_portal_account: {
        Args: {
          p_customer_id: number
          p_password: string
          p_contact_email: string | null
          p_active: boolean
          p_actor: string | null
          p_login_cnpj: string | null
        }
        Returns: Json
      }
      set_customer_portal_account_active: {
        Args: {
          p_customer_id: number
          p_active: boolean
          p_actor: string | null
        }
        Returns: Json
      }
      portal_login: {
        Args: {
          p_cnpj_cpf: string
          p_password: string
        }
        Returns: Json
      }
      portal_logout: {
        Args: {
          p_session_token: string
        }
        Returns: Json
      }
      portal_get_session_overview: {
        Args: {
          p_session_token: string
        }
        Returns: Json
      }
      portal_get_session_overview_v2: {
        Args: Record<string, never>
        Returns: Json
      }
      portal_check_auth_method: {
        Args: {
          p_cnpj_cpf: string
        }
        Returns: Json
      }
      portal_list_consolidatable_receivables: {
        Args: Record<string, never>
        Returns: ConsolidatableReceivable[]
      }
      portal_obsolete_consolidation: {
        Args: {
          p_invoice_id: number
        }
        Returns: Json
      }
      current_portal_customer_id: {
        Args: Record<string, never>
        Returns: number
      }
      portal_list_invoices: {
        Args: Record<string, never>
        Returns: Json
      }
      portal_invoice_details: {
        Args: {
          p_invoice_id: number
        }
        Returns: Json
      }
      portal_create_consolidation: {
        Args: {
          p_receivable_ids: number[]
        }
        Returns: Json
      }
      register_invoice_payment: {
        Args: {
          p_invoice_id: number
          p_amount_brl: number
          p_payment_method: string
          p_paid_at: string | null
          p_notes: string | null
          p_actor: string | null
        }
        Returns: Json
      }
      cancel_invoice: {
        Args: {
          p_invoice_id: number
          p_reason: string | null
          p_actor: string | null
        }
        Returns: Json
      }
      add_manual_invoice_charge: {
        Args: {
          p_invoice_id: number
          p_description: string
          p_quantity: number
          p_unit_value_brl: number
          p_notes: string | null
          p_actor: string | null
        }
        Returns: Json
      }
      delete_manual_invoice_charge: {
        Args: {
          p_item_id: number
          p_actor: string | null
        }
        Returns: Json
      }
      list_invoice_details: {
        Args: {
          p_invoice_id: number
        }
        Returns: Json
      }
      detect_overdue_invoices: {
        Args: Record<string, never>
        Returns: number
      }
      portal_list_demurrage_invoices: {
        Args: Record<string, never>
        Returns: Json
      }
      portal_get_demurrage_invoice_detail: {
        Args: { p_invoice_id: number }
        Returns: Json
      }
      count_distinct_containers: {
        Args: Record<string, never>
        Returns: number
      }
      import_breakbulk_manifest_transactional: {
        Args: {
          p_filename: string
          p_voyage_id: number
          p_uploaded_by: string
          p_total_bls: number
          p_bls: Json
          p_items: Json
          p_errors: Json
        }
        Returns: Json
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type DemurrageCalcResult = {
  total_days: number
  free_days: number
  days_p1: number
  rate_p1_usd: number
  days_p2: number
  rate_p2_usd: number
  total_usd: number
  status: 'within_free_time' | 'overdue'
}

export type DemurrageInvoice = {
  id: number
  doc_number: string
  bl_id: string
  customer_id: number
  doc_date: string | null
  due_date: string | null
  billed_at: string | null
  first_billed_at: string | null
  paid_at: string | null
  ready_at: string | null
  total_usd: number
  roe: number | null
  roe_manual: boolean | null
  frozen_roe: number | null
  roe_source: 'bcb_live' | 'cached' | 'manual' | null
  frozen_total_brl: number | null
  discount_type: 'comercial' | 'datas' | 'cortesia' | 'acordo' | 'erro' | null
  discount_value: number | null
  discount_mode: 'percent' | 'fixed' | null
  discount_justification: string | null
  discount_approver: string | null
  dispute_open: boolean | null
  dispute_subject: string | null
  dispute_reason: string | null
  dispute_status: 'aberto' | 'resolvido' | 'cancelado' | null
  dispute_notes: string | null
  pix_payload: string | null
  pix_txid: string | null
  conciliated_by_extract: boolean | null
  status: 'draft' | 'issued' | 'paid' | 'overdue' | 'cancelled'
  notes: string | null
  created_at: string
  updated_at: string
}

export type RoeSource = NonNullable<DemurrageInvoice['roe_source']>

export type DemurrageInvoiceItem = {
  id: number
  invoice_id: number
  container_id: number
  container_number: string
  container_type: string
  discharge_date: string
  return_date: string
  total_days: number
  free_days: number
  days_p1: number
  rate_p1_usd: number
  days_p2: number
  rate_p2_usd: number
  subtotal_usd: number
  created_at: string
}

export type DemurrageRate = {
  id: number
  container_type: string
  free_days: number
  p1_day_from: number
  p1_day_to: number
  p1_usd: number
  p2_day_from: number
  p2_usd: number
  valid_from: string | null
  valid_to: string | null
  active: boolean
  notes: string | null
  created_at: string | null
  updated_at: string | null
}

export type DemurrageInvoiceDetail = DemurrageInvoice & {
  items: DemurrageInvoiceItem[]
  customer?: Pick<Customer, 'id' | 'name' | 'cnpj_cpf'> | null
  bl?: (Pick<BL, 'id' | 'pol' | 'pod'> & {
    voyage?: (Pick<Voyage, 'id' | 'voyage_number'> & {
      vessel?: Pick<Vessel, 'id' | 'name'> | null
    }) | null
  }) | null
}

export type DemurrageContainerListItem = Pick<
  BLContainer,
  'id' | 'bl_id' | 'container_number' | 'type' | 'discharge_date' | 'return_date' | 'demurrage_status'
> & {
  bl?: (Pick<BL, 'id' | 'pol' | 'pod' | 'free_time_override' | 'demurrage_rate_override_p1_usd' | 'demurrage_rate_override_p2_usd' | 'demurrage_roe_manual' | 'demurrage_roe'> & {
    customer?: Pick<Customer, 'id' | 'name' | 'cnpj_cpf'> | null
    voyage?: (Pick<Voyage, 'id' | 'voyage_number'> & {
      vessel?: Pick<Vessel, 'id' | 'name'> | null
    }) | null
  }) | null
}

export type PixTransaction = {
  txid: string
  cnpj: string
  date: string
  amount: number
}

export type BLListItem = BL & {
  customer?: Pick<Customer, 'id' | 'cnpj_cpf' | 'name'> | null
  voyage?: (Pick<Voyage, 'id' | 'voyage_number' | 'eta' | 'ata' | 'status'> & {
    vessel?: (Pick<Vessel, 'id' | 'name'> & {
      carrier?: Pick<Carrier, 'id' | 'name' | 'scac'> | null
    }) | null
  }) | null
  bl_containers?: Pick<
    BLContainer,
    | 'id'
    | 'bl_id'
    | 'container_number'
    | 'seal_number'
    | 'type'
    | 'tare_weight_kg'
    | 'gross_weight_kg'
    | 'cbm'
    | 'is_oog'
    | 'is_imo'
    | 'imo_class'
    | 'un_number'
    | 'created_at'
  >[]
  bl_breakbulk_items?: Pick<
    BLBreakbulkItem,
    'id' | 'bl_id' | 'item_description' | 'package_qty' | 'package_unit' | 'gross_weight_kg' | 'cbm' | 'marks' | 'created_at'
  >[]
}

export type BLDetail = BL & {
  customer?: Customer | null
  voyage?: (Voyage & {
    vessel?: (Vessel & {
      carrier?: Carrier | null
    }) | null
  }) | null
  bl_containers?: BLContainer[]
  bl_breakbulk_items?: BLBreakbulkItem[]
  vehicles?: VehicleListItem[] | null
}

export type ContainerListItem = Pick<
  BLContainer,
  | 'id'
  | 'bl_id'
  | 'container_number'
  | 'seal_number'
  | 'type'
  | 'tare_weight_kg'
  | 'gross_weight_kg'
  | 'cbm'
  | 'is_oog'
  | 'is_imo'
  | 'imo_class'
  | 'un_number'
  | 'created_at'
> & {
  bl?: (Pick<BL, 'id' | 'pol' | 'pod' | 'review_status' | 'financial_status' | 'charge_status' | 'consignee'> & {
    customer?: Pick<Customer, 'id' | 'cnpj_cpf' | 'name'> | null
    voyage?: (Pick<Voyage, 'id' | 'voyage_number' | 'eta' | 'ata' | 'status'> & {
      vessel?: (Pick<Vessel, 'id' | 'name'> & {
        carrier?: Pick<Carrier, 'id' | 'name' | 'scac'> | null
      }) | null
    }) | null
  }) | null
}

export type CustomerListItem = Customer & {
  bls?: Pick<BL, 'id' | 'charge_status'>[] | null
  customer_contacts?: Pick<CustomerContact, 'id' | 'email' | 'purpose' | 'is_primary'>[] | null
}

export type CustomerDetail = Customer & {
  customer_contacts?: CustomerContact[] | null
  bls?: Pick<BL, 'id' | 'consignee' | 'financial_status' | 'review_status' | 'created_at'>[] | null
  invoices?: Pick<Invoice, 'id' | 'invoice_number' | 'issued_at' | 'due_date' | 'total_brl' | 'balance_brl' | 'status'>[] | null
  invoices_access_denied?: boolean
}

export type VehicleListItem = Vehicle & {
  container?: Pick<BLContainer, 'id' | 'container_number' | 'type' | 'seal_number'> | null
  bl?: (Pick<BL, 'id' | 'voyage_id'> & {
    voyage?: (Pick<Voyage, 'id' | 'voyage_number'> & {
      vessel?: Pick<Vessel, 'id' | 'name'> | null
    }) | null
  }) | null
}

// ---------------------------------------------------------------------------
// Granite module
// ---------------------------------------------------------------------------

export type GraniteManifest = {
  id: string
  voyage_id: number | null
  vessel_voyage: string
  loading_port: string | null
  discharge_port: string | null
  total_bls: number | null
  total_weight_kg: number | null
  imported_at: string | null
  imported_by: string | null
}

export type GraniteBl = {
  id: string
  manifest_id: string
  client_id: number | null
  sequence: number | null
  booking_number: string | null
  bl_number: string
  shipper_ref: string | null
  vessel_voyage: string | null
  loading_port: string | null
  discharge_port: string | null
  shipper_name: string | null
  shipper_cnpj: string | null
  consignee_name: string | null
  charter: string | null
  shipper_m3: number | null
  shipper_weight_kg: number | null
  blocks_qty: number | null
  received_blocks_qty: number | null
  final_m3: number | null
  real_weight_kg: number | null
  stockyard: string | null
  remarks: string | null
  partial_restriction: boolean | null
  cosco_transport: string | null
  fragile_blocks: number | null
  cssc_selection: string | null
  cargo_readiness_date: string | null
  phase: string | null
  charge_status: 'not_calculated' | 'calculated' | 'ready_for_billing' | 'invoiced'
  created_at: string | null
}

export type GraniteRate = {
  id: string
  description: string
  charge_type: 'per_kg' | 'per_ton' | 'per_bl' | 'fixed'
  unit_value: number
  currency: string
  valid_from: string | null
  valid_to: string | null
  active: boolean
  created_at: string | null
}

export type GraniteBlCharge = {
  id: string
  bl_id: string
  rate_id: string | null
  description: string | null
  charge_type: string | null
  unit_value: number | null
  quantity: number | null
  subtotal: number | null
  currency: string | null
  calculated_at: string | null
}

export type GraniteBlListItem = GraniteBl & {
  manifest?: Pick<GraniteManifest, 'id' | 'vessel_voyage' | 'voyage_id'> | null
  customer?: Pick<Customer, 'id' | 'name'> | null
}

// ---------------------------------------------------------------------------
// Vazios module
// ---------------------------------------------------------------------------

export type VaziosManifest = {
  id: string
  voyage_id: number | null
  description: string | null
  total_bookings: number | null
  imported_at: string | null
  imported_by: string | null
}

export type VaziosBooking = {
  id: string
  manifest_id: string
  booking_number: string
  container_number: string | null
  container_type: string | null
  movement_date: string | null
  origin_terminal: string | null
  destination: string | null
  notes: string | null
  created_at: string | null
}

export type VaziosBookingListItem = VaziosBooking & {
  manifest?: Pick<VaziosManifest, 'id' | 'voyage_id'> & {
    voyage?: Pick<Voyage, 'id' | 'voyage_number'> & {
      vessel?: Pick<Vessel, 'id' | 'name'> | null
    } | null
  } | null
}

// ---------------------------------------------------------------------------
// Vazios Importacao module
// ---------------------------------------------------------------------------

export type VaziosImportacaoManifest = {
  id: string
  voyage_id: number | null
  description: string | null
  total_containers: number | null
  imported_at: string
  imported_by: string | null
}

export type VaziosImportacaoContainer = {
  id: string
  manifest_id: string
  container_number: string
  container_type: string | null
  tare_kg: number | null
  pod: string | null
  created_at: string | null
}

export type VaziosImportacaoContainerListItem = VaziosImportacaoContainer & {
  manifest?: (Pick<VaziosImportacaoManifest, 'id' | 'voyage_id' | 'description' | 'imported_at'> & {
    voyage?: { voyage_number: string; vessel: { name: string } | null } | null
  }) | null
}

export type BaplieContainer = {
  id: number
  voyage_id: number
  container_number: string
  size_type: string | null
  status: string | null
  weight_kg: number | null
  pol: string | null
  pod: string | null
  final_dest: string | null
  bl_ref: string | null
  slot: string | null
  is_imo: boolean
  imo_class: string | null
  un_number: string | null
  is_oog: boolean
  imported_at: string
  imported_by: string | null
}


export type VoyageExportSchedule = {
  id: string
  voyage_id: number
  has_granite: boolean
  containers_qty: number | null
  movements_qty: number | null
  eta: string | null
  etb: string | null
  ce_status: 'waiting' | 'received' | 'launching' | 'approving' | 'approved' | null
  linked: boolean
  pol: string | null
  created_at: string | null
  updated_at: string | null
}

export type VoyageExportCeStatus = NonNullable<VoyageExportSchedule['ce_status']>

export type VesselSchedule = {
  id: string
  vessel_name: string
  voyage: string
  imo_number: string | null
  qingdao_etd: string
  shanghai_etd: string
  taicang_etd: string
  ningbo_etd: string
  nansha_etd: string
  salvador_eta: string
  vitoria_eta: string
  pecem_eta: string | null
  display_order: number | null
  created_at: string
  updated_at: string
}

export type EndedVessel = {
  id: string
  original_id: string | null
  vessel_name: string
  voyage: string
  imo_number: string | null
  qingdao_etd: string
  shanghai_etd: string
  taicang_etd: string
  ningbo_etd: string
  nansha_etd: string
  salvador_eta: string
  vitoria_eta: string
  pecem_eta: string | null
  ended_at: string
  created_at: string
}
