export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agency_departure_report_department_signoffs: {
        Row: {
          department: string
          id: string
          report_id: string
          signed_at: string | null
          signed_by: string | null
        }
        Insert: {
          department: string
          id?: string
          report_id: string
          signed_at?: string | null
          signed_by?: string | null
        }
        Update: {
          department?: string
          id?: string
          report_id?: string
          signed_at?: string | null
          signed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agency_departure_report_department_signoffs_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "agency_departure_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_departure_report_occurrences: {
        Row: {
          author_id: string
          body: string
          created_at: string
          department: string
          id: string
          report_id: string
          section: string | null
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          department: string
          id?: string
          report_id: string
          section?: string | null
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          department?: string
          id?: string
          report_id?: string
          section?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agency_departure_report_occurrences_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "agency_departure_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_departure_report_signoffs: {
        Row: {
          department: string
          id: string
          observation: string | null
          report_id: string
          section: string
          signed_at: string | null
          signed_by: string | null
          state: string
        }
        Insert: {
          department: string
          id?: string
          observation?: string | null
          report_id: string
          section: string
          signed_at?: string | null
          signed_by?: string | null
          state?: string
        }
        Update: {
          department?: string
          id?: string
          observation?: string | null
          report_id?: string
          section?: string
          signed_at?: string | null
          signed_by?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_departure_report_signoffs_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "agency_departure_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_departure_reports: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          closed_snapshot: Json | null
          created_at: string
          id: string
          port: string
          status: string
          terminal: string | null
          voyage_id: number
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          closed_snapshot?: Json | null
          created_at?: string
          id?: string
          port: string
          status?: string
          terminal?: string | null
          voyage_id: number
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          closed_snapshot?: Json | null
          created_at?: string
          id?: string
          port?: string
          status?: string
          terminal?: string | null
          voyage_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "agency_departure_reports_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_report_pending_baselines: {
        Row: {
          baseline_key: string
          captured_at: string
        }
        Insert: {
          baseline_key: string
          captured_at: string
        }
        Update: {
          baseline_key?: string
          captured_at?: string
        }
        Relationships: []
      }
      alerts: {
        Row: {
          assigned_to: string | null
          closed_at: string | null
          created_at: string | null
          entity_id: string | null
          entity_type: string | null
          id: number
          message: string
          notified_at: string | null
          status: string
          type: string
        }
        Insert: {
          assigned_to?: string | null
          closed_at?: string | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: number
          message: string
          notified_at?: string | null
          status?: string
          type: string
        }
        Update: {
          assigned_to?: string | null
          closed_at?: string | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: number
          message?: string
          notified_at?: string | null
          status?: string
          type?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          actor_department: string | null
          actor_role: string | null
          changed_at: string | null
          changed_by: string | null
          entity_id: string
          entity_type: string
          field_name: string
          id: number
          justification: string | null
          new_value: string | null
          old_value: string | null
        }
        Insert: {
          actor_department?: string | null
          actor_role?: string | null
          changed_at?: string | null
          changed_by?: string | null
          entity_id: string
          entity_type: string
          field_name: string
          id?: number
          justification?: string | null
          new_value?: string | null
          old_value?: string | null
        }
        Update: {
          actor_department?: string | null
          actor_role?: string | null
          changed_at?: string | null
          changed_by?: string | null
          entity_id?: string
          entity_type?: string
          field_name?: string
          id?: number
          justification?: string | null
          new_value?: string | null
          old_value?: string | null
        }
        Relationships: []
      }
      baplie_containers: {
        Row: {
          bl_ref: string | null
          container_number: string
          final_dest: string | null
          id: number
          imo_class: string | null
          imported_at: string
          imported_by: string | null
          is_imo: boolean
          is_oog: boolean
          pod: string | null
          pol: string | null
          size_type: string | null
          slot: string | null
          status: string | null
          un_number: string | null
          voyage_id: number
          weight_kg: number | null
        }
        Insert: {
          bl_ref?: string | null
          container_number: string
          final_dest?: string | null
          id?: never
          imo_class?: string | null
          imported_at?: string
          imported_by?: string | null
          is_imo?: boolean
          is_oog?: boolean
          pod?: string | null
          pol?: string | null
          size_type?: string | null
          slot?: string | null
          status?: string | null
          un_number?: string | null
          voyage_id: number
          weight_kg?: number | null
        }
        Update: {
          bl_ref?: string | null
          container_number?: string
          final_dest?: string | null
          id?: never
          imo_class?: string | null
          imported_at?: string
          imported_by?: string | null
          is_imo?: boolean
          is_oog?: boolean
          pod?: string | null
          pol?: string | null
          size_type?: string | null
          slot?: string | null
          status?: string | null
          un_number?: string | null
          voyage_id?: number
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "baplie_containers_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      baplie_reconciliation_resolutions: {
        Row: {
          baplie_value: string
          bl_container_id: number
          field_name: string
          id: number
          manifest_value: string
          resolution: string
          resolved_at: string
          resolved_by: string | null
          voyage_id: number
        }
        Insert: {
          baplie_value: string
          bl_container_id: number
          field_name: string
          id?: never
          manifest_value: string
          resolution?: string
          resolved_at?: string
          resolved_by?: string | null
          voyage_id: number
        }
        Update: {
          baplie_value?: string
          bl_container_id?: number
          field_name?: string
          id?: never
          manifest_value?: string
          resolution?: string
          resolved_at?: string
          resolved_by?: string | null
          voyage_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "baplie_reconciliation_resolutions_bl_container_id_fkey"
            columns: ["bl_container_id"]
            isOneToOne: false
            referencedRelation: "bl_containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "baplie_reconciliation_resolutions_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_batches: {
        Row: {
          created_at: string
          customer_id: number
          id: number
          invoice_id: number | null
          notes: string | null
          origin: string
          portal_account_id: number | null
          requested_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id: number
          id?: number
          invoice_id?: number | null
          notes?: string | null
          origin?: string
          portal_account_id?: number | null
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: number
          id?: number
          invoice_id?: number | null
          notes?: string | null
          origin?: string
          portal_account_id?: number | null
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_batches_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_batches_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_batches_portal_account_id_fkey"
            columns: ["portal_account_id"]
            isOneToOne: false
            referencedRelation: "customer_portal_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_run_logs: {
        Row: {
          billing_run_id: number
          bl_id: string | null
          code: string
          created_at: string
          details: Json
          id: number
          level: string
          manifest_id: number
          message: string
        }
        Insert: {
          billing_run_id: number
          bl_id?: string | null
          code: string
          created_at?: string
          details?: Json
          id?: number
          level?: string
          manifest_id: number
          message: string
        }
        Update: {
          billing_run_id?: number
          bl_id?: string | null
          code?: string
          created_at?: string
          details?: Json
          id?: number
          level?: string
          manifest_id?: number
          message?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_run_logs_billing_run_id_fkey"
            columns: ["billing_run_id"]
            isOneToOne: false
            referencedRelation: "billing_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_run_logs_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: false
            referencedRelation: "bls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_run_logs_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_runs: {
        Row: {
          blocked_bls: number
          calculated_bls: number
          completed_at: string | null
          created_at: string
          eligible_bls: number
          id: number
          input_hash: string | null
          manifest_id: number
          requested_by: string | null
          started_at: string
          status: string
          summary: Json
          total_bls: number
          total_brl: number
          total_usd: number
          trigger_source: string
        }
        Insert: {
          blocked_bls?: number
          calculated_bls?: number
          completed_at?: string | null
          created_at?: string
          eligible_bls?: number
          id?: number
          input_hash?: string | null
          manifest_id: number
          requested_by?: string | null
          started_at?: string
          status?: string
          summary?: Json
          total_bls?: number
          total_brl?: number
          total_usd?: number
          trigger_source?: string
        }
        Update: {
          blocked_bls?: number
          calculated_bls?: number
          completed_at?: string | null
          created_at?: string
          eligible_bls?: number
          id?: number
          input_hash?: string | null
          manifest_id?: number
          requested_by?: string | null
          started_at?: string
          status?: string
          summary?: Json
          total_bls?: number
          total_brl?: number
          total_usd?: number
          trigger_source?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_runs_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      bl_breakbulk_items: {
        Row: {
          bl_id: string
          cbm: number | null
          created_at: string | null
          gross_weight_kg: number | null
          id: number
          item_description: string
          marks: string | null
          package_qty: number | null
          package_unit: string | null
        }
        Insert: {
          bl_id: string
          cbm?: number | null
          created_at?: string | null
          gross_weight_kg?: number | null
          id?: number
          item_description: string
          marks?: string | null
          package_qty?: number | null
          package_unit?: string | null
        }
        Update: {
          bl_id?: string
          cbm?: number | null
          created_at?: string | null
          gross_weight_kg?: number | null
          id?: number
          item_description?: string
          marks?: string | null
          package_qty?: number | null
          package_unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bl_breakbulk_items_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: false
            referencedRelation: "bls"
            referencedColumns: ["id"]
          },
        ]
      }
      bl_containers: {
        Row: {
          bl_id: string
          cbm: number | null
          container_number: string
          created_at: string | null
          demurrage_status: string | null
          discharge_date: string | null
          gross_weight_kg: number | null
          id: number
          imo_class: string | null
          is_imo: boolean | null
          is_oog: boolean | null
          return_date: string | null
          seal_number: string | null
          tare_weight_kg: number | null
          type: string | null
          un_number: string | null
          unpacking_location: string | null
        }
        Insert: {
          bl_id: string
          cbm?: number | null
          container_number: string
          created_at?: string | null
          demurrage_status?: string | null
          discharge_date?: string | null
          gross_weight_kg?: number | null
          id?: number
          imo_class?: string | null
          is_imo?: boolean | null
          is_oog?: boolean | null
          return_date?: string | null
          seal_number?: string | null
          tare_weight_kg?: number | null
          type?: string | null
          un_number?: string | null
          unpacking_location?: string | null
        }
        Update: {
          bl_id?: string
          cbm?: number | null
          container_number?: string
          created_at?: string | null
          demurrage_status?: string | null
          discharge_date?: string | null
          gross_weight_kg?: number | null
          id?: number
          imo_class?: string | null
          is_imo?: boolean | null
          is_oog?: boolean | null
          return_date?: string | null
          seal_number?: string | null
          tare_weight_kg?: number | null
          type?: string | null
          un_number?: string | null
          unpacking_location?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bl_containers_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: false
            referencedRelation: "bls"
            referencedColumns: ["id"]
          },
        ]
      }
      bl_freight_lines: {
        Row: {
          amount: number | null
          bl_id: string
          category: string | null
          currency: string | null
          description: string | null
          mercante_code: string | null
          payment: string | null
          seq: number
        }
        Insert: {
          amount?: number | null
          bl_id: string
          category?: string | null
          currency?: string | null
          description?: string | null
          mercante_code?: string | null
          payment?: string | null
          seq: number
        }
        Update: {
          amount?: number | null
          bl_id?: string
          category?: string | null
          currency?: string | null
          description?: string | null
          mercante_code?: string | null
          payment?: string | null
          seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "bl_freight_lines_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: false
            referencedRelation: "bls"
            referencedColumns: ["id"]
          },
        ]
      }
      cod_adjustments: {
        Row: {
          action: string
          bl_id: string
          created_at: string
          created_by: string | null
          difference_brl: number
          id: number
          manual_review_required: boolean
          new_destination_value_brl: number
          offset_amount_brl: number
          omission_id: number
          original_value_brl: number
          outstanding_balance_brl: number
          paid_amount_brl: number
          refund_amount_brl: number
          resulting_document_id: number | null
          resulting_document_type: string | null
          status: string
        }
        Insert: {
          action: string
          bl_id: string
          created_at?: string
          created_by?: string | null
          difference_brl?: number
          id?: number
          manual_review_required?: boolean
          new_destination_value_brl?: number
          offset_amount_brl?: number
          omission_id: number
          original_value_brl?: number
          outstanding_balance_brl?: number
          paid_amount_brl?: number
          refund_amount_brl?: number
          resulting_document_id?: number | null
          resulting_document_type?: string | null
          status?: string
        }
        Update: {
          action?: string
          bl_id?: string
          created_at?: string
          created_by?: string | null
          difference_brl?: number
          id?: number
          manual_review_required?: boolean
          new_destination_value_brl?: number
          offset_amount_brl?: number
          omission_id?: number
          original_value_brl?: number
          outstanding_balance_brl?: number
          paid_amount_brl?: number
          refund_amount_brl?: number
          resulting_document_id?: number | null
          resulting_document_type?: string | null
          status?: string
        }
        Relationships: []
      }
      bl_receivables: {
        Row: {
          balance_brl: number
          bl_id: string
          cargo_mode: string | null
          created_at: string
          customer_id: number
          id: number
          original_amount_brl: number
          pod: string | null
          pol: string | null
          settled_amount_brl: number
          source: string
          status: string
          updated_at: string
          voyage_id: number | null
        }
        Insert: {
          balance_brl?: number
          bl_id: string
          cargo_mode?: string | null
          created_at?: string
          customer_id: number
          id?: number
          original_amount_brl?: number
          pod?: string | null
          pol?: string | null
          settled_amount_brl?: number
          source?: string
          status?: string
          updated_at?: string
          voyage_id?: number | null
        }
        Update: {
          balance_brl?: number
          bl_id?: string
          cargo_mode?: string | null
          created_at?: string
          customer_id?: number
          id?: number
          original_amount_brl?: number
          pod?: string | null
          pol?: string | null
          settled_amount_brl?: number
          source?: string
          status?: string
          updated_at?: string
          voyage_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bl_receivables_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: false
            referencedRelation: "bls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bl_receivables_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bl_receivables_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      bl_transshipments: {
        Row: {
          bl_id: string
          created_at: string
          created_by: string | null
          disposition: string
          id: number
          omission_id: number
          updated_at: string
        }
        Insert: {
          bl_id: string
          created_at?: string
          created_by?: string | null
          disposition?: string
          id?: number
          omission_id: number
          updated_at?: string
        }
        Update: {
          bl_id?: string
          created_at?: string
          created_by?: string | null
          disposition?: string
          id?: number
          omission_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bl_transshipments_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: false
            referencedRelation: "bls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bl_transshipments_omission_id_fkey"
            columns: ["omission_id"]
            isOneToOne: false
            referencedRelation: "voyage_omissions"
            referencedColumns: ["id"]
          },
        ]
      }
      bls: {
        Row: {
          batch_id: number | null
          bb_machine_qty: number | null
          bb_packages_qty: number | null
          bb_packages_total: number | null
          bb_weight_ton: number | null
          billing_hold_reason: string | null
          bl_emission_date: string | null
          cargo_description: string | null
          cargo_mode: string
          ce_mercante: string | null
          charge_exemption_reason: string | null
          charge_status: string | null
          charges_calculated_at: string | null
          charges_reviewed_at: string | null
          consignee: string | null
          consignee_address: string | null
          consignee_block: string | null
          consignee_phone: string | null
          container_load_type: string | null
          created_at: string | null
          customer_id: number | null
          customer_reconciliation_notes: string | null
          customer_reconciliation_status: string | null
          demurrage_rate_override_p1_usd: number | null
          demurrage_rate_override_p2_usd: number | null
          demurrage_roe: number | null
          demurrage_roe_manual: boolean | null
          financial_status: string | null
          free_time_override: number | null
          id: string
          incoterm: string | null
          issue_place: string | null
          last_billing_run_id: number | null
          manifest_customer_cnpj_cpf: string | null
          manifest_customer_email: string | null
          manifest_customer_name: string | null
          movement_from: string | null
          movement_to: string | null
          notes: string | null
          notify_block: string | null
          notify_cnpj_cpf: string | null
          notify_party: string | null
          notify2_block: string | null
          packages_unit: string | null
          payment_type: string | null
          place_of_delivery: string | null
          place_of_receipt: string | null
          pod: string | null
          pol: string | null
          review_status: string | null
          shipper: string | null
          shipper_block: string | null
          total_cbm: number | null
          total_packages: number | null
          total_weight_kg: number | null
          updated_at: string | null
          voyage_id: number
        }
        Insert: {
          batch_id?: number | null
          bb_machine_qty?: number | null
          bb_packages_qty?: number | null
          bb_packages_total?: number | null
          bb_weight_ton?: number | null
          billing_hold_reason?: string | null
          bl_emission_date?: string | null
          cargo_description?: string | null
          cargo_mode?: string
          ce_mercante?: string | null
          charge_exemption_reason?: string | null
          charge_status?: string | null
          charges_calculated_at?: string | null
          charges_reviewed_at?: string | null
          consignee?: string | null
          consignee_address?: string | null
          consignee_block?: string | null
          consignee_phone?: string | null
          container_load_type?: string | null
          created_at?: string | null
          customer_id?: number | null
          customer_reconciliation_notes?: string | null
          customer_reconciliation_status?: string | null
          demurrage_rate_override_p1_usd?: number | null
          demurrage_rate_override_p2_usd?: number | null
          demurrage_roe?: number | null
          demurrage_roe_manual?: boolean | null
          financial_status?: string | null
          free_time_override?: number | null
          id: string
          incoterm?: string | null
          issue_place?: string | null
          last_billing_run_id?: number | null
          manifest_customer_cnpj_cpf?: string | null
          manifest_customer_email?: string | null
          manifest_customer_name?: string | null
          movement_from?: string | null
          movement_to?: string | null
          notes?: string | null
          notify_block?: string | null
          notify_cnpj_cpf?: string | null
          notify_party?: string | null
          notify2_block?: string | null
          packages_unit?: string | null
          payment_type?: string | null
          place_of_delivery?: string | null
          place_of_receipt?: string | null
          pod?: string | null
          pol?: string | null
          review_status?: string | null
          shipper?: string | null
          shipper_block?: string | null
          total_cbm?: number | null
          total_packages?: number | null
          total_weight_kg?: number | null
          updated_at?: string | null
          voyage_id: number
        }
        Update: {
          batch_id?: number | null
          bb_machine_qty?: number | null
          bb_packages_qty?: number | null
          bb_packages_total?: number | null
          bb_weight_ton?: number | null
          billing_hold_reason?: string | null
          bl_emission_date?: string | null
          cargo_description?: string | null
          cargo_mode?: string
          ce_mercante?: string | null
          charge_exemption_reason?: string | null
          charge_status?: string | null
          charges_calculated_at?: string | null
          charges_reviewed_at?: string | null
          consignee?: string | null
          consignee_address?: string | null
          consignee_block?: string | null
          consignee_phone?: string | null
          container_load_type?: string | null
          created_at?: string | null
          customer_id?: number | null
          customer_reconciliation_notes?: string | null
          customer_reconciliation_status?: string | null
          demurrage_rate_override_p1_usd?: number | null
          demurrage_rate_override_p2_usd?: number | null
          demurrage_roe?: number | null
          demurrage_roe_manual?: boolean | null
          financial_status?: string | null
          free_time_override?: number | null
          id?: string
          incoterm?: string | null
          issue_place?: string | null
          last_billing_run_id?: number | null
          manifest_customer_cnpj_cpf?: string | null
          manifest_customer_email?: string | null
          manifest_customer_name?: string | null
          movement_from?: string | null
          movement_to?: string | null
          notes?: string | null
          notify_block?: string | null
          notify_cnpj_cpf?: string | null
          notify_party?: string | null
          notify2_block?: string | null
          packages_unit?: string | null
          payment_type?: string | null
          place_of_delivery?: string | null
          place_of_receipt?: string | null
          pod?: string | null
          pol?: string | null
          review_status?: string | null
          shipper?: string | null
          shipper_block?: string | null
          total_cbm?: number | null
          total_packages?: number | null
          total_weight_kg?: number | null
          updated_at?: string | null
          voyage_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "bls_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bls_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bls_last_billing_run_id_fkey"
            columns: ["last_billing_run_id"]
            isOneToOne: false
            referencedRelation: "billing_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bls_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      carriers: {
        Row: {
          created_at: string | null
          id: number
          name: string
          scac: string | null
        }
        Insert: {
          created_at?: string | null
          id?: number
          name: string
          scac?: string | null
        }
        Update: {
          created_at?: string | null
          id?: number
          name?: string
          scac?: string | null
        }
        Relationships: []
      }
      charge_calculations: {
        Row: {
          billing_run_id: number | null
          bl_id: string | null
          calculated_at: string | null
          calculation_key: string | null
          charge_item_id: number | null
          charge_table_id: number | null
          container_id: number | null
          created_by: string | null
          id: number
          manifest_id: number | null
          manual_reason: string | null
          notes: string | null
          override_applied: boolean | null
          pricing_rule_version_id: number | null
          quantity: number | null
          review_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source: string | null
          status: string | null
          total_value_brl: number | null
          total_value_usd: number | null
          unit_value_brl: number | null
          unit_value_usd: number | null
        }
        Insert: {
          billing_run_id?: number | null
          bl_id?: string | null
          calculated_at?: string | null
          calculation_key?: string | null
          charge_item_id?: number | null
          charge_table_id?: number | null
          container_id?: number | null
          created_by?: string | null
          id?: number
          manifest_id?: number | null
          manual_reason?: string | null
          notes?: string | null
          override_applied?: boolean | null
          pricing_rule_version_id?: number | null
          quantity?: number | null
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string | null
          status?: string | null
          total_value_brl?: number | null
          total_value_usd?: number | null
          unit_value_brl?: number | null
          unit_value_usd?: number | null
        }
        Update: {
          billing_run_id?: number | null
          bl_id?: string | null
          calculated_at?: string | null
          calculation_key?: string | null
          charge_item_id?: number | null
          charge_table_id?: number | null
          container_id?: number | null
          created_by?: string | null
          id?: number
          manifest_id?: number | null
          manual_reason?: string | null
          notes?: string | null
          override_applied?: boolean | null
          pricing_rule_version_id?: number | null
          quantity?: number | null
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string | null
          status?: string | null
          total_value_brl?: number | null
          total_value_usd?: number | null
          unit_value_brl?: number | null
          unit_value_usd?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "charge_calculations_billing_run_id_fkey"
            columns: ["billing_run_id"]
            isOneToOne: false
            referencedRelation: "billing_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charge_calculations_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: false
            referencedRelation: "bls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charge_calculations_charge_item_id_fkey"
            columns: ["charge_item_id"]
            isOneToOne: false
            referencedRelation: "charge_table_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charge_calculations_charge_table_id_fkey"
            columns: ["charge_table_id"]
            isOneToOne: false
            referencedRelation: "charge_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charge_calculations_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "bl_containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charge_calculations_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charge_calculations_pricing_rule_version_id_fkey"
            columns: ["pricing_rule_version_id"]
            isOneToOne: false
            referencedRelation: "pricing_rule_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      charge_table_items: {
        Row: {
          active: boolean | null
          application_basis: string | null
          applies_to: string
          cargo_profile: string | null
          category: string | null
          charge_table_id: number | null
          container_type: string | null
          created_at: string | null
          currency: string | null
          id: number
          manual_only: boolean | null
          name: string
          sort_order: number | null
          unit_value_brl: number | null
          unit_value_usd: number | null
          value_brl: number
        }
        Insert: {
          active?: boolean | null
          application_basis?: string | null
          applies_to: string
          cargo_profile?: string | null
          category?: string | null
          charge_table_id?: number | null
          container_type?: string | null
          created_at?: string | null
          currency?: string | null
          id?: number
          manual_only?: boolean | null
          name: string
          sort_order?: number | null
          unit_value_brl?: number | null
          unit_value_usd?: number | null
          value_brl: number
        }
        Update: {
          active?: boolean | null
          application_basis?: string | null
          applies_to?: string
          cargo_profile?: string | null
          category?: string | null
          charge_table_id?: number | null
          container_type?: string | null
          created_at?: string | null
          currency?: string | null
          id?: number
          manual_only?: boolean | null
          name?: string
          sort_order?: number | null
          unit_value_brl?: number | null
          unit_value_usd?: number | null
          value_brl?: number
        }
        Relationships: [
          {
            foreignKeyName: "charge_table_items_charge_table_id_fkey"
            columns: ["charge_table_id"]
            isOneToOne: false
            referencedRelation: "charge_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      charge_tables: {
        Row: {
          active: boolean | null
          cargo_mode: string | null
          carrier_id: number | null
          created_at: string | null
          id: number
          name: string
          notes: string | null
          pod: string | null
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          active?: boolean | null
          cargo_mode?: string | null
          carrier_id?: number | null
          created_at?: string | null
          id?: number
          name: string
          notes?: string | null
          pod?: string | null
          valid_from: string
          valid_to?: string | null
        }
        Update: {
          active?: boolean | null
          cargo_mode?: string | null
          carrier_id?: number | null
          created_at?: string | null
          id?: number
          name?: string
          notes?: string | null
          pod?: string | null
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "charge_tables_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_contacts: {
        Row: {
          created_at: string | null
          customer_id: number | null
          email: string | null
          id: number
          is_primary: boolean | null
          name: string | null
          phone: string | null
          purpose: string | null
        }
        Insert: {
          created_at?: string | null
          customer_id?: number | null
          email?: string | null
          id?: number
          is_primary?: boolean | null
          name?: string | null
          phone?: string | null
          purpose?: string | null
        }
        Update: {
          created_at?: string | null
          customer_id?: number | null
          email?: string | null
          id?: number
          is_primary?: boolean | null
          name?: string | null
          phone?: string | null
          purpose?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_contacts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_portal_accounts: {
        Row: {
          account_situation: string
          active: boolean
          auth_user_id: string | null
          contact_email: string | null
          created_at: string
          created_by: string | null
          customer_id: number
          id: number
          last_login_at: string | null
          login_cnpj: string | null
          password_hash: string | null
          pending_recovery_email: string | null
          portal_email: string | null
          provisioning_decision: string
          recovery_email: string | null
          recovery_email_source: string | null
          updated_at: string
        }
        Insert: {
          account_situation?: string
          active?: boolean
          auth_user_id?: string | null
          contact_email?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: number
          id?: number
          last_login_at?: string | null
          login_cnpj?: string | null
          password_hash?: string | null
          pending_recovery_email?: string | null
          portal_email?: string | null
          provisioning_decision?: string
          recovery_email?: string | null
          recovery_email_source?: string | null
          updated_at?: string
        }
        Update: {
          account_situation?: string
          active?: boolean
          auth_user_id?: string | null
          contact_email?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: number
          id?: number
          last_login_at?: string | null
          login_cnpj?: string | null
          password_hash?: string | null
          pending_recovery_email?: string | null
          portal_email?: string | null
          provisioning_decision?: string
          recovery_email?: string | null
          recovery_email_source?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_portal_accounts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_portal_sessions: {
        Row: {
          account_id: number
          created_at: string
          customer_id: number
          expires_at: string
          id: number
          last_seen_at: string | null
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          account_id: number
          created_at?: string
          customer_id: number
          expires_at: string
          id?: number
          last_seen_at?: string | null
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          account_id?: number
          created_at?: string
          customer_id?: number
          expires_at?: string
          id?: number
          last_seen_at?: string | null
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_portal_sessions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "customer_portal_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_portal_sessions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_rate_overrides: {
        Row: {
          charge_item_id: number | null
          created_at: string | null
          customer_id: number | null
          id: number
          notes: string | null
          override_value: number
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          charge_item_id?: number | null
          created_at?: string | null
          customer_id?: number | null
          id?: number
          notes?: string | null
          override_value: number
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          charge_item_id?: number | null
          created_at?: string | null
          customer_id?: number | null
          id?: number
          notes?: string | null
          override_value?: number
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_rate_overrides_charge_item_id_fkey"
            columns: ["charge_item_id"]
            isOneToOne: false
            referencedRelation: "charge_table_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_rate_overrides_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_reconciliation_queue: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          bl_id: string
          cnpj_cpf: string | null
          created_at: string
          customer_id: number | null
          detection_type: string
          id: number
          manifest_customer_email: string | null
          manifest_customer_name: string | null
          manifest_id: number | null
          notes: string | null
          rejected_at: string | null
          rejected_by: string | null
          resolution_notes: string | null
          status: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          bl_id: string
          cnpj_cpf?: string | null
          created_at?: string
          customer_id?: number | null
          detection_type: string
          id?: number
          manifest_customer_email?: string | null
          manifest_customer_name?: string | null
          manifest_id?: number | null
          notes?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          resolution_notes?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          bl_id?: string
          cnpj_cpf?: string | null
          created_at?: string
          customer_id?: number | null
          detection_type?: string
          id?: number
          manifest_customer_email?: string | null
          manifest_customer_name?: string | null
          manifest_id?: number | null
          notes?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          resolution_notes?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_reconciliation_queue_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: true
            referencedRelation: "bls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_reconciliation_queue_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_reconciliation_queue_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          city: string | null
          cnpj_cpf: string
          created_at: string | null
          id: number
          name: string
          notes: string | null
          pending_balance: number
          state: string | null
          trade_name: string | null
          updated_at: string | null
          zip: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          cnpj_cpf: string
          created_at?: string | null
          id?: number
          name: string
          notes?: string | null
          pending_balance?: number
          state?: string | null
          trade_name?: string | null
          updated_at?: string | null
          zip?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          cnpj_cpf?: string
          created_at?: string | null
          id?: number
          name?: string
          notes?: string | null
          pending_balance?: number
          state?: string | null
          trade_name?: string | null
          updated_at?: string | null
          zip?: string | null
        }
        Relationships: []
      }
      demurrage_invoice_history: {
        Row: {
          created_at: string
          discount_usd: number
          event_date: string
          id: number
          invoice_id: number
          ptax_used: number
          roe_used: number
          source: string
          total_brl: number
          total_usd: number
        }
        Insert: {
          created_at?: string
          discount_usd?: number
          event_date: string
          id?: number
          invoice_id: number
          ptax_used: number
          roe_used: number
          source?: string
          total_brl: number
          total_usd: number
        }
        Update: {
          created_at?: string
          discount_usd?: number
          event_date?: string
          id?: number
          invoice_id?: number
          ptax_used?: number
          roe_used?: number
          source?: string
          total_brl?: number
          total_usd?: number
        }
        Relationships: [
          {
            foreignKeyName: "demurrage_invoice_history_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "demurrage_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      demurrage_invoice_items: {
        Row: {
          container_id: number
          container_number: string
          container_type: string
          created_at: string | null
          days_p1: number
          days_p2: number
          discharge_date: string
          free_days: number
          id: number
          invoice_id: number
          rate_p1_usd: number
          rate_p2_usd: number
          return_date: string
          subtotal_usd: number
          total_days: number
        }
        Insert: {
          container_id: number
          container_number: string
          container_type: string
          created_at?: string | null
          days_p1?: number
          days_p2?: number
          discharge_date: string
          free_days: number
          id?: number
          invoice_id: number
          rate_p1_usd?: number
          rate_p2_usd?: number
          return_date: string
          subtotal_usd: number
          total_days: number
        }
        Update: {
          container_id?: number
          container_number?: string
          container_type?: string
          created_at?: string | null
          days_p1?: number
          days_p2?: number
          discharge_date?: string
          free_days?: number
          id?: number
          invoice_id?: number
          rate_p1_usd?: number
          rate_p2_usd?: number
          return_date?: string
          subtotal_usd?: number
          total_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "demurrage_invoice_items_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "bl_containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demurrage_invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "demurrage_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      demurrage_invoices: {
        Row: {
          billed_at: string | null
          bl_id: string
          conciliated_by_extract: boolean | null
          created_at: string | null
          current_roe: number | null
          current_total_brl: number | null
          customer_id: number
          discount_approver: string | null
          discount_justification: string | null
          discount_mode: string | null
          discount_type: string | null
          discount_value: number | null
          dispute_notes: string | null
          dispute_open: boolean | null
          dispute_reason: string | null
          dispute_status: string | null
          dispute_subject: string | null
          doc_date: string | null
          doc_number: string
          due_date: string | null
          first_billed_at: string | null
          id: number
          notes: string | null
          paid_at: string | null
          pix_payload: string | null
          pix_txid: string | null
          ready_at: string | null
          roe: number | null
          roe_manual: boolean | null
          roe_source: string | null
          status: string | null
          total_usd: number
          updated_at: string | null
        }
        Insert: {
          billed_at?: string | null
          bl_id: string
          conciliated_by_extract?: boolean | null
          created_at?: string | null
          current_roe?: number | null
          current_total_brl?: number | null
          customer_id: number
          discount_approver?: string | null
          discount_justification?: string | null
          discount_mode?: string | null
          discount_type?: string | null
          discount_value?: number | null
          dispute_notes?: string | null
          dispute_open?: boolean | null
          dispute_reason?: string | null
          dispute_status?: string | null
          dispute_subject?: string | null
          doc_date?: string | null
          doc_number: string
          due_date?: string | null
          first_billed_at?: string | null
          id?: number
          notes?: string | null
          paid_at?: string | null
          pix_payload?: string | null
          pix_txid?: string | null
          ready_at?: string | null
          roe?: number | null
          roe_manual?: boolean | null
          roe_source?: string | null
          status?: string | null
          total_usd?: number
          updated_at?: string | null
        }
        Update: {
          billed_at?: string | null
          bl_id?: string
          conciliated_by_extract?: boolean | null
          created_at?: string | null
          current_roe?: number | null
          current_total_brl?: number | null
          customer_id?: number
          discount_approver?: string | null
          discount_justification?: string | null
          discount_mode?: string | null
          discount_type?: string | null
          discount_value?: number | null
          dispute_notes?: string | null
          dispute_open?: boolean | null
          dispute_reason?: string | null
          dispute_status?: string | null
          dispute_subject?: string | null
          doc_date?: string | null
          doc_number?: string
          due_date?: string | null
          first_billed_at?: string | null
          id?: number
          notes?: string | null
          paid_at?: string | null
          pix_payload?: string | null
          pix_txid?: string | null
          ready_at?: string | null
          roe?: number | null
          roe_manual?: boolean | null
          roe_source?: string | null
          status?: string | null
          total_usd?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "demurrage_invoices_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: false
            referencedRelation: "bls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demurrage_invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      demurrage_rates: {
        Row: {
          active: boolean
          container_type: string
          created_at: string
          free_days: number
          id: number
          notes: string | null
          p1_day_from: number
          p1_day_to: number
          p1_usd: number
          p2_day_from: number
          p2_usd: number
          updated_at: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          active?: boolean
          container_type: string
          created_at?: string
          free_days?: number
          id?: number
          notes?: string | null
          p1_day_from: number
          p1_day_to: number
          p1_usd: number
          p2_day_from: number
          p2_usd: number
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          active?: boolean
          container_type?: string
          created_at?: string
          free_days?: number
          id?: number
          notes?: string | null
          p1_day_from?: number
          p1_day_to?: number
          p1_usd?: number
          p2_day_from?: number
          p2_usd?: number
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: []
      }
      depot_services: {
        Row: {
          active: boolean
          condition: string | null
          container_type: string | null
          created_at: string
          depot_id: string
          id: string
          name: string
          natureza: string
          rate_brl: number
          route_destino_id: string | null
        }
        Insert: {
          active?: boolean
          condition?: string | null
          container_type?: string | null
          created_at?: string
          depot_id: string
          id?: string
          name: string
          natureza?: string
          rate_brl?: number
          route_destino_id?: string | null
        }
        Update: {
          active?: boolean
          condition?: string | null
          container_type?: string | null
          created_at?: string
          depot_id?: string
          id?: string
          name?: string
          natureza?: string
          rate_brl?: number
          route_destino_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "depot_services_depot_id_fkey"
            columns: ["depot_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "depot_services_route_destino_id_fkey"
            columns: ["route_destino_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id"]
          },
        ]
      }
      depots: {
        Row: {
          active: boolean
          code: string
          created_at: string
          free_time_material_days: number
          free_time_vazio_days: number
          id: string
          name: string | null
          port_id: number | null
          tipo: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          free_time_material_days?: number
          free_time_vazio_days?: number
          id?: string
          name?: string | null
          port_id?: number | null
          tipo?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          free_time_material_days?: number
          free_time_vazio_days?: number
          id?: string
          name?: string | null
          port_id?: number | null
          tipo?: string
          updated_at?: string
        }
        Relationships: []
      }
      ended_vessels: {
        Row: {
          created_at: string
          ended_at: string
          id: string
          imo_number: string | null
          nansha_etd: string | null
          ningbo_etd: string | null
          original_id: string | null
          pecem_eta: string | null
          qingdao_etd: string | null
          salvador_eta: string | null
          shanghai_etd: string | null
          taicang_etd: string | null
          vessel_name: string
          vitoria_eta: string | null
          voyage: string
        }
        Insert: {
          created_at?: string
          ended_at?: string
          id?: string
          imo_number?: string | null
          nansha_etd?: string | null
          ningbo_etd?: string | null
          original_id?: string | null
          pecem_eta?: string | null
          qingdao_etd?: string | null
          salvador_eta?: string | null
          shanghai_etd?: string | null
          taicang_etd?: string | null
          vessel_name: string
          vitoria_eta?: string | null
          voyage: string
        }
        Update: {
          created_at?: string
          ended_at?: string
          id?: string
          imo_number?: string | null
          nansha_etd?: string | null
          ningbo_etd?: string | null
          original_id?: string | null
          pecem_eta?: string | null
          qingdao_etd?: string | null
          salvador_eta?: string | null
          shanghai_etd?: string | null
          taicang_etd?: string | null
          vessel_name?: string
          vitoria_eta?: string | null
          voyage?: string
        }
        Relationships: []
      }
      exchange_rate_reference: {
        Row: {
          effective_date: string
          id: number
          ptax: number
          roe: number
          updated_at: string
        }
        Insert: {
          effective_date: string
          id?: number
          ptax: number
          roe: number
          updated_at?: string
        }
        Update: {
          effective_date?: string
          id?: number
          ptax?: number
          roe?: number
          updated_at?: string
        }
        Relationships: []
      }
      granite_bl_charges: {
        Row: {
          bl_id: string
          calculated_at: string | null
          charge_type: string | null
          currency: string | null
          description: string | null
          id: string
          quantity: number | null
          rate_id: string | null
          subtotal: number | null
          unit_value: number | null
        }
        Insert: {
          bl_id: string
          calculated_at?: string | null
          charge_type?: string | null
          currency?: string | null
          description?: string | null
          id?: string
          quantity?: number | null
          rate_id?: string | null
          subtotal?: number | null
          unit_value?: number | null
        }
        Update: {
          bl_id?: string
          calculated_at?: string | null
          charge_type?: string | null
          currency?: string | null
          description?: string | null
          id?: string
          quantity?: number | null
          rate_id?: string | null
          subtotal?: number | null
          unit_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "granite_bl_charges_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: false
            referencedRelation: "granite_bls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "granite_bl_charges_rate_id_fkey"
            columns: ["rate_id"]
            isOneToOne: false
            referencedRelation: "granite_rates"
            referencedColumns: ["id"]
          },
        ]
      }
      granite_bls: {
        Row: {
          bl_number: string
          blocks_qty: number | null
          booking_number: string | null
          cargo_readiness_date: string | null
          charge_status: string
          ce_mercante: string | null
          charter: string | null
          client_id: number | null
          consignee_name: string | null
          cosco_transport: string | null
          created_at: string | null
          cssc_selection: string | null
          discharge_port: string | null
          final_m3: number | null
          fragile_blocks: number | null
          id: string
          loading_port: string | null
          manifest_id: string
          partial_restriction: boolean | null
          phase: string | null
          real_weight_kg: number | null
          received_blocks_qty: number | null
          remarks: string | null
          sequence: number | null
          shipper_cnpj: string | null
          shipper_m3: number | null
          shipper_name: string | null
          shipper_ref: string | null
          shipper_weight_kg: number | null
          stockyard: string | null
          vessel_voyage: string | null
        }
        Insert: {
          bl_number: string
          blocks_qty?: number | null
          booking_number?: string | null
          cargo_readiness_date?: string | null
          charge_status?: string
          ce_mercante?: string | null
          charter?: string | null
          client_id?: number | null
          consignee_name?: string | null
          cosco_transport?: string | null
          created_at?: string | null
          cssc_selection?: string | null
          discharge_port?: string | null
          final_m3?: number | null
          fragile_blocks?: number | null
          id?: string
          loading_port?: string | null
          manifest_id: string
          partial_restriction?: boolean | null
          phase?: string | null
          real_weight_kg?: number | null
          received_blocks_qty?: number | null
          remarks?: string | null
          sequence?: number | null
          shipper_cnpj?: string | null
          shipper_m3?: number | null
          shipper_name?: string | null
          shipper_ref?: string | null
          shipper_weight_kg?: number | null
          stockyard?: string | null
          vessel_voyage?: string | null
        }
        Update: {
          bl_number?: string
          blocks_qty?: number | null
          booking_number?: string | null
          cargo_readiness_date?: string | null
          charge_status?: string
          ce_mercante?: string | null
          charter?: string | null
          client_id?: number | null
          consignee_name?: string | null
          cosco_transport?: string | null
          created_at?: string | null
          cssc_selection?: string | null
          discharge_port?: string | null
          final_m3?: number | null
          fragile_blocks?: number | null
          id?: string
          loading_port?: string | null
          manifest_id?: string
          partial_restriction?: boolean | null
          phase?: string | null
          real_weight_kg?: number | null
          received_blocks_qty?: number | null
          remarks?: string | null
          sequence?: number | null
          shipper_cnpj?: string | null
          shipper_m3?: number | null
          shipper_name?: string | null
          shipper_ref?: string | null
          shipper_weight_kg?: number | null
          stockyard?: string | null
          vessel_voyage?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "granite_bls_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "granite_bls_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "granite_manifests"
            referencedColumns: ["id"]
          },
        ]
      }
      granite_manifests: {
        Row: {
          discharge_port: string | null
          id: string
          imported_at: string | null
          imported_by: string | null
          loading_port: string | null
          total_bls: number | null
          total_weight_kg: number | null
          vessel_voyage: string
          voyage_id: number | null
        }
        Insert: {
          discharge_port?: string | null
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          loading_port?: string | null
          total_bls?: number | null
          total_weight_kg?: number | null
          vessel_voyage: string
          voyage_id?: number | null
        }
        Update: {
          discharge_port?: string | null
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          loading_port?: string | null
          total_bls?: number | null
          total_weight_kg?: number | null
          vessel_voyage?: string
          voyage_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "granite_manifests_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      granite_rates: {
        Row: {
          active: boolean
          charge_type: string
          created_at: string | null
          currency: string
          description: string
          id: string
          unit_value: number
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          active?: boolean
          charge_type: string
          created_at?: string | null
          currency?: string
          description: string
          id?: string
          unit_value: number
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          active?: boolean
          charge_type?: string
          created_at?: string | null
          currency?: string
          description?: string
          id?: string
          unit_value?: number
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: []
      }
      import_batches: {
        Row: {
          cargo_mode: string
          ce_master: string | null
          created_at: string | null
          error_count: number | null
          file_hash: string | null
          filename: string
          id: number
          status: string | null
          total_bls: number | null
          total_containers: number | null
          uploaded_at: string | null
          uploaded_by: string | null
          voyage_id: number
          route_summary: string | null
        }
        Insert: {
          cargo_mode?: string
          ce_master?: string | null
          created_at?: string | null
          error_count?: number | null
          file_hash?: string | null
          filename: string
          id?: number
          status?: string | null
          total_bls?: number | null
          total_containers?: number | null
          uploaded_at?: string | null
          uploaded_by?: string | null
          voyage_id: number
          route_summary?: string | null
        }
        Update: {
          cargo_mode?: string
          ce_master?: string | null
          created_at?: string | null
          error_count?: number | null
          file_hash?: string | null
          filename?: string
          id?: number
          status?: string | null
          total_bls?: number | null
          total_containers?: number | null
          uploaded_at?: string | null
          uploaded_by?: string | null
          voyage_id?: number
          route_summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      import_errors: {
        Row: {
          batch_id: number
          bl_number: string | null
          error_message: string | null
          error_type: string
          id: number
          raw_data: Json | null
          row_number: number | null
        }
        Insert: {
          batch_id: number
          bl_number?: string | null
          error_message?: string | null
          error_type: string
          id?: number
          raw_data?: Json | null
          row_number?: number | null
        }
        Update: {
          batch_id?: number
          bl_number?: string | null
          error_message?: string | null
          error_type?: string
          id?: number
          raw_data?: Json | null
          row_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "import_errors_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_bls: {
        Row: {
          bl_id: string
          charge_status_snapshot: string | null
          created_at: string
          financial_status_snapshot: string | null
          id: number
          invoice_id: number
          subtotal_brl: number
          subtotal_usd: number
        }
        Insert: {
          bl_id: string
          charge_status_snapshot?: string | null
          created_at?: string
          financial_status_snapshot?: string | null
          id?: number
          invoice_id: number
          subtotal_brl?: number
          subtotal_usd?: number
        }
        Update: {
          bl_id?: string
          charge_status_snapshot?: string | null
          created_at?: string
          financial_status_snapshot?: string | null
          id?: number
          invoice_id?: number
          subtotal_brl?: number
          subtotal_usd?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_bls_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: false
            referencedRelation: "bls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_bls_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_counters: {
        Row: {
          last_number: number
          year: number
        }
        Insert: {
          last_number?: number
          year: number
        }
        Update: {
          last_number?: number
          year?: number
        }
        Relationships: []
      }
      invoice_granite_bls: {
        Row: {
          created_at: string
          granite_bl_id: string
          id: number
          invoice_id: number
          subtotal_brl: number
        }
        Insert: {
          created_at?: string
          granite_bl_id: string
          id?: number
          invoice_id: number
          subtotal_brl?: number
        }
        Update: {
          created_at?: string
          granite_bl_id?: string
          id?: number
          invoice_id?: number
          subtotal_brl?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_granite_bls_granite_bl_id_fkey"
            columns: ["granite_bl_id"]
            isOneToOne: false
            referencedRelation: "granite_bls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_granite_bls_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          billing_run_id: number | null
          bl_id: string | null
          calculation_key: string | null
          charge_calculation_id: number | null
          charge_item_id: number | null
          charge_table_id: number | null
          currency: string | null
          description: string
          id: number
          invoice_id: number | null
          manifest_id: number | null
          pricing_rule_version_id: number | null
          quantity: number | null
          snapshot_payload: Json
          source: string | null
          total_value_brl: number
          total_value_usd: number | null
          unit_value_brl: number | null
          unit_value_usd: number | null
        }
        Insert: {
          billing_run_id?: number | null
          bl_id?: string | null
          calculation_key?: string | null
          charge_calculation_id?: number | null
          charge_item_id?: number | null
          charge_table_id?: number | null
          currency?: string | null
          description: string
          id?: number
          invoice_id?: number | null
          manifest_id?: number | null
          pricing_rule_version_id?: number | null
          quantity?: number | null
          snapshot_payload?: Json
          source?: string | null
          total_value_brl: number
          total_value_usd?: number | null
          unit_value_brl?: number | null
          unit_value_usd?: number | null
        }
        Update: {
          billing_run_id?: number | null
          bl_id?: string | null
          calculation_key?: string | null
          charge_calculation_id?: number | null
          charge_item_id?: number | null
          charge_table_id?: number | null
          currency?: string | null
          description?: string
          id?: number
          invoice_id?: number | null
          manifest_id?: number | null
          pricing_rule_version_id?: number | null
          quantity?: number | null
          snapshot_payload?: Json
          source?: string | null
          total_value_brl?: number
          total_value_usd?: number | null
          unit_value_brl?: number | null
          unit_value_usd?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_billing_run_id_fkey"
            columns: ["billing_run_id"]
            isOneToOne: false
            referencedRelation: "billing_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_charge_calculation_id_fkey"
            columns: ["charge_calculation_id"]
            isOneToOne: false
            referencedRelation: "charge_calculations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_charge_item_id_fkey"
            columns: ["charge_item_id"]
            isOneToOne: false
            referencedRelation: "charge_table_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_charge_table_id_fkey"
            columns: ["charge_table_id"]
            isOneToOne: false
            referencedRelation: "charge_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_pricing_rule_version_id_fkey"
            columns: ["pricing_rule_version_id"]
            isOneToOne: false
            referencedRelation: "pricing_rule_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_lifecycle_events: {
        Row: {
          actor: string | null
          created_at: string
          event_type: string
          id: number
          invoice_id: number
          payload: Json
          receivable_id: number | null
          related_invoice_id: number | null
        }
        Insert: {
          actor?: string | null
          created_at?: string
          event_type: string
          id?: number
          invoice_id: number
          payload?: Json
          receivable_id?: number | null
          related_invoice_id?: number | null
        }
        Update: {
          actor?: string | null
          created_at?: string
          event_type?: string
          id?: number
          invoice_id?: number
          payload?: Json
          receivable_id?: number | null
          related_invoice_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lifecycle_events_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lifecycle_events_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "bl_receivables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lifecycle_events_related_invoice_id_fkey"
            columns: ["related_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_receivable_links: {
        Row: {
          bl_id: string
          bl_snapshot: Json
          created_at: string
          id: number
          invoice_id: number
          receivable_id: number
          status: string
          subtotal_brl: number
        }
        Insert: {
          bl_id: string
          bl_snapshot?: Json
          created_at?: string
          id?: number
          invoice_id: number
          receivable_id: number
          status?: string
          subtotal_brl?: number
        }
        Update: {
          bl_id?: string
          bl_snapshot?: Json
          created_at?: string
          id?: number
          invoice_id?: number
          receivable_id?: number
          status?: string
          subtotal_brl?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_receivable_links_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: false
            referencedRelation: "bls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_receivable_links_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_receivable_links_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "bl_receivables"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_refunds: {
        Row: {
          amount_brl: number
          cod_adjustment_id: number | null
          created_at: string
          id: number
          invoice_id: number
          notes: string | null
          payment_id: number | null
          registered_by: string | null
          settled_at: string | null
          status: string
        }
        Insert: {
          amount_brl: number
          cod_adjustment_id?: number | null
          created_at?: string
          id?: number
          invoice_id: number
          notes?: string | null
          payment_id?: number | null
          registered_by?: string | null
          settled_at?: string | null
          status?: string
        }
        Update: {
          amount_brl?: number
          cod_adjustment_id?: number | null
          created_at?: string
          id?: number
          invoice_id?: number
          notes?: string | null
          payment_id?: number | null
          registered_by?: string | null
          settled_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_refunds_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_refunds_cod_adjustment_id_fkey"
            columns: ["cod_adjustment_id"]
            isOneToOne: true
            referencedRelation: "cod_adjustments"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          balance_brl: number
          bl_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          conciliated_by_extract: boolean | null
          covered_by_invoice_id: number | null
          created_at: string | null
          customer_id: number
          id: number
          invoice_number: string
          invoice_type: string
          issued_at: string | null
          issued_by: string | null
          notes: string | null
          obsolete_reason: string | null
          pix_payload: string | null
          pix_txid: string | null
          replaced_by_invoice_id: number | null
          status: string | null
          total_brl: number
          total_paid_brl: number
          updated_at: string | null
        }
        Insert: {
          balance_brl?: number
          bl_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          conciliated_by_extract?: boolean | null
          covered_by_invoice_id?: number | null
          created_at?: string | null
          customer_id: number
          id?: number
          invoice_number: string
          invoice_type?: string
          issued_at?: string | null
          issued_by?: string | null
          notes?: string | null
          obsolete_reason?: string | null
          pix_payload?: string | null
          pix_txid?: string | null
          replaced_by_invoice_id?: number | null
          status?: string | null
          total_brl: number
          total_paid_brl?: number
          updated_at?: string | null
        }
        Update: {
          balance_brl?: number
          bl_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          conciliated_by_extract?: boolean | null
          covered_by_invoice_id?: number | null
          created_at?: string | null
          customer_id?: number
          id?: number
          invoice_number?: string
          invoice_type?: string
          issued_at?: string | null
          issued_by?: string | null
          notes?: string | null
          obsolete_reason?: string | null
          pix_payload?: string | null
          pix_txid?: string | null
          replaced_by_invoice_id?: number | null
          status?: string | null
          total_brl?: number
          total_paid_brl?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: false
            referencedRelation: "bls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_covered_by_invoice_id_fkey"
            columns: ["covered_by_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_replaced_by_invoice_id_fkey"
            columns: ["replaced_by_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_settlements: {
        Row: {
          amount_brl: number
          created_at: string
          id: number
          invoice_id: number | null
          method: string | null
          payment_id: number | null
          pix_txid: string | null
          receivable_id: number
          settled_at: string
          source: string
        }
        Insert: {
          amount_brl: number
          created_at?: string
          id?: number
          invoice_id?: number | null
          method?: string | null
          payment_id?: number | null
          pix_txid?: string | null
          receivable_id: number
          settled_at?: string
          source?: string
        }
        Update: {
          amount_brl?: number
          created_at?: string
          id?: number
          invoice_id?: number | null
          method?: string | null
          payment_id?: number | null
          pix_txid?: string | null
          receivable_id?: number
          settled_at?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_settlements_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_settlements_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_settlements_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "bl_receivables"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_brl: number
          created_at: string | null
          id: number
          invoice_id: number
          notes: string | null
          paid_at: string | null
          payment_method: string | null
          registered_by: string | null
        }
        Insert: {
          amount_brl: number
          created_at?: string | null
          id?: number
          invoice_id: number
          notes?: string | null
          paid_at?: string | null
          payment_method?: string | null
          registered_by?: string | null
        }
        Update: {
          amount_brl?: number
          created_at?: string | null
          id?: number
          invoice_id?: number
          notes?: string | null
          paid_at?: string | null
          payment_method?: string | null
          registered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_email_attempts: {
        Row: {
          account_id: number | null
          created_at: string
          id: number
          idempotency_key: string
          invite_id: number | null
          kind: string
          last_error: string | null
          provider_message_id: string | null
          recipient_masked: string
          retry_count: number
          status: string
          updated_at: string
        }
        Insert: {
          account_id?: number | null
          created_at?: string
          id?: number
          idempotency_key: string
          invite_id?: number | null
          kind: string
          last_error?: string | null
          provider_message_id?: string | null
          recipient_masked: string
          retry_count?: number
          status?: string
          updated_at?: string
        }
        Update: {
          account_id?: number | null
          created_at?: string
          id?: number
          idempotency_key?: string
          invite_id?: number | null
          kind?: string
          last_error?: string | null
          provider_message_id?: string | null
          recipient_masked?: string
          retry_count?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_email_attempts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "customer_portal_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_email_attempts_invite_id_fkey"
            columns: ["invite_id"]
            isOneToOne: false
            referencedRelation: "portal_invites"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_email_events: {
        Row: {
          attempt_id: number | null
          event_type: string
          id: number
          provider_event_id: string
          received_at: string
        }
        Insert: {
          attempt_id?: number | null
          event_type: string
          id?: number
          provider_event_id: string
          received_at?: string
        }
        Update: {
          attempt_id?: number | null
          event_type?: string
          id?: number
          provider_event_id?: string
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_email_events_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "portal_email_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_invites: {
        Row: {
          account_id: number
          cancelled_reason: string | null
          consumed_at: string | null
          created_at: string
          created_by: string | null
          expires_at: string
          id: number
          purpose: string
          sent_to_email: string
          status: string
          token_hash: string
        }
        Insert: {
          account_id: number
          cancelled_reason?: string | null
          consumed_at?: string | null
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: number
          purpose: string
          sent_to_email: string
          status?: string
          token_hash: string
        }
        Update: {
          account_id?: number
          cancelled_reason?: string | null
          consumed_at?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: number
          purpose?: string
          sent_to_email?: string
          status?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_invites_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "customer_portal_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_login_attempts: {
        Row: {
          attempted_at: string
          cnpj_hash: string
          id: number
          source: string
          succeeded: boolean
        }
        Insert: {
          attempted_at?: string
          cnpj_hash: string
          id?: number
          source?: string
          succeeded?: boolean
        }
        Update: {
          attempted_at?: string
          cnpj_hash?: string
          id?: number
          source?: string
          succeeded?: boolean
        }
        Relationships: []
      }
      portal_login_resolution_attempts: {
        Row: {
          attempted_at: string
          id: number
          login_hash: string
        }
        Insert: {
          attempted_at?: string
          id?: number
          login_hash: string
        }
        Update: {
          attempted_at?: string
          id?: number
          login_hash?: string
        }
        Relationships: []
      }
      portal_notifications: {
        Row: {
          bl_id: string | null
          created_at: string
          customer_id: number
          id: number
          link: string | null
          message: string
          read_at: string | null
          title: string
          type: string
        }
        Insert: {
          bl_id?: string | null
          created_at?: string
          customer_id: number
          id?: number
          link?: string | null
          message: string
          read_at?: string | null
          title: string
          type: string
        }
        Update: {
          bl_id?: string | null
          created_at?: string
          customer_id?: number
          id?: number
          link?: string | null
          message?: string
          read_at?: string | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_notifications_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: false
            referencedRelation: "bls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_notifications_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_provisioning_events: {
        Row: {
          account_id: number | null
          actor_id: string | null
          actor_type: string
          created_at: string
          customer_id: number
          id: number
          invite_id: number | null
          new_decision: string | null
          new_situation: string | null
          previous_decision: string | null
          previous_situation: string | null
          reason: string | null
          request_id: string | null
        }
        Insert: {
          account_id?: number | null
          actor_id?: string | null
          actor_type: string
          created_at?: string
          customer_id: number
          id?: number
          invite_id?: number | null
          new_decision?: string | null
          new_situation?: string | null
          previous_decision?: string | null
          previous_situation?: string | null
          reason?: string | null
          request_id?: string | null
        }
        Update: {
          account_id?: number | null
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          customer_id?: number
          id?: number
          invite_id?: number | null
          new_decision?: string | null
          new_situation?: string | null
          previous_decision?: string | null
          previous_situation?: string | null
          reason?: string | null
          request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_provisioning_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "customer_portal_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_provisioning_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_provisioning_events_invite_id_fkey"
            columns: ["invite_id"]
            isOneToOne: false
            referencedRelation: "portal_invites"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_rate_limits: {
        Row: {
          action_name: string
          attempted_at: string
          customer_id: number
          id: number
        }
        Insert: {
          action_name: string
          attempted_at?: string
          customer_id: number
          id?: number
        }
        Update: {
          action_name?: string
          attempted_at?: string
          customer_id?: number
          id?: number
        }
        Relationships: [
          {
            foreignKeyName: "portal_rate_limits_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_suppressed_emails: {
        Row: {
          email: string
          id: number
          reason: string
          suppressed_at: string
        }
        Insert: {
          email: string
          id?: number
          reason: string
          suppressed_at?: string
        }
        Update: {
          email?: string
          id?: number
          reason?: string
          suppressed_at?: string
        }
        Relationships: []
      }
      ports: {
        Row: {
          country: string | null
          created_at: string | null
          id: number
          locode: string | null
          name: string
        }
        Insert: {
          country?: string | null
          created_at?: string | null
          id?: number
          locode?: string | null
          name: string
        }
        Update: {
          country?: string | null
          created_at?: string | null
          id?: number
          locode?: string | null
          name?: string
        }
        Relationships: []
      }
      pricing_rule_versions: {
        Row: {
          charge_item_id: number | null
          charge_table_id: number | null
          created_at: string
          customer_id: number | null
          customer_rate_override_id: number | null
          id: number
          metadata: Json
          reference_date: string | null
          version_key: string
        }
        Insert: {
          charge_item_id?: number | null
          charge_table_id?: number | null
          created_at?: string
          customer_id?: number | null
          customer_rate_override_id?: number | null
          id?: number
          metadata?: Json
          reference_date?: string | null
          version_key: string
        }
        Update: {
          charge_item_id?: number | null
          charge_table_id?: number | null
          created_at?: string
          customer_id?: number | null
          customer_rate_override_id?: number | null
          id?: number
          metadata?: Json
          reference_date?: string | null
          version_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_rule_versions_charge_item_id_fkey"
            columns: ["charge_item_id"]
            isOneToOne: false
            referencedRelation: "charge_table_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_rule_versions_charge_table_id_fkey"
            columns: ["charge_table_id"]
            isOneToOne: false
            referencedRelation: "charge_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_rule_versions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_rule_versions_customer_rate_override_id_fkey"
            columns: ["customer_rate_override_id"]
            isOneToOne: false
            referencedRelation: "customer_rate_overrides"
            referencedColumns: ["id"]
          },
        ]
      }
      provision_rate_limit_log: {
        Row: {
          called_at: string
          id: number
          user_id: string
        }
        Insert: {
          called_at?: string
          id?: number
          user_id: string
        }
        Update: {
          called_at?: string
          id?: number
          user_id?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          active: boolean
          created_at: string | null
          full_name: string
          id: string
          role: string
        }
        Insert: {
          active?: boolean
          created_at?: string | null
          full_name: string
          id: string
          role?: string
        }
        Update: {
          active?: boolean
          created_at?: string | null
          full_name?: string
          id?: string
          role?: string
        }
        Relationships: []
      }
      vazios_bookings: {
        Row: {
          condition: string
          container_number: string
          container_type: string | null
          created_at: string | null
          hand_in_date: string | null
          hand_out_date: string | null
          id: string
          local_id: string
          manifest_id: string
          movement_date: string | null
          operation_id: string
          voyage_id: number
        }
        Insert: {
          condition: string
          container_number: string
          container_type?: string | null
          created_at?: string | null
          hand_in_date?: string | null
          hand_out_date?: string | null
          id?: string
          local_id: string
          manifest_id: string
          movement_date?: string | null
          operation_id: string
          voyage_id: number
        }
        Update: {
          condition?: string
          container_number?: string
          container_type?: string | null
          created_at?: string | null
          hand_in_date?: string | null
          hand_out_date?: string | null
          id?: string
          local_id?: string
          manifest_id?: string
          movement_date?: string | null
          operation_id?: string
          voyage_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "vazios_bookings_local_id_fkey"
            columns: ["local_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vazios_bookings_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "vazios_manifests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vazios_bookings_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "vazios_export_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vazios_bookings_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      vazios_export_operations: {
        Row: {
          created_at: string
          embark_port: string
          id: string
          updated_at: string
          voyage_id: number
        }
        Insert: {
          created_at?: string
          embark_port: string
          id?: string
          updated_at?: string
          voyage_id: number
        }
        Update: {
          created_at?: string
          embark_port?: string
          id?: string
          updated_at?: string
          voyage_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "vazios_export_operations_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      vazios_export_service_lines: {
        Row: {
          condition: string | null
          container_type: string | null
          created_at: string
          destino_id: string | null
          id: string
          local_id: string
          operation_id: string
          percentual: number | null
          quantidade: number
          quantidade_manual: boolean
          service_id: string
          updated_at: string
          valor_sugerido: number | null
          valor_unitario: number
        }
        Insert: {
          condition?: string | null
          container_type?: string | null
          created_at?: string
          destino_id?: string | null
          id?: string
          local_id: string
          operation_id: string
          percentual?: number | null
          quantidade?: number
          quantidade_manual?: boolean
          service_id: string
          updated_at?: string
          valor_sugerido?: number | null
          valor_unitario?: number
        }
        Update: {
          condition?: string | null
          container_type?: string | null
          created_at?: string
          destino_id?: string | null
          id?: string
          local_id?: string
          operation_id?: string
          percentual?: number | null
          quantidade?: number
          quantidade_manual?: boolean
          service_id?: string
          updated_at?: string
          valor_sugerido?: number | null
          valor_unitario?: number
        }
        Relationships: [
          {
            foreignKeyName: "vazios_export_service_lines_destino_id_fkey"
            columns: ["destino_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vazios_export_service_lines_local_id_fkey"
            columns: ["local_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vazios_export_service_lines_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "vazios_export_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vazios_export_service_lines_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "depot_services"
            referencedColumns: ["id"]
          },
        ]
      }
      vazios_importacao_containers: {
        Row: {
          container_number: string
          container_type: string | null
          created_at: string | null
          id: string
          manifest_id: string
          natureza: string | null
          pol: string | null
          pod: string | null
          tare_kg: number | null
        }
        Insert: {
          container_number: string
          container_type?: string | null
          created_at?: string | null
          id?: string
          manifest_id: string
          natureza?: string | null
          pol?: string | null
          pod?: string | null
          tare_kg?: number | null
        }
        Update: {
          container_number?: string
          container_type?: string | null
          created_at?: string | null
          id?: string
          manifest_id?: string
          natureza?: string | null
          pol?: string | null
          pod?: string | null
          tare_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vazios_importacao_containers_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "vazios_importacao_manifests"
            referencedColumns: ["id"]
          },
        ]
      }
      vazios_importacao_manifests: {
        Row: {
          description: string | null
          id: string
          imported_at: string | null
          imported_by: string | null
          source: string
          total_containers: number | null
          voyage_id: number | null
        }
        Insert: {
          description?: string | null
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          source?: string
          total_containers?: number | null
          voyage_id?: number | null
        }
        Update: {
          description?: string | null
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          source?: string
          total_containers?: number | null
          voyage_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vazios_importacao_manifests_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      vazios_manifests: {
        Row: {
          description: string | null
          id: string
          imported_at: string | null
          imported_by: string | null
          total_bookings: number | null
          voyage_id: number | null
        }
        Insert: {
          description?: string | null
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          total_bookings?: number | null
          voyage_id?: number | null
        }
        Update: {
          description?: string | null
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          total_bookings?: number | null
          voyage_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vazios_manifests_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          bl_id: string
          brand: string
          cbm: number
          chassis: string
          container_id: number
          created_at: string | null
          id: number
          model: string
          voyage_id: number
          weight_kg: number
        }
        Insert: {
          bl_id: string
          brand: string
          cbm: number
          chassis: string
          container_id: number
          created_at?: string | null
          id?: number
          model: string
          voyage_id: number
          weight_kg: number
        }
        Update: {
          bl_id?: string
          brand?: string
          cbm?: number
          chassis?: string
          container_id?: number
          created_at?: string | null
          id?: number
          model?: string
          voyage_id?: number
          weight_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: false
            referencedRelation: "bls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "bl_containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      vessel_schedules: {
        Row: {
          created_at: string
          display_order: number | null
          id: string
          imo_number: string | null
          nansha_etd: string | null
          ningbo_etd: string | null
          pecem_eta: string | null
          qingdao_etd: string | null
          salvador_eta: string | null
          shanghai_etd: string | null
          taicang_etd: string | null
          updated_at: string
          vessel_name: string
          vitoria_eta: string | null
          voyage: string
        }
        Insert: {
          created_at?: string
          display_order?: number | null
          id?: string
          imo_number?: string | null
          nansha_etd?: string | null
          ningbo_etd?: string | null
          pecem_eta?: string | null
          qingdao_etd?: string | null
          salvador_eta?: string | null
          shanghai_etd?: string | null
          taicang_etd?: string | null
          updated_at?: string
          vessel_name: string
          vitoria_eta?: string | null
          voyage: string
        }
        Update: {
          created_at?: string
          display_order?: number | null
          id?: string
          imo_number?: string | null
          nansha_etd?: string | null
          ningbo_etd?: string | null
          pecem_eta?: string | null
          qingdao_etd?: string | null
          salvador_eta?: string | null
          shanghai_etd?: string | null
          taicang_etd?: string | null
          updated_at?: string
          vessel_name?: string
          vitoria_eta?: string | null
          voyage?: string
        }
        Relationships: []
      }
      vessels: {
        Row: {
          carrier_id: number
          created_at: string | null
          id: number
          imo: string | null
          name: string
        }
        Insert: {
          carrier_id: number
          created_at?: string | null
          id?: number
          imo?: string | null
          name: string
        }
        Update: {
          carrier_id?: number
          created_at?: string | null
          id?: number
          imo?: string | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "vessels_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
        ]
      }
      voyage_export_schedules: {
        Row: {
          ce_status: string | null
          containers_qty: number | null
          created_at: string | null
          discharge_ports: string[]
          has_empty: boolean
          has_granite: boolean
          id: string
          linked: boolean
          movements_qty: number | null
          pol: string
          tem_exportacao: boolean
          updated_at: string | null
          voyage_id: number
        }
        Insert: {
          ce_status?: string | null
          containers_qty?: number | null
          created_at?: string | null
          discharge_ports?: string[]
          has_empty?: boolean
          has_granite?: boolean
          id?: string
          linked?: boolean
          movements_qty?: number | null
          pol: string
          tem_exportacao?: boolean
          updated_at?: string | null
          voyage_id: number
        }
        Update: {
          ce_status?: string | null
          containers_qty?: number | null
          created_at?: string | null
          discharge_ports?: string[]
          has_empty?: boolean
          has_granite?: boolean
          id?: string
          linked?: boolean
          movements_qty?: number | null
          pol?: string
          tem_exportacao?: boolean
          updated_at?: string | null
          voyage_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "voyage_export_schedules_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      voyage_escala_operation_fronts: {
        Row: {
          created_at: string
          id: string
          last_changed_at: string
          last_changed_by: string | null
          modalidade: string
          port: string
          port_id: number
          revision: number
          sentido: string
          source: string
          terminal_id: string | null
          updated_at: string
          voyage_id: number
        }
        Insert: {
          created_at?: string
          id?: string
          last_changed_at?: string
          last_changed_by?: string | null
          modalidade: string
          port: string
          port_id: number
          revision?: number
          sentido: string
          source: string
          terminal_id?: string | null
          updated_at?: string
          voyage_id: number
        }
        Update: {
          created_at?: string
          id?: string
          last_changed_at?: string
          last_changed_by?: string | null
          modalidade?: string
          port?: string
          port_id?: number
          revision?: number
          sentido?: string
          source?: string
          terminal_id?: string | null
          updated_at?: string
          voyage_id?: number
        }
        Relationships: []
      }
      voyage_escala_revision_state: {
        Row: {
          created_at: string
          port: string
          port_id: number
          revision: number
          updated_at: string
          voyage_id: number
        }
        Insert: {
          created_at?: string
          port: string
          port_id: number
          revision?: number
          updated_at?: string
          voyage_id: number
        }
        Update: {
          created_at?: string
          port?: string
          port_id?: number
          revision?: number
          updated_at?: string
          voyage_id?: number
        }
        Relationships: []
      }
      voyage_escala_terminal_state: {
        Row: {
          created_at: string
          id: string
          port: string
          port_id: number
          revision: number
          terminal_etb: string | null
          terminal_atb: string | null
          terminal_etd: string | null
          terminal_atd: string | null
          terminal_id: string | null
          terminal_rtw: number | null
          updated_at: string
          voyage_id: number
        }
        Insert: {
          created_at?: string
          id?: string
          port: string
          port_id: number
          revision?: number
          terminal_etb?: string | null
          terminal_atb?: string | null
          terminal_etd?: string | null
          terminal_atd?: string | null
          terminal_id?: string | null
          terminal_rtw?: number | null
          updated_at?: string
          voyage_id: number
        }
        Update: {
          created_at?: string
          id?: string
          port?: string
          port_id?: number
          revision?: number
          terminal_etb?: string | null
          terminal_atb?: string | null
          terminal_etd?: string | null
          terminal_atd?: string | null
          terminal_id?: string | null
          terminal_rtw?: number | null
          updated_at?: string
          voyage_id?: number
        }
        Relationships: []
      }
      voyage_omissions: {
        Row: {
          discharge_pod: string
          id: number
          omitted_at: string
          omitted_by: string | null
          omitted_pod: string
          onward_carrier: string | null
          onward_eta: string | null
          onward_etd: string | null
          onward_vessel_name: string | null
          onward_voyage_number: string | null
          reason: string | null
          voyage_id: number
        }
        Insert: {
          discharge_pod: string
          id?: number
          omitted_at?: string
          omitted_by?: string | null
          omitted_pod: string
          onward_carrier?: string | null
          onward_eta?: string | null
          onward_etd?: string | null
          onward_vessel_name?: string | null
          onward_voyage_number?: string | null
          reason?: string | null
          voyage_id: number
        }
        Update: {
          discharge_pod?: string
          id?: number
          omitted_at?: string
          omitted_by?: string | null
          omitted_pod?: string
          onward_carrier?: string | null
          onward_eta?: string | null
          onward_etd?: string | null
          onward_vessel_name?: string | null
          onward_voyage_number?: string | null
          reason?: string | null
          voyage_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "voyage_omissions_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      voyage_route_ce_master: {
        Row: {
          cargo_mode: string
          ce_master: string | null
          id: string
          pod: string
          pol: string
          updated_at: string | null
          updated_by: string | null
          voyage_id: number
        }
        Insert: {
          cargo_mode?: string
          ce_master?: string | null
          id?: string
          pod: string
          pol: string
          updated_at?: string | null
          updated_by?: string | null
          voyage_id: number
        }
        Update: {
          cargo_mode?: string
          ce_master?: string | null
          id?: string
          pod?: string
          pol?: string
          updated_at?: string | null
          updated_by?: string | null
          voyage_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "voyage_route_ce_master_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      voyages: {
        Row: {
          ata: string | null
          created_at: string | null
          eta: string | null
          etd: string | null
          id: number
          pod_id: number | null
          pod_schedule_snapshot: Json
          pol_id: number | null
          pol_schedule_snapshot: Json
          show_on_portal: boolean
          status: string | null
          vessel_id: number
          voyage_number: string
        }
        Insert: {
          ata?: string | null
          created_at?: string | null
          eta?: string | null
          etd?: string | null
          id?: number
          pod_id?: number | null
          pod_schedule_snapshot?: Json
          pol_id?: number | null
          pol_schedule_snapshot?: Json
          show_on_portal?: boolean
          status?: string | null
          vessel_id: number
          voyage_number: string
        }
        Update: {
          ata?: string | null
          created_at?: string | null
          eta?: string | null
          etd?: string | null
          id?: number
          pod_id?: number | null
          pod_schedule_snapshot?: Json
          pol_id?: number | null
          pol_schedule_snapshot?: Json
          show_on_portal?: boolean
          status?: string | null
          vessel_id?: number
          voyage_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "voyages_pod_id_fkey"
            columns: ["pod_id"]
            isOneToOne: false
            referencedRelation: "ports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voyages_pol_id_fkey"
            columns: ["pol_id"]
            isOneToOne: false
            referencedRelation: "ports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voyages_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _portal_actor_role: { Args: never; Returns: string }
      _portal_log_event: {
        Args: {
          p_account_id: number
          p_actor_type: string
          p_customer_id: number
          p_invite_id: number
          p_new_decision: string
          p_new_situation: string
          p_prev_decision: string
          p_prev_situation: string
          p_reason: string
          p_request_id: string
        }
        Returns: undefined
      }
      add_agency_report_occurrence: {
        Args: {
          p_body: string
          p_port: string
          p_section?: string
          p_voyage_id: number
        }
        Returns: Json
      }
      add_manual_bl_charge: {
        Args: {
          p_actor?: string
          p_bl_id: string
          p_charge_item_id: number
          p_notes?: string
          p_quantity?: number
        }
        Returns: Json
      }
      add_manual_invoice_charge: {
        Args: {
          p_actor?: string
          p_description: string
          p_invoice_id: number
          p_notes?: string
          p_quantity: number
          p_unit_value_brl: number
        }
        Returns: Json
      }
      admin_list_users: {
        Args: never
        Returns: {
          active: boolean
          created_at: string
          email: string
          full_name: string
          id: string
          last_sign_in_at: string
          role: string
        }[]
      }
      agency_report_deadline_date: {
        Args: { p_atd: string }
        Returns: string
      }
      agency_report_department_label: {
        Args: { p_department: string }
        Returns: string
      }
      agency_report_section_label: {
        Args: { p_section: string }
        Returns: string
      }
      agency_report_section_owner: {
        Args: { p_section: string }
        Returns: string
      }
      apply_bl_review_gate_after_import: {
        Args: { p_bl_ids: string[]; p_changed_by: string }
        Returns: number
      }
      apply_ce_mercante_manifest: {
        Args: { p_changed_by: string; p_rows: Json }
        Returns: Json
      }
      apply_ce_mercante_update: {
        Args: { p_bl_id: string; p_changed_by: string; p_new_ce: string }
        Returns: string
      }
      apply_granite_ce_mercante_update: {
        Args: { p_bl_id: string; p_changed_by: string; p_new_ce: string }
        Returns: string
      }
      approve_customer_reconciliation: {
        Args: {
          p_actor?: string
          p_customer_id?: number
          p_notes?: string
          p_queue_id: number
        }
        Returns: Json
      }
      archive_vessel_schedule: { Args: { p_vessel_id: string }; Returns: Json }
      backfill_invoice_receivable_links: {
        Args: { p_limit?: number }
        Returns: Json
      }
      backfill_local_charge_receivables: {
        Args: { p_limit?: number }
        Returns: Json
      }
      bl_has_portal_release: { Args: { p_bl_id: string }; Returns: boolean }
      bl_timeline: {
        Args: { p_bl_id: string; p_limit?: number; p_offset?: number }
        Returns: {
          changed_at: string
          changed_by: string
          entity_type: string
          family: string
          field_name: string
          id: number
          justification: string
          new_value: string
          old_value: string
        }[]
      }
      build_transshipping_pix_payload: {
        Args: { p_amount_brl: number; p_txid: string }
        Returns: string
      }
      calculate_bl_local_charges: {
        Args: { p_actor?: string; p_bl_id: string; p_recalculate?: boolean }
        Returns: Json
      }
      can_edit_customers: { Args: never; Returns: boolean }
      can_edit_depots: { Args: never; Returns: boolean }
      can_edit_voyages: { Args: never; Returns: boolean }
      cancel_invoice: {
        Args: { p_actor?: string; p_invoice_id: number; p_reason: string }
        Returns: Json
      }
      check_portal_rate_limit: {
        Args: {
          p_action_name: string
          p_max_attempts?: number
          p_window_minutes?: number
        }
        Returns: boolean
      }
      check_provision_rate_limit: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      close_agency_departure_report: {
        Args: { p_port: string; p_snapshot: Json; p_voyage_id: number }
        Returns: Json
      }
      compute_bl_review_pendencies:
        | { Args: { p_bl_id: string }; Returns: string[] }
        | {
            Args: {
              p_bb_weight_ton: number
              p_cargo_mode: string
              p_customer_id: number
            }
            Returns: string[]
          }
      confirm_demurrage_pix_matches: {
        Args: { p_matches: Json }
        Returns: number
      }
      confirm_unified_pix_matches: { Args: { p_matches: Json }; Returns: Json }
      count_distinct_containers: { Args: never; Returns: number }
      create_customer_with_contacts: {
        Args: { p_contacts?: Json; p_customer: Json }
        Returns: Json
      }
      create_demurrage_invoice_with_items: {
        Args: {
          p_bl_id: string
          p_current_roe: number
          p_customer_id: number
          p_doc_number: string
          p_items: Json
          p_ready_at: string
          p_roe: number
          p_roe_manual: boolean
          p_roe_source: string
          p_total_usd: number
        }
        Returns: Json
      }
      create_invoice_from_bls: {
        Args: {
          p_actor?: string
          p_bl_ids: string[]
          p_customer_id?: number
          p_issue_now?: boolean
          p_notes?: string
        }
        Returns: Json
      }
      create_invoice_from_bls_core: {
        Args: {
          p_actor?: string
          p_bl_ids: string[]
          p_customer_id: number
          p_issue_now?: boolean
          p_notes?: string
          p_origin?: string
          p_portal_account_id?: number
        }
        Returns: Json
      }
      create_invoice_from_bls_with_ledger: {
        Args: {
          p_actor?: string
          p_bl_ids: string[]
          p_customer_id?: number
          p_issue_now?: boolean
          p_notes?: string
        }
        Returns: Json
      }
      create_invoice_from_granite_bls: {
        Args: {
          p_actor?: string
          p_customer_id?: number
          p_granite_bl_ids: string[]
          p_issue_now?: boolean
          p_notes?: string
        }
        Returns: Json
      }
      create_local_consolidated_invoice: {
        Args: {
          p_actor?: string
          p_customer_id: number
          p_notes?: string
          p_receivable_ids: number[]
        }
        Returns: Json
      }
      create_local_consolidated_invoice_core: {
        Args: {
          p_actor?: string
          p_customer_id: number
          p_origin?: string
          p_receivable_ids: number[]
        }
        Returns: Json
      }
      create_manual_vazios_booking: {
        Args: {
          p_condition: string
          p_container_number: string
          p_container_type: string
          p_hand_in_date: string
          p_hand_out_date: string
          p_local_id: string
          p_movement_date: string
          p_operation_id: string
          p_uploaded_by: string
          p_voyage_id: number
        }
        Returns: string
      }
      current_portal_customer_id: { Args: never; Returns: number }
      current_user_role: { Args: never; Returns: string }
      delete_baplie_manifest_for_voyage: {
        Args: { p_voyage_id: number }
        Returns: number
      }
      delete_manual_bl_charge: {
        Args: { p_actor?: string; p_charge_calculation_id: number }
        Returns: Json
      }
      delete_manual_invoice_charge: {
        Args: { p_actor?: string; p_item_id: number }
        Returns: Json
      }
      delete_manual_vazios_booking: {
        Args: { p_booking_id: string }
        Returns: undefined
      }
      detect_agency_report_deadline_missed: { Args: never; Returns: number }
      detect_agency_report_pending: { Args: never; Returns: number }
      ensure_agency_departure_report: {
        Args: { p_port: string; p_voyage_id: number }
        Returns: string
      }
      ensure_pricing_rule_version: {
        Args: {
          p_charge_item_id: number
          p_charge_table_id: number
          p_customer_id: number
          p_metadata?: Json
          p_reference_date: string
        }
        Returns: number
      }
      get_agency_report_actor_names: {
        Args: { p_port: string; p_voyage_id: number }
        Returns: {
          full_name: string
          user_id: string
        }[]
      }
      get_agency_report_closer_name: {
        Args: { p_port: string; p_voyage_id: number }
        Returns: string
      }
      get_billing_run_details: {
        Args: { p_billing_run_id: number }
        Returns: Json
      }
      get_bl_portal_status: { Args: { p_bl_id: string }; Returns: Json }
      get_consolidated_invoice_item_breakdown: {
        Args: { p_invoice_id: number }
        Returns: {
          bl_id: string
          calculation_key: string
          charge_calculation_id: number
          charge_item_id: number
          charge_name: string
          charge_table_id: number
          currency: string
          quantity: number
          total_value_brl: number
          total_value_usd: number
          unit_value_brl: number
          unit_value_usd: number
        }[]
      }
      get_customer_portal_account: {
        Args: { p_customer_id: number }
        Returns: Json
      }
      get_customer_receivables: {
        Args: { p_customer_id: number }
        Returns: {
          balance_brl: number
          bl_id: string
          id: number
          original_amount_brl: number
          settled_amount_brl: number
          status: string
        }[]
      }
      get_demurrage_recent_values: {
        Args: { p_date: string; p_invoice_id: number }
        Returns: {
          event_date: string
          ptax_used: number
          total_brl: number
        }[]
      }
      get_invoice_pending_refund: {
        Args: { p_invoice_id: number }
        Returns: number
      }
      import_baplie_staging_transactional: {
        Args: { p_rows: Json; p_voyage_id: number }
        Returns: number
      }
      import_bl_freight_transactional: {
        Args: { p_bls: Json; p_changed_by: string }
        Returns: Json
      }
      import_breakbulk_manifest_transactional: {
        Args: {
          p_bls: Json
          p_errors: Json
          p_filename: string
          p_items: Json
          p_total_bls: number
          p_uploaded_by: string
          p_voyage_id: number
        }
        Returns: Json
      }
      import_granite_manifest_transactional: {
        Args: {
          p_bls: Json
          p_discharge_port: string
          p_loading_port: string
          p_total_bls: number
          p_total_weight_kg: number
          p_uploaded_by: string
          p_vessel_voyage: string
          p_voyage_id: number
        }
        Returns: Json
      }
      import_manifest_transactional: {
        Args: {
          p_apply_overwrites?: boolean
          p_bls: Json
          p_cargo_mode: string
          p_containers: Json
          p_errors: Json
          p_file_hash: string
          p_filename: string
          p_total_bls: number
          p_total_containers: number
          p_uploaded_by: string
          p_voyage_id: number
        }
        Returns: number
      }
      import_vazios_bookings_transactional: {
        Args: {
          p_bookings: Json
          p_port: string
          p_uploaded_by: string
          p_voyage_id: number
        }
        Returns: Json
      }
      import_vazios_importacao_transactional: {
        Args: {
          p_containers: Json
          p_description: string
          p_uploaded_by: string
          p_voyage_id: number
        }
        Returns: Json
      }
      import_vehicle_rows_transactional: {
        Args: { p_rows: Json }
        Returns: number
      }
      insert_billing_run_log: {
        Args: {
          p_billing_run_id: number
          p_bl_id: string
          p_code: string
          p_details?: Json
          p_level: string
          p_manifest_id: number
          p_message: string
        }
        Returns: undefined
      }
      is_active_non_equipamentos_user: { Args: never; Returns: boolean }
      is_active_read_user: { Args: never; Returns: boolean }
      is_active_user: { Args: never; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_equipamentos_user: { Args: never; Returns: boolean }
      link_invoice_to_ledger: {
        Args: { p_invoice_id: number }
        Returns: undefined
      }
      list_billing_runs: {
        Args: { p_limit?: number }
        Returns: {
          blocked_bls: number
          calculated_bls: number
          completed_at: string
          eligible_bls: number
          filename: string
          id: number
          manifest_id: number
          started_at: string
          status: string
          total_bls: number
          total_brl: number
          total_usd: number
          trigger_source: string
        }[]
      }
      list_bl_local_charge_lines: {
        Args: { p_bl_id: string }
        Returns: {
          bl_id: string
          calculated_at: string
          calculation_key: string
          charge_item_id: number
          charge_name: string
          charge_table_id: number
          currency: string
          id: number
          notes: string
          override_applied: boolean
          quantity: number
          review_reason: string
          source: string
          status: string
          total_value_brl: number
          total_value_usd: number
          unit_value_brl: number
          unit_value_usd: number
        }[]
      }
      list_consolidatable_receivables: {
        Args: { p_customer_id: number; p_search?: string; p_voyage_id?: number }
        Returns: {
          balance_brl: number
          bl_id: string
          customer_cnpj_cpf: string
          customer_id: number
          customer_name: string
          eligibility_reason: string
          eligibility_status: string
          individual_invoice_id: number
          individual_invoice_number: string
          original_amount_brl: number
          receivable_id: number
          receivable_status: string
          vessel_name: string
          voyage_id: number
          voyage_number: string
        }[]
      }
      list_customer_reconciliation_queue: {
        Args: { p_limit?: number; p_status?: string }
        Returns: {
          approved_at: string
          billing_hold_reason: string
          bl_id: string
          charge_status: string
          cnpj_cpf: string
          created_at: string
          current_customer_name: string
          customer_id: number
          detection_type: string
          financial_status: string
          id: number
          manifest_customer_email: string
          manifest_customer_name: string
          manifest_id: number
          notes: string
          rejected_at: string
          resolution_notes: string
          status: string
        }[]
      }
      apply_cod_financial_effect: {
        Args: { p_bl_id: string; p_omission_id: number; p_previous_pod: string }
        Returns: undefined
      }
      is_financeiro_user: { Args: never; Returns: boolean }
      list_invoice_details: { Args: { p_invoice_id: number }; Returns: Json }
      list_invoice_refunds: {
        Args: { p_invoice_id: number }
        Returns: {
          amount_brl: number
          cod_adjustment_id: number | null
          created_at: string
          id: number
          notes: string
          settled_at: string
          status: string
        }[]
      }
      list_manual_charge_items_for_bl: {
        Args: { p_bl_id: string }
        Returns: {
          cargo_mode: string
          charge_item_id: number
          charge_item_name: string
          charge_table_id: number
          charge_table_name: string
          currency: string
          default_unit_value_brl: number
          default_unit_value_usd: number
          effective_unit_value_brl: number
          effective_unit_value_usd: number
          pod: string
        }[]
      }
      mark_bl_charges_reviewed: {
        Args: { p_actor?: string; p_bl_id: string }
        Returns: Json
      }
      mark_bl_ready_and_create_invoice: {
        Args: {
          p_actor?: string
          p_bl_id: string
          p_customer_id?: number
          p_notes?: string
        }
        Returns: Json
      }
      mark_bl_ready_for_billing: {
        Args: { p_actor?: string; p_bl_id: string }
        Returns: Json
      }
      mark_bls_ready_and_create_invoice: {
        Args: {
          p_actor?: string
          p_bl_ids: string[]
          p_customer_id: number
          p_notes?: string
        }
        Returns: Json
      }
      normalize_document_text: { Args: { p_value: string }; Returns: string }
      normalize_port_code: { Args: { p_value: string }; Returns: string }
      obsolete_consolidated_invoice: {
        Args: { p_actor?: string; p_invoice_id: number; p_reason?: string }
        Returns: Json
      }
      omit_voyage_escala: {
        Args: {
          p_changed_by: string
          p_discharge_pod: string
          p_omitted_pod: string
          p_onward_carrier?: string
          p_onward_eta?: string
          p_onward_etd?: string
          p_onward_vessel_name?: string
          p_onward_voyage_number?: string
          p_reason: string
          p_voyage_id: number
        }
        Returns: number
      }
      pix_crc16_ccitt: { Args: { p_payload: string }; Returns: string }
      pix_tlv: { Args: { p_id: string; p_value: string }; Returns: string }
      portal_admin_change_cnpj: {
        Args: { p_customer_id: number; p_new_cnpj: string; p_reason: string }
        Returns: undefined
      }
      portal_assisted_email_change: {
        Args: {
          p_customer_id: number
          p_new_email: string
          p_reason: string
          p_request_id?: string
        }
        Returns: undefined
      }
      portal_cancel_invite: {
        Args: { p_customer_id: number; p_reason: string; p_request_id?: string }
        Returns: undefined
      }
      portal_create_consolidation: {
        Args: { p_receivable_ids: number[] }
        Returns: Json
      }
      portal_current_role: { Args: never; Returns: string }
      portal_get_current_roe: {
        Args: never
        Returns: {
          roe: number
          updated_at: string
        }[]
      }
      portal_get_demurrage_invoice_detail: {
        Args: { p_invoice_id: number }
        Returns: Json
      }
      portal_get_profile: { Args: never; Returns: Json }
      portal_get_session_overview_v2: { Args: never; Returns: Json }
      portal_invoice_details: { Args: { p_invoice_id: number }; Returns: Json }
      portal_list_consolidatable_receivables: {
        Args: never
        Returns: {
          balance_brl: number
          bl_id: string
          customer_cnpj_cpf: string
          customer_id: number
          customer_name: string
          eligibility_reason: string
          eligibility_status: string
          individual_invoice_id: number
          individual_invoice_number: string
          original_amount_brl: number
          receivable_id: number
          receivable_status: string
          vessel_name: string
          voyage_id: number
          voyage_number: string
        }[]
      }
      portal_list_demurrage_invoices: { Args: never; Returns: Json }
      portal_list_disputes: { Args: never; Returns: Json }
      portal_list_invoices: {
        Args: never
        Returns: {
          balance_brl: number
          bls: string[]
          id: number
          invoice_number: string
          invoice_type: string
          issued_at: string
          pods: string[]
          status: string
          total_brl: number
          total_paid_brl: number
          vessel_voyages: string[]
          vessels: string[]
          voyages: string[]
        }[]
      }
      portal_list_notifications: { Args: { p_limit?: number }; Returns: Json }
      portal_list_operation_bls: { Args: never; Returns: Json }
      portal_list_operation_bls_without_transshipment: {
        Args: never
        Returns: Json
      }
      portal_list_provisioning_console: {
        Args: { p_customer_id?: number }
        Returns: Json[]
      }
      portal_list_provisioning_events: {
        Args: { p_customer_id: number; p_limit?: number }
        Returns: {
          account_id: number | null
          actor_id: string | null
          actor_type: string
          created_at: string
          customer_id: number
          id: number
          invite_id: number | null
          new_decision: string | null
          new_situation: string | null
          previous_decision: string | null
          previous_situation: string | null
          reason: string | null
          request_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "portal_provisioning_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      portal_login_check_rate_limit: {
        Args: { p_login: string }
        Returns: boolean
      }
      portal_login_register_failure: {
        Args: { p_login: string }
        Returns: undefined
      }
      portal_login_register_success: {
        Args: { p_login: string }
        Returns: undefined
      }
      portal_mark_all_notifications_read: { Args: never; Returns: undefined }
      portal_mark_expired_invites: {
        Args: never
        Returns: {
          expired_count: number
        }[]
      }
      portal_mark_notification_read: {
        Args: { p_notification_id: number }
        Returns: undefined
      }
      portal_notification_unread_count: { Args: never; Returns: number }
      portal_obsolete_consolidation: {
        Args: { p_invoice_id: number }
        Returns: Json
      }
      portal_open_demurrage_dispute: {
        Args: { p_demurrage_invoice_id: number; p_reason: string }
        Returns: Json
      }
      portal_recovery_check_rate_limit: {
        Args: { p_login: string }
        Returns: boolean
      }
      portal_recovery_register_failure: {
        Args: { p_login: string }
        Returns: undefined
      }
      portal_refresh_general_pendencies: { Args: never; Returns: undefined }
      portal_repair_missing_accounts: { Args: never; Returns: number }
      portal_resolve_login: { Args: { p_login: string }; Returns: string }
      portal_return_to_analysis: {
        Args: {
          p_actor_type?: string
          p_customer_id: number
          p_reason: string
          p_request_id?: string
        }
        Returns: undefined
      }
      portal_revoke_sessions: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      portal_set_exception: {
        Args: { p_customer_id: number; p_reason: string; p_request_id?: string }
        Returns: undefined
      }
      portal_ship_schedule: {
        Args: never
        Returns: {
          date_value: string | null
          actual_value: string | null
          imo_number: string | null
          kind: string
          port_code: string
          omitted: boolean
          vessel_name: string
          voyage: string
          voyage_id: number
        }[]
      }
      portal_update_profile: {
        Args: {
          p_address?: string
          p_city?: string
          p_contact_email?: string
          p_phone?: string
          p_state?: string
          p_zip?: string
        }
        Returns: Json
      }
      recalculate_demurrage_invoices: {
        Args: { p_ptax: number; p_quote_date: string; p_source?: string }
        Returns: Json
      }
      recalculate_demurrage_invoices_manual: {
        Args: { p_ptax: number }
        Returns: Json
      }
      reconcile_invoice_payment_by_txid: {
        Args: { p_amount_brl: number; p_paid_at?: string; p_txid: string }
        Returns: Json
      }
      register_invoice_payment: {
        Args: {
          p_actor?: string
          p_amount_brl: number
          p_invoice_id: number
          p_notes?: string
          p_paid_at?: string
          p_payment_method?: string
        }
        Returns: Json
      }
      register_ledger_invoice_payment: {
        Args: {
          p_actor?: string
          p_amount_brl: number
          p_invoice_id: number
          p_method?: string
          p_notes?: string
          p_paid_at?: string
          p_pix_txid?: string
          p_source?: string
        }
        Returns: Json
      }
      reject_customer_reconciliation: {
        Args: { p_actor?: string; p_notes?: string; p_queue_id: number }
        Returns: Json
      }
      reopen_agency_departure_report: {
        Args: { p_justification: string; p_port: string; p_voyage_id: number }
        Returns: Json
      }
      reorder_vessel_schedules: { Args: { p_order: Json }; Returns: number }
      replace_vazios_from_baplie_transactional: {
        Args: {
          p_description: string
          p_replace_existing?: boolean
          p_uploaded_by: string
          p_voyage_id: number
        }
        Returns: Json
      }
      resolve_local_charge_table_id: {
        Args: { p_cargo_mode: string; p_pod: string; p_reference_date: string }
        Returns: number
      }
      reverse_demurrage_payment: {
        Args: { p_actor?: string; p_invoice_id: number; p_reason?: string }
        Returns: Json
      }
      reverse_invoice_payment: {
        Args: { p_actor?: string; p_payment_id: number; p_reason?: string }
        Returns: Json
      }
      run_billing_for_import_batch: {
        Args: { p_actor?: string; p_batch_id: number; p_recalculate?: boolean }
        Returns: Json
      }
      save_bl_demurrage_config: {
        Args: {
          p_bl_id: string
          p_changed_by: string
          p_expected_updated_at: string
          p_free_time_override: number
          p_rate_p1_usd: number
          p_rate_p2_usd: number
        }
        Returns: undefined
      }
      save_bl_review: {
        Args: {
          p_audit_rows: Json
          p_bl_id: string
          p_changed_by: string
          p_expected_updated_at: string
          p_update_payload: Json
        }
        Returns: Json
      }
      save_exchange_rate_reference: {
        Args: { p_effective_date: string; p_ptax: number; p_roe: number }
        Returns: undefined
      }
      save_granite_bl_review: {
        Args: {
          p_changed_by: string
          p_client_id: number
          p_granite_bl_id: string
        }
        Returns: undefined
      }
      save_voyage_escala_terminal_state: {
        Args: {
          p_expected_revision: number
          p_export_expectation: Json
          p_fronts: Json
          p_justification: string
          p_port: string
          p_terminals: Json
          p_voyage_id: number
        }
        Returns: Json
      }
      save_voyage_escala_terminal_state_v2: {
        Args: {
          p_expected_revision: number
          p_export_expectation: Json
          p_fronts: Json
          p_justification: string
          p_port: string
          p_terminals: Json
          p_voyage_id: number
        }
        Returns: Json
      }
      preflight_depots_terminal_port_mapping: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      set_agency_report_department_signoff: {
        Args: {
          p_department: string
          p_justification?: string
          p_port: string
          p_signed: boolean
          p_voyage_id: number
        }
        Returns: Json
      }
      set_agency_report_section_observation: {
        Args: {
          p_observation: string
          p_port: string
          p_section: string
          p_voyage_id: number
        }
        Returns: Json
      }
      set_agency_report_signoff: {
        Args: {
          p_justification?: string
          p_port: string
          p_section: string
          p_state: string
          p_voyage_id: number
        }
        Returns: Json
      }
      set_agency_report_terminal: {
        Args: { p_port: string; p_terminal: string; p_voyage_id: number }
        Returns: undefined
      }
      set_bl_cod: {
        Args: { p_bl_id: string; p_changed_by: string; p_justification: string; p_omission_id: number }
        Returns: undefined
      }
      set_bl_transshipment: {
        Args: {
          p_bl_id: string
          p_changed_by: string
          p_omission_id: number
          p_justification: string
        }
        Returns: undefined
      }
      settle_cod_adjustment: {
        Args: { p_adjustment_id: number; p_actor?: string }
        Returns: Json
      }
      set_customer_portal_account_active: {
        Args: { p_active: boolean; p_actor?: string; p_customer_id: number }
        Returns: Json
      }
      set_import_batch_ce_master: {
        Args: { p_batch_id: number; p_ce_master: string; p_changed_by: string }
        Returns: undefined
      }
      set_voyage_route_ce_master: {
        Args: {
          p_ce_master: string
          p_changed_by: string
          p_pod: string
          p_pol: string
          p_voyage_id: number
        }
        Returns: undefined
      }
      settle_invoice_refund: {
        Args: { p_actor?: string; p_refund_id: number }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      sync_customer_reconciliation_queue_for_bl: {
        Args: { p_bl_id: string }
        Returns: undefined
      }
      sync_local_charge_receivable: {
        Args: { p_bl_id: string }
        Returns: number
      }
      update_container_demurrage_dates: {
        Args: {
          p_container_id: number
          p_demurrage_status: string
          p_discharge_date: string
          p_justification?: string
          p_return_date: string
        }
        Returns: undefined
      }
      update_customer_with_audit: {
        Args: {
          p_changed_by: string
          p_customer_id: number
          p_justification: string
          p_updates: Json
        }
        Returns: boolean
      }
      update_manual_bl_charge: {
        Args: {
          p_actor?: string
          p_charge_calculation_id: number
          p_notes?: string
          p_quantity: number
        }
        Returns: Json
      }
      update_manual_vazios_booking: {
        Args: {
          p_booking_id: string
          p_condition: string
          p_container_number: string
          p_container_type: string
          p_hand_in_date: string
          p_hand_out_date: string
          p_local_id: string
          p_movement_date: string
        }
        Returns: undefined
      }
      update_voyage_omission: {
        Args: {
          p_changed_by: string
          p_omission_id: number
          p_onward_carrier: string
          p_onward_eta: string
          p_onward_etd: string
          p_onward_vessel_name: string
          p_onward_voyage_number: string
          p_reason: string
        }
        Returns: undefined
      }
      upsert_customer_portal_account: {
        Args: {
          p_active?: boolean
          p_actor?: string
          p_contact_email?: string
          p_customer_id: number
          p_login_cnpj?: string
          p_password: string
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

// ---------------------------------------------------------------------------
// Complementos de domínio e read-models
// ---------------------------------------------------------------------------
// O bloco acima é o output integral de @supabase/postgres-meta. Os aliases de
// linha abaixo derivam diretamente dele; tipos adicionais descrevem apenas
// regras de domínio, payloads externos e projeções compostas do frontend.

type FunctionWithArgs<
  Name extends keyof Database['public']['Functions'],
  Args,
> = Omit<Database['public']['Functions'][Name], 'Args'> & { Args: Args }

type AppFunctionOverrides = {
  apply_ce_mercante_manifest: FunctionWithArgs<
    'apply_ce_mercante_manifest',
    Omit<Database['public']['Functions']['apply_ce_mercante_manifest']['Args'], 'p_changed_by'> & {
      p_changed_by: string | null
    }
  >
  apply_ce_mercante_update: FunctionWithArgs<
    'apply_ce_mercante_update',
    Omit<Database['public']['Functions']['apply_ce_mercante_update']['Args'], 'p_changed_by'> & {
      p_changed_by: string | null
    }
  >
  apply_granite_ce_mercante_update: FunctionWithArgs<
    'apply_granite_ce_mercante_update',
    Omit<Database['public']['Functions']['apply_granite_ce_mercante_update']['Args'], 'p_changed_by'> & {
      p_changed_by: string | null
    }
  >
  create_demurrage_invoice_with_items: FunctionWithArgs<
    'create_demurrage_invoice_with_items',
    Omit<
      Database['public']['Functions']['create_demurrage_invoice_with_items']['Args'],
      'p_ready_at' | 'p_roe'
    > & {
      p_ready_at: string | null
      p_roe: number | null
    }
  >
  import_vazios_importacao_transactional: FunctionWithArgs<
    'import_vazios_importacao_transactional',
    Omit<Database['public']['Functions']['import_vazios_importacao_transactional']['Args'], 'p_description'> & {
      p_description: string | null
    }
  >
  omit_voyage_escala: FunctionWithArgs<
    'omit_voyage_escala',
    Omit<
      Database['public']['Functions']['omit_voyage_escala']['Args'],
      | 'p_reason'
      | 'p_onward_vessel_name'
      | 'p_onward_carrier'
      | 'p_onward_voyage_number'
      | 'p_onward_etd'
      | 'p_onward_eta'
    > & {
      p_reason: string | null
      p_onward_vessel_name?: string | null
      p_onward_carrier?: string | null
      p_onward_voyage_number?: string | null
      p_onward_etd?: string | null
      p_onward_eta?: string | null
    }
  >
  import_granite_manifest_transactional: FunctionWithArgs<
    'import_granite_manifest_transactional',
    Omit<
      Database['public']['Functions']['import_granite_manifest_transactional']['Args'],
      'p_loading_port' | 'p_discharge_port'
    > & {
      p_loading_port: string | null
      p_discharge_port: string | null
    }
  >
  replace_vazios_from_baplie_transactional: FunctionWithArgs<
    'replace_vazios_from_baplie_transactional',
    Omit<Database['public']['Functions']['replace_vazios_from_baplie_transactional']['Args'], 'p_description'> & {
      p_description: string | null
    }
  >
  save_bl_demurrage_config: FunctionWithArgs<
    'save_bl_demurrage_config',
    Omit<
      Database['public']['Functions']['save_bl_demurrage_config']['Args'],
      'p_expected_updated_at' | 'p_free_time_override' | 'p_rate_p1_usd' | 'p_rate_p2_usd'
    > & {
      p_expected_updated_at: string | null
      p_free_time_override: number | null
      p_rate_p1_usd: number | null
      p_rate_p2_usd: number | null
    }
  >
  save_bl_review: FunctionWithArgs<
    'save_bl_review',
    Omit<Database['public']['Functions']['save_bl_review']['Args'], 'p_expected_updated_at'> & {
      p_expected_updated_at: string | null
    }
  >
  update_voyage_omission: FunctionWithArgs<
    'update_voyage_omission',
    Omit<
      Database['public']['Functions']['update_voyage_omission']['Args'],
      'p_onward_vessel_name' | 'p_onward_carrier' | 'p_onward_voyage_number' | 'p_onward_etd' | 'p_onward_eta' | 'p_reason'
    > & {
      p_onward_vessel_name: string | null
      p_onward_carrier: string | null
      p_onward_voyage_number: string | null
      p_onward_etd: string | null
      p_onward_eta: string | null
      p_reason: string | null
    }
  >
}

// postgres-meta não infere nullability dos parâmetros de função. O cliente da
// aplicação usa estes overrides estritos, que refletem os parâmetros nullable
// declarados nas migrations sem alterar o output oficial acima.
export type AppDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Functions'> & {
    Functions: Omit<Database['public']['Functions'], keyof AppFunctionOverrides> & AppFunctionOverrides
  }
}

export type UserProfileRole =
  | 'admin'
  | 'operator'
  | 'administrativo'
  | 'financeiro'
  | 'operacoes'
  | 'documentacao'
  | 'equipamentos'

export type UserProfile = Omit<Tables<'user_profiles'>, 'role'> & {
  role: UserProfileRole
}
export type AuditLog = Tables<'audit_logs'>
export type Alert = Tables<'alerts'>
export type Customer = Tables<'customers'>
export type CustomerContact = Tables<'customer_contacts'>
export type CustomerPortalAccount = Tables<'customer_portal_accounts'>
export type PortalInvite = Tables<'portal_invites'>
export type PortalProvisioningEvent = Tables<'portal_provisioning_events'>
export type CustomerRateOverride = Tables<'customer_rate_overrides'>
export type ChargeTable = Tables<'charge_tables'>
export type ChargeTableItem = Tables<'charge_table_items'>
export type ChargeCalculation = Tables<'charge_calculations'>
export type Carrier = Tables<'carriers'>
export type Vessel = Tables<'vessels'>
export type Voyage = Tables<'voyages'>
export type Port = Tables<'ports'>
export type BL = Tables<'bls'>
export type BLContainer = Tables<'bl_containers'>
export type BlFreightLine = Tables<'bl_freight_lines'>
export type BLBreakbulkItem = Tables<'bl_breakbulk_items'>
export type Vehicle = Tables<'vehicles'>
export type ImportBatch = Tables<'import_batches'>
export type ImportError = Tables<'import_errors'>
export type Invoice = Tables<'invoices'>
export type InvoiceItem = Tables<'invoice_items'>
export type InvoicePayment = Tables<'payments'>
export type InvoiceBlLink = Tables<'invoice_bls'>
export type BlReceivable = Tables<'bl_receivables'>
export type InvoiceReceivableLink = Tables<'invoice_receivable_links'>
export type LedgerSettlement = Tables<'ledger_settlements'>
export type InvoiceLifecycleEvent = Tables<'invoice_lifecycle_events'>
export type InvoiceGraniteBlLink = Tables<'invoice_granite_bls'>
export type DemurrageInvoice = Omit<Tables<'demurrage_invoices'>, 'roe_source'> & {
  roe_source: RoeSource | null
}
export type DemurrageInvoiceItem = Tables<'demurrage_invoice_items'>
export type DemurrageInvoiceHistory = Tables<'demurrage_invoice_history'>
export type DemurrageRate = Tables<'demurrage_rates'>
export type GraniteManifest = Tables<'granite_manifests'>
export type GraniteBl = Tables<'granite_bls'>
export type GraniteRate = Tables<'granite_rates'>
export type GraniteBlCharge = Tables<'granite_bl_charges'>
export type VaziosManifest = Tables<'vazios_manifests'>
export type VaziosBooking = Tables<'vazios_bookings'>
export type VaziosExportOperation = Tables<'vazios_export_operations'>
export type VaziosExportServiceLine = Tables<'vazios_export_service_lines'>
export type Depot = Tables<'depots'>
export type DepotService = Tables<'depot_services'>
export type AgencyDepartureReport = Tables<'agency_departure_reports'>
export type AgencyReportOccurrence = Tables<'agency_departure_report_occurrences'>
export type VaziosImportacaoManifest = Tables<'vazios_importacao_manifests'>
export type BaplieContainer = Tables<'baplie_containers'>
export type VesselSchedule = Tables<'vessel_schedules'>
export type EndedVessel = Tables<'ended_vessels'>

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

type GeneratedConsolidatableReceivable =
  Database['public']['Functions']['list_consolidatable_receivables']['Returns'][number]

// PostgreSQL RETURNS TABLE não expõe nullability por coluna ao gerador. Esta
// projeção contém LEFT JOINs para viagem/navio/fatura individual; portanto os
// campos abaixo são nullable mesmo que o contrato oficial os marque como text.
export type ConsolidatableReceivable = Omit<
  GeneratedConsolidatableReceivable,
  | 'voyage_id'
  | 'vessel_name'
  | 'voyage_number'
  | 'individual_invoice_id'
  | 'individual_invoice_number'
  | 'receivable_status'
  | 'eligibility_status'
> & {
  voyage_id: number | null
  vessel_name: string | null
  voyage_number: string | null
  individual_invoice_id: number | null
  individual_invoice_number: string | null
  receivable_status: BlReceivableStatus
  eligibility_status: 'eligible' | 'paid' | 'no_balance' | 'open_consolidated'
}

export type LedgerPaymentResult = {
  invoice_id: number
          payment_id: number | null
  status: 'paid' | 'partially_paid'
  amount_brl: number
  balance_brl: number
  refund_due_brl: number
  receivables_settled: number
  individuals_covered: number
  consolidated_obsoleted: number
}

export type ConsolidatedInvoiceResult = {
  invoice_id: number
  invoice_number: string | null
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

export type ReconcileByTxidResult =
  | { matched: false; reason: string }
  | { matched: true; invoice_id: number; settled: false; reason: string }
  | { matched: true; invoice_id: number; settled: true; payment: LedgerPaymentResult }

export type InvoiceSummary = Invoice & {
  customer?: Pick<Customer, 'id' | 'name' | 'cnpj_cpf'> | null
  invoice_bls?: Pick<InvoiceBlLink, 'id' | 'bl_id' | 'subtotal_brl' | 'subtotal_usd'>[] | null
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

export type RoeSource = 'bcb_live' | 'cached' | 'manual'

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
  bl?: (Pick<
    BL,
    | 'id'
    | 'pol'
    | 'pod'
    | 'free_time_override'
    | 'demurrage_rate_override_p1_usd'
    | 'demurrage_rate_override_p2_usd'
    | 'demurrage_roe_manual'
    | 'demurrage_roe'
  > & {
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
  lineNumber?: number
}

export type BLListItem = BL & {
  customer?: Pick<Customer, 'id' | 'cnpj_cpf' | 'name'> | null
  voyage?: (Pick<Voyage, 'id' | 'voyage_number' | 'eta' | 'ata' | 'status'> & {
    vessel?: (Pick<Vessel, 'id' | 'name' | 'imo'> & {
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
  bl_freight_lines?: BlFreightLine[] | null
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
  bl_freight_lines?: BlFreightLine[] | null
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
      vessel?: (Pick<Vessel, 'id' | 'name' | 'imo'> & {
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
  invoices?: Pick<Invoice, 'id' | 'invoice_number' | 'issued_at' | 'total_brl' | 'balance_brl' | 'status'>[] | null
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

export type GraniteBlListItem = GraniteBl & {
  manifest?: Pick<GraniteManifest, 'id' | 'vessel_voyage' | 'voyage_id'> | null
  customer?: Pick<Customer, 'id' | 'name'> | null
}

export type VaziosBookingListItem = VaziosBooking & {
  manifest?: Pick<VaziosManifest, 'id' | 'voyage_id'> & {
    voyage?: Pick<Voyage, 'id' | 'voyage_number'> & {
      vessel?: Pick<Vessel, 'id' | 'name'> | null
    } | null
  } | null
}

// Seis seções vivas — espelha o CHECK de agency_departure_report_signoffs.section
// (migration 253). 'ocorrencias' saiu na ADR 0030 e 'operacao_patio' na 0036;
// as duas seguem em audit_logs e snapshots fechados, e são lidas por
// agencyReportSectionLabel, não por este tipo.
export type AgencyReportSectionKey =
  | 'datas'
  | 'carga_descarregada'
  | 'carga_carregada'
  | 'veiculos'
  | 'vazios_embarcados'
  | 'vazios_descarregados'

export type AgencyReportDepartmentKey = 'operacoes' | 'documentacao' | 'equipamentos'

export type AgencyReportSignoff = Omit<
  Tables<'agency_departure_report_signoffs'>,
  'section' | 'state'
> & {
  section: AgencyReportSectionKey
  state: 'pending' | 'confirmed' | 'nothing_to_declare'
}

export type AgencyReportDepartmentSignoff = Omit<
  Tables<'agency_departure_report_department_signoffs'>,
  'department'
> & {
  department: AgencyReportDepartmentKey
}

export type VaziosImportacaoContainer = Omit<
  Tables<'vazios_importacao_containers'>,
  'natureza'
> & {
  natureza: 'cama' | 'cover_plate' | null
}

export type VaziosImportacaoContainerListItem = VaziosImportacaoContainer & {
  manifest?: (Pick<VaziosImportacaoManifest, 'id' | 'voyage_id' | 'description' | 'imported_at'> & {
    voyage?: { voyage_number: string; vessel: { name: string } | null } | null
  }) | null
}

export type VoyageExportSchedule = Omit<
  Tables<'voyage_export_schedules'>,
  'ce_status'
> & {
  ce_status: 'waiting' | 'received' | 'launching' | 'approving' | 'approved' | null
}

export type VoyageExportCeStatus = NonNullable<VoyageExportSchedule['ce_status']>
