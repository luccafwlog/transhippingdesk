export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

type Row<T> = {
  Row: T
  Insert: Partial<T>
  Update: Partial<T>
  Relationships: []
}

export type UserProfile = {
  id: string
  full_name: string
  role: 'admin' | 'operator'
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
  free_time_override: number | null
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
  status: 'issued' | 'paid' | 'cancelled' | 'overdue' | null
  pix_payload: string | null
  notes: string | null
  cancelled_at: string | null
  cancelled_by: string | null
  created_at: string | null
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
        Returns: string | null
      }
      apply_ce_mercante_update: {
        Args: {
          p_bl_id: string
          p_new_ce: string
          p_changed_by: string | null
        }
        Returns: string
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
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
  bl?: (Pick<BL, 'id' | 'pol' | 'pod' | 'review_status' | 'financial_status' | 'consignee'> & {
    customer?: Pick<Customer, 'id' | 'cnpj_cpf' | 'name'> | null
    voyage?: (Pick<Voyage, 'id' | 'voyage_number' | 'eta' | 'ata' | 'status'> & {
      vessel?: (Pick<Vessel, 'id' | 'name'> & {
        carrier?: Pick<Carrier, 'id' | 'name' | 'scac'> | null
      }) | null
    }) | null
  }) | null
}

export type CustomerListItem = Customer & {
  bls?: Pick<BL, 'id'>[] | null
  customer_contacts?: Pick<CustomerContact, 'id'>[] | null
}

export type CustomerDetail = Customer & {
  customer_contacts?: CustomerContact[] | null
  bls?: Pick<BL, 'id' | 'consignee' | 'financial_status' | 'review_status' | 'created_at'>[] | null
  invoices?: Pick<Invoice, 'id' | 'invoice_number' | 'issued_at' | 'due_date' | 'total_brl' | 'status'>[] | null
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
