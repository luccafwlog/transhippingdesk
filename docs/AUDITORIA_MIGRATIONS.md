# Fase 3 — Relatório Final de Auditoria de Migrations

Total: **159** migrations | Banco `fgmkhbzhaeebrsizwccx` (Transhipping Desk) — todas registradas em `schema_migrations` (match 1:1, zero nunca-executadas).

## Tabela de status

| # | Migration | Status | Objetos | Obs/Ação |
|---|---|---|---|---|
| 1 | `001_schema.sql` | ✅ OK | +TABLE: alerts, audit_logs, bl_containers, bls +16; +INDEX: idx_audit_logs_entity, idx_bl_containers_bl_id, idx_bl_containers_number, idx_bls_customer_id +4 | manter |
| 2 | `002_rls.sql` | ✅ OK | GRANTx3/REVOKEx0 | manter |
| 3 | `003_functions.sql` | ✅ OK | +TABLE: invoice_counters; +FUNCTION: assign_invoice_number, prevent_pending_review_invoice, set_updated_at; +TRIGGER: assign_invoice_number, prevent_pending_review_invoice, set_bls_updated_at, set_customers_updated_at; +POLICY: invoice_counters_service_only; GRANTx1/REVOKEx0 | manter |
| 4 | `004_vehicles.sql` | 📦 Unificável | +TABLE: vehicles; +FUNCTION: validate_vehicle_relationships; +INDEX: idx_vehicles_bl_id, idx_vehicles_chassis, idx_vehicles_container_id, idx_vehicles_voyage_chassis_unique +1; +TRIGGER: validate_vehicle_relationships; +POLICY: vehicles_delete_authenticated, vehicles_insert_authenticated, vehicles_select_authenticated, vehicles_update_authenticated; GRANTx2/REVOKEx0 | U1 vehicles |
| 5 | `005_vehicles_model.sql` | 📦 Unificável | +FUNCTION: validate_vehicle_relationships; col+: model | U1 vehicles |
| 6 | `006_breakbulk_module.sql` | 📦 Unificável | +TABLE: bl_breakbulk_items; +FUNCTION: validate_bl_breakbulk_item_parent; +INDEX: idx_bl_breakbulk_items_bl_id; +TRIGGER: validate_bl_breakbulk_item_parent; +POLICY: bl_breakbulk_items_delete_authenticated, bl_breakbulk_items_insert_authenticated, bl_breakbulk_items_select_authenticated, bl_breakbulk_items_update_authenticated; col+: cargo_mode; GRANTx2/REVOKEx0 | U2 breakbulk |
| 7 | `007_import_batches_cargo_mode.sql` | ✅ OK | +INDEX: idx_import_batches_cargo_mode; col+: cargo_mode | manter |
| 8 | `008_bls_ce_mercante.sql` | ✅ OK | +INDEX: idx_bls_ce_mercante; col+: ce_mercante | manter |
| 9 | `009_breakbulk_manifest_fields.sql` | 📦 Unificável | col+: bb_machine_qty, bb_packages_qty, bb_packages_total, bb_weight_ton | U2 breakbulk |
| 10 | `010_rls_by_role.sql` | ✅ OK | +FUNCTION: current_user_role, is_active_user, is_admin; +POLICY: invoice_counters_admin_all, user_profiles_admin_delete, user_profiles_admin_insert, user_profiles_admin_update +2; GRANTx3/REVOKEx3 | manter |
| 11 | `011_schema_hardening.sql` | ✅ OK | +INDEX: idx_alerts_assigned_to, idx_alerts_status_created, idx_audit_logs_changed_at, idx_audit_logs_changed_by_at +10; col+: file_hash | manter |
| 12 | `012_transactional_rpcs.sql` | ✅ OK | +FUNCTION: apply_ce_mercante_update, import_manifest_transactional, save_bl_review; GRANTx3/REVOKEx3 | manter |
| 13 | `013_preserve_links_on_manifest_reimport.sql` | ✅ OK | +FUNCTION: import_manifest_transactional; GRANTx1/REVOKEx1 | manter |
| 14 | `014_lock_down_financial_reads_and_audit_writes.sql` | ✅ OK | +POLICY: audit_logs_delete_admin, audit_logs_insert_self, audit_logs_select_active, audit_logs_update_admin | manter |
| 15 | `015_rate_limit_imports.sql` | ✅ OK | +FUNCTION: import_manifest_transactional; GRANTx1/REVOKEx1 | manter |
| 16 | `016_local_charges_stage_a.sql` | ✅ OK | +FUNCTION: calculate_bl_local_charges, list_bl_local_charge_lines, normalize_port_code, resolve_local_charge_table_id; +INDEX: idx_bls_charge_status, idx_charge_table_items_table_active, idx_customer_rate_overrides_scope, uq_charge_calculations_bl_key +2; col+: active, application_basis, calculation_key, cargo_mode +19; GRANTx2/REVOKEx2 | manter |
| 17 | `017_breakbulk_columns_compat.sql` | 🔁 Duplicata | col+: bb_machine_qty, bb_packages_qty, bb_packages_total, bb_weight_ton | ≡ cols de 009 (idempotente) |
| 18 | `018_charge_calculations_conflict_index_fix.sql` | ✅ OK | +INDEX: uq_charge_calculations_bl_key; -INDEX: uq_charge_calculations_bl_key | manter |
| 19 | `019_local_charges_manual_and_status_workflow.sql` | ✅ OK | +FUNCTION: add_manual_bl_charge, delete_manual_bl_charge, list_manual_charge_items_for_bl, mark_bl_charges_reviewed +2; GRANTx6/REVOKEx6 | manter |
| 20 | `020_billing_hybrid_workflow.sql` | ✅ OK | +TABLE: invoice_bls; +FUNCTION: cancel_invoice, create_invoice_from_bls, list_invoice_details, register_invoice_payment; +INDEX: idx_invoice_bls_bl_id, idx_invoice_bls_invoice_id, idx_invoices_customer_issued_at, idx_invoices_status_due_date; +TRIGGER: set_invoices_updated_at; +POLICY: invoice_bls_delete_admin, invoice_bls_insert_admin, invoice_bls_select_admin, invoice_bls_update_admin; col+: balance_brl, cancel_reason, issued_by, total_paid_brl +1; GRANTx6/REVOKEx4 | manter |
| 21 | `021_save_bl_review_stale_fast_fail.sql` | 📦 Unificável | +FUNCTION: save_bl_review; GRANTx1/REVOKEx1 | U3 save_bl_review |
| 22 | `022_save_bl_review_conflict_code_pt409.sql` | 📦 Unificável | +FUNCTION: save_bl_review; GRANTx1/REVOKEx1 | U3 save_bl_review |
| 23 | `023_customer_commercial_rules.sql` | ✅ OK | col+: commercial_notes, discount_pct, payment_terms_days | manter |
| 24 | `024_detect_overdue_invoices.sql` | ✅ OK | +FUNCTION: detect_overdue_invoices | manter |
| 25 | `025_billing_orchestration_portal.sql` | ✅ OK | +TABLE: billing_batches, billing_run_logs, billing_runs, customer_portal_accounts +3; +FUNCTION: approve_customer_reconciliation, cancel_invoice, create_invoice_from_bls, create_invoice_from_bls_core +24; +INDEX: idx_billing_run_logs_run_id, idx_billing_runs_manifest_id, idx_bls_customer_reconciliation_status, idx_charge_calculations_billing_run_id +5; +TRIGGER: populate_charge_calculation_billing_metadata, set_billing_batches_updated_at, set_customer_portal_accounts_updated_at, set_customer_reconciliation_queue_updated_at; col+: billing_hold_reason, billing_run_id, bl_id, calculation_key +15; GRANTx25/REVOKEx26 | manter |
| 26 | `026_portal_crypto_schema_fix.sql` | ✅ OK | +FUNCTION: portal_login, resolve_customer_portal_session, upsert_customer_portal_account; GRANTx3/REVOKEx3 | manter |
| 27 | `027_portal_overview_open_balance.sql` | ✅ OK | +FUNCTION: portal_get_session_overview; GRANTx1/REVOKEx1 | manter |
| 28 | `028_demurrage_module.sql` | ✅ OK | +TABLE: demurrage_invoice_items, demurrage_invoices; +FUNCTION: set_container_discharge_date, touch_demurrage_invoice_updated_at; +TRIGGER: trg_container_discharge_date, trg_demurrage_invoice_updated_at; +POLICY: authenticated_delete_demurrage_invoices, authenticated_delete_demurrage_items, authenticated_insert_demurrage_invoices, authenticated_insert_demurrage_items +3; col+: demurrage_rate_override_p1_usd, demurrage_rate_override_p2_usd, demurrage_roe, demurrage_roe_manual +3 | manter |
| 29 | `029_container_dates_indexes.sql` | ✅ OK | +INDEX: idx_bl_containers_demurrage_status, idx_bl_containers_discharge_date | manter |
| 30 | `030_charge_table_required.sql` | ✅ OK | +FUNCTION: mark_bl_ready_for_billing; GRANTx1/REVOKEx1 | manter |
| 31 | `031_overdue_enforcement.sql` | 💀 Obsoleta | +FUNCTION: fn_block_invoice_overdue_customer, mark_overdue_invoices; +TRIGGER: trg_block_invoice_overdue_customer; GRANTx1/REVOKEx1 | lógica overdue revertida por 20260624131000 |
| 32 | `032_invoices_pix_columns.sql` | ✅ OK | +INDEX: idx_invoices_pix_txid; col+: conciliated_by_extract, pix_txid | manter |
| 33 | `033_portal_demurrage.sql` | ✅ OK | +FUNCTION: portal_get_demurrage_invoice_detail, portal_list_demurrage_invoices; GRANTx2/REVOKEx2 | manter |
| 34 | `034_granite_module.sql` | ✅ OK | +TABLE: granite_bl_charges, granite_bls, granite_manifests, granite_rates; +INDEX: idx_granite_bl_charges_bl_id, idx_granite_bls_client_id, idx_granite_bls_manifest_id, idx_granite_manifests_voyage_id; +POLICY: granite_bl_charges_delete, granite_bl_charges_insert, granite_bl_charges_select, granite_bl_charges_update +12; GRANTx4/REVOKEx0 | manter |
| 35 | `035_vazios_module.sql` | ✅ OK | +TABLE: vazios_bookings, vazios_manifests; +INDEX: idx_vazios_bookings_manifest_id, idx_vazios_manifests_voyage_id; +POLICY: vazios_bookings_delete, vazios_bookings_insert, vazios_bookings_select, vazios_bookings_update +4; GRANTx2/REVOKEx0 | manter |
| 36 | `036_vazios_importacao_module.sql` | 📦 Unificável | +TABLE: vazios_importacao_containers, vazios_importacao_manifests; +INDEX: idx_vazios_imp_containers_manifest, idx_vazios_imp_manifests; +POLICY: vazios_imp_containers_delete, vazios_imp_containers_insert, vazios_imp_containers_select, vazios_imp_containers_update +4; GRANTx2/REVOKEx0 | U5 vazios_imp |
| 37 | `037_vazios_importacao_voyage_link.sql` | 📦 Unificável | +INDEX: idx_vazios_imp_manifests_voyage_id; col+: voyage_id | U5 vazios_imp |
| 38 | `038_portal_invoice_alert.sql` | ✅ OK | +FUNCTION: portal_create_consolidation; GRANTx1/REVOKEx1 | manter |
| 39 | `039_granite_invoiceable_view.sql` | ✅ OK | +TABLE: invoice_granite_bls; +FUNCTION: create_invoice_from_granite_bls; +INDEX: idx_granite_bls_billing, idx_invoice_granite_bls_bl, idx_invoice_granite_bls_invoice; +POLICY: invoice_granite_bls_delete, invoice_granite_bls_insert, invoice_granite_bls_select, invoice_granite_bls_update; GRANTx3/REVOKEx1 | manter |
| 40 | `040_portal_login_rate_limit.sql` | ✅ OK | +TABLE: portal_login_attempts; +FUNCTION: is_admin, portal_login; +INDEX: idx_portal_login_attempts_cnpj_window; GRANTx2/REVOKEx2 | manter |
| 41 | `041_rls_missing_tables.sql` | ✅ OK | +POLICY: billing_batches_delete_admin, billing_batches_insert_admin, billing_batches_select_active, billing_batches_update_admin +17 | manter |
| 42 | `042_rls_module_hardening.sql` | ✅ OK | +FUNCTION: portal_logout; +POLICY: demurrage_invoices_delete_admin, demurrage_invoices_insert_admin, demurrage_invoices_select_active, demurrage_invoices_update_admin +8; GRANTx1/REVOKEx1 | manter |
| 43 | `043_guard_customer_id_ready_for_billing.sql` | ✅ OK | +FUNCTION: mark_bl_ready_for_billing; GRANTx1/REVOKEx1 | manter |
| 44 | `044_portal_supabase_auth_infra.sql` | ✅ OK | +FUNCTION: portal_check_auth_method, portal_get_session_overview_v2; +INDEX: idx_portal_accounts_auth_user_id; col+: auth_user_id, portal_email; GRANTx2/REVOKEx2 | manter |
| 45 | `045_count_distinct_containers_fn.sql` | ✅ OK | +FUNCTION: count_distinct_containers; GRANTx1/REVOKEx1 | manter |
| 46 | `046_voyage_schedule_snapshot_trigger.sql` | ✅ OK | +FUNCTION: trg_voyage_schedule_snapshot; +TRIGGER: trg_voyage_schedule_snapshot; col+: pod_schedule_snapshot, pol_schedule_snapshot | manter |
| 47 | `047_customers_search_index.sql` | ✅ OK | +INDEX: idx_customers_cnpj_cpf_trgm, idx_customers_name_trgm | manter |
| 48 | `048_demurrage_rates_table.sql` | ✅ OK | +TABLE: demurrage_rates; +TRIGGER: set_demurrage_rates_updated_at; +POLICY: admin_gerencia_demurrage_rates, autenticados_leem_demurrage_rates | manter |
| 49 | `049_demurrage_roe_source.sql` | ✅ OK | col+: roe_source | manter |
| 50 | `050_alignment_granite_portal_demurrage.sql` | ✅ OK | +FUNCTION: create_invoice_from_granite_bls, portal_check_auth_method, portal_get_session_overview_v2; +POLICY: demurrage_invoices_delete_admin, demurrage_invoices_insert_active, demurrage_invoices_update_active, demurrage_items_delete_admin +2; GRANTx4/REVOKEx4 | manter |
| 51 | `051_granite_empty_array_guard.sql` | ✅ OK | +FUNCTION: create_invoice_from_granite_bls; GRANTx2/REVOKEx2 | manter |
| 52 | `052_fix_voyage_snapshot_null_new_value.sql` | ✅ OK | +FUNCTION: trg_voyage_schedule_snapshot | manter |
| 53 | `053_security_hardening.sql` | ✅ OK | +TABLE: provision_rate_limit_log; +FUNCTION: check_provision_rate_limit, portal_check_auth_method; +INDEX: idx_provision_rate_limit_user_window; GRANTx2/REVOKEx2 | manter |
| 54 | `054_vazios_importacao_source.sql` | 📦 Unificável | col+: source | U5 vazios_imp |
| 55 | `055_baplie_reconciliation_resolutions.sql` | ✅ OK | +TABLE: baplie_reconciliation_resolutions; +INDEX: baplie_reconciliation_resolutions_voyage_idx; +POLICY: Authenticated users can insert baplie_reconciliation_resolutions, Authenticated users can read baplie_reconciliation_resolutions, Authenticated users can update baplie_reconciliation_resolutions | manter |
| 56 | `20260520132021_create_baplie_containers_staging.sql` | ✅ OK | +TABLE: baplie_containers; +INDEX: baplie_containers_container_number_idx, baplie_containers_voyage_id_idx; +POLICY: Authenticated users can delete baplie_containers, Authenticated users can insert baplie_containers, Authenticated users can read baplie_containers, Authenticated users can update baplie_containers | manter |
| 57 | `20260520142818_add_pod_to_vazios_importacao_containers.sql` | 📦 Unificável | col+: pod | U5 vazios_imp |
| 58 | `20260520172541_vazios_importacao_source.sql` | 🔁 Duplicata | col+: source | ≡ 054 byte-a-byte (no-op IF NOT EXISTS) |
| 59 | `20260521000000_voyage_export_schedules.sql` | 📦 Unificável | +TABLE: voyage_export_schedules; +INDEX: ON; +POLICY: Authenticated users can delete voyage_export_schedules, Authenticated users can insert voyage_export_schedules, Authenticated users can read voyage_export_schedules, Authenticated users can update voyage_export_schedules | U4 voyage_export |
| 60 | `20260521100000_voyage_export_schedules_ces_linked.sql` | 📦 Unificável | col+: ce_status, linked | U4 voyage_export |
| 61 | `20260521110000_voyage_export_schedules_pol.sql` | 📦 Unificável | col+: pol | U4 voyage_export |
| 62 | `20260523120000_taxas_locais_granito.sql` | ✅ OK | — | manter |
| 63 | `20260528114948_fix_billing_validation_alignment.sql` | ✅ OK | +FUNCTION: mark_bl_ready_for_billing, normalize_port_code, promote_calculated_bl_ready_for_billing; +TRIGGER: trg_promote_calculated_bl_ready; GRANTx1/REVOKEx1 | manter |
| 64 | `20260528134131_fix_granite_invoice_cancel_reissue.sql` | ✅ OK | +FUNCTION: cancel_invoice, create_invoice_from_granite_bls, guard_container_bl_without_containers, prevent_duplicate_active_invoice_bl_link +1; +TRIGGER: trg_guard_container_bl_without_containers, trg_prevent_duplicate_active_invoice_bl_link, trg_prevent_duplicate_active_invoice_granite_bl_link | manter |
| 65 | `20260528190050_fix_null_charge_status_cntr.sql` | ✅ OK | +FUNCTION: ensure_container_bl_charge_status_default; +TRIGGER: trg_ensure_container_bl_charge_status_default | manter |
| 66 | `20260529100000_local_billing_ledger_phase1.sql` | ✅ OK | +TABLE: bl_receivables, invoice_lifecycle_events, invoice_receivable_links, ledger_settlements; +FUNCTION: backfill_invoice_receivable_links, backfill_local_charge_receivables, list_consolidatable_receivables, sync_local_charge_receivable; +INDEX: idx_bl_receivables_bl, idx_bl_receivables_customer_status, idx_bl_receivables_voyage, idx_invoice_lifecycle_events_invoice +4; +POLICY: bl_receivables_delete_admin, bl_receivables_insert_admin, bl_receivables_select_admin, bl_receivables_update_admin +12; col+: covered_by_invoice_id, invoice_type, obsolete_reason, replaced_by_invoice_id; GRANTx12/REVOKEx4 | manter |
| 67 | `20260529110000_local_billing_ledger_phase2.sql` | ✅ OK | +FUNCTION: create_local_consolidated_invoice, obsolete_consolidated_invoice, reconcile_invoice_payment_by_txid, register_ledger_invoice_payment; GRANTx4/REVOKEx4 | manter |
| 68 | `20260529120000_ledger_auto_emit_phase4a.sql` | ✅ OK | +FUNCTION: emit_invoice_on_bl_ready, link_invoice_to_ledger; +TRIGGER: trg_emit_invoice_on_bl_ready; GRANTx1/REVOKEx1 | manter |
| 69 | `20260529130000_ledger_portal_reports_phase4d.sql` | ✅ OK | +FUNCTION: portal_get_session_overview, portal_get_session_overview_v2, portal_list_invoices, portal_list_pending_bls; GRANTx4/REVOKEx4 | manter |
| 70 | `20260529140000_ledger_individual_invoice_rpc.sql` | ✅ OK | +FUNCTION: create_local_individual_invoice_from_receivable, emit_invoice_on_bl_ready, sync_local_charge_receivable; +TRIGGER: trg_emit_invoice_on_bl_ready; GRANTx2/REVOKEx2 | manter |
| 71 | `20260529141000_ledger_settlement_uniqueness_guards.sql` | ✅ OK | +INDEX: idx_ledger_settlements_one_live_receivable, idx_ledger_settlements_unique_normalized_pix_txid | manter |
| 72 | `20260529142000_ledger_backfill_exception_report.sql` | ✅ OK | +FUNCTION: backfill_invoice_receivable_links, backfill_local_charge_receivables; GRANTx2/REVOKEx2 | manter |
| 73 | `20260529143000_ledger_obsolete_consolidated_links.sql` | ✅ OK | +FUNCTION: mark_obsolete_consolidated_links; +TRIGGER: trg_mark_obsolete_consolidated_links | manter |
| 74 | `20260529144000_ledger_invoice_pix_payload.sql` | ✅ OK | +FUNCTION: build_transshipping_pix_payload, pix_crc16_ccitt, pix_tlv, populate_local_invoice_pix_payload; +TRIGGER: trg_populate_local_invoice_pix_payload | manter |
| 75 | `20260529145000_ledger_pix_txid_single_settlement_row.sql` | ✅ OK | +FUNCTION: keep_single_pix_txid_settlement_row; +TRIGGER: trg_keep_single_pix_txid_settlement_row | manter |
| 76 | `20260529150000_ledger_consolidated_reissue_links.sql` | ✅ OK | +FUNCTION: mark_replaced_obsolete_consolidated_invoice; +TRIGGER: trg_mark_replaced_obsolete_consolidated_invoice | manter |
| 77 | `20260530102906_fix_user_profile_privilege_escalation.sql` | 📦 Unificável | +FUNCTION: prevent_user_profile_privilege_escalation; +TRIGGER: trg_prevent_user_profile_privilege_escalation; GRANTx0/REVOKEx1 | U9 sec_hardening |
| 78 | `20260530102907_revoke_anon_execute_security_definer.sql` | 📦 Unificável | GRANTx0/REVOKEx1 | U9 sec_hardening |
| 79 | `20260530102908_set_function_search_path.sql` | 📦 Unificável | — | U9 sec_hardening |
| 80 | `20260530102909_tighten_permissive_rls_policies.sql` | 📦 Unificável | +POLICY: baplie_containers_delete_active, baplie_containers_insert_active, baplie_containers_update_active, voyage_export_schedules_delete_active +2 | U9 sec_hardening |
| 81 | `20260602141903_invoice_manual_other_charges.sql` | ✅ OK | +FUNCTION: add_manual_invoice_charge, delete_manual_invoice_charge; GRANTx2/REVOKEx2 | manter |
| 82 | `20260602142605_invoice_manual_other_charges_revoke_anon.sql` | ✅ OK | GRANTx0/REVOKEx2 | manter |
| 83 | `20260603115147_portal_ledger_alignment.sql` | 📦 Unificável | +FUNCTION: create_local_consolidated_invoice, create_local_consolidated_invoice_core, portal_create_consolidation, portal_invoice_details +1; -FUNCTION: portal_create_consolidation, portal_list_pending_bls; GRANTx0/REVOKEx1 | U6 portal_redesign |
| 84 | `20260603130350_portal_auth_uid_rework.sql` | 📦 Unificável | +FUNCTION: current_portal_customer_id, portal_create_consolidation, portal_get_demurrage_invoice_detail, portal_invoice_details +4; -FUNCTION: portal_create_consolidation, portal_get_demurrage_invoice_detail, portal_invoice_details, portal_list_consolidatable_receivables +2; GRANTx8/REVOKEx0 | U6 portal_redesign |
| 85 | `20260603192044_portal_billing_redesign.sql` | 📦 Unificável | +FUNCTION: portal_invoice_details, portal_list_invoices; -FUNCTION: portal_list_invoices; GRANTx2/REVOKEx0 | U6 portal_redesign |
| 86 | `20260608174131_consolidated_invoice_item_breakdown.sql` | ✅ OK | +FUNCTION: get_consolidated_invoice_item_breakdown; GRANTx1/REVOKEx1 | manter |
| 87 | `20260608191844_apply_ce_mercante_manifest.sql` | ✅ OK | +FUNCTION: apply_ce_mercante_manifest; GRANTx1/REVOKEx1 | manter |
| 88 | `20260608192000_revoke_anon_apply_ce_mercante_manifest.sql` | ✅ OK | GRANTx0/REVOKEx1 | manter |
| 89 | `20260609132000_demurrage_date_order_constraints.sql` | ✅ OK | — | manter |
| 90 | `20260609133000_restrict_consolidated_invoice_breakdown.sql` | ✅ OK | +FUNCTION: get_consolidated_invoice_item_breakdown; GRANTx1/REVOKEx1 | manter |
| 91 | `20260609134000_harden_remaining_permissive_rls.sql` | ✅ OK | +POLICY: baplie_containers_delete_admin, baplie_containers_insert_active, baplie_containers_select_active, baplie_containers_update_active +8 | manter |
| 92 | `20260609200829_portal_operation_bls.sql` | ✅ OK | +FUNCTION: portal_list_operation_bls; GRANTx1/REVOKEx1 | manter |
| 93 | `20260609225321_revoke_anon_security_definer_comprehensive.sql` | ✅ OK | GRANTx0/REVOKEx2 | manter |
| 94 | `20260609225846_drop_duplicate_invoices_index.sql` | ✅ OK | -INDEX: idx_invoices_customer_issued_at | manter |
| 95 | `20260610094207_confirm_demurrage_pix_matches_batch.sql` | ✅ OK | +FUNCTION: confirm_demurrage_pix_matches; GRANTx0/REVOKEx1 | manter |
| 96 | `20260610094629_rls_initplan_performance_pass.sql` | ✅ OK | +POLICY: demurrage_rates_admin_delete, demurrage_rates_admin_insert, demurrage_rates_admin_update, user_profiles_update | manter |
| 97 | `20260610163251_vazios_importacao_delete_admin_only.sql` | ✅ OK | +FUNCTION: delete_baplie_manifest_for_voyage; GRANTx0/REVOKEx1 | manter |
| 98 | `20260612144751_fix_recalc_clears_billing_hold_reason.sql` | ✅ OK | +FUNCTION: calculate_bl_local_charges; GRANTx1/REVOKEx1 | manter |
| 99 | `20260612153000_transactional_baplie_vehicle_imports.sql` | ✅ OK | +FUNCTION: import_baplie_staging_transactional, import_vehicle_rows_transactional; GRANTx2/REVOKEx2 | manter |
| 100 | `20260612154000_create_invoice_from_bls_with_ledger.sql` | ✅ OK | +FUNCTION: create_invoice_from_bls_with_ledger; GRANTx1/REVOKEx1 | manter |
| 101 | `20260612155000_manifest_import_postprocess_transactional.sql` | ✅ OK | +FUNCTION: import_manifest_with_postprocess_transactional; GRANTx1/REVOKEx1 | manter |
| 102 | `20260612160000_mark_ready_and_invoice_atomic.sql` | ✅ OK | +FUNCTION: mark_bl_ready_and_create_invoice; GRANTx1/REVOKEx1 | manter |
| 103 | `20260612161000_confirm_unified_pix_matches.sql` | ✅ OK | +FUNCTION: confirm_unified_pix_matches; GRANTx2/REVOKEx1 | manter |
| 104 | `20260612162000_register_ledger_partial_payments.sql` | ✅ OK | +FUNCTION: register_ledger_invoice_payment; GRANTx1/REVOKEx1 | manter |
| 105 | `20260612163000_portal_invoice_history_links.sql` | ✅ OK | +FUNCTION: portal_invoice_details, portal_list_invoices; GRANTx2/REVOKEx0 | manter |
| 106 | `20260612164000_fix_pix_txid_trigger_for_partial_payments.sql` | ✅ OK | +FUNCTION: keep_single_pix_txid_settlement_row | manter |
| 107 | `20260613170000_reverse_invoice_payment.sql` | ✅ OK | +FUNCTION: reverse_demurrage_payment, reverse_invoice_payment; GRANTx2/REVOKEx2 | manter |
| 108 | `20260614120000_guard_manual_charges_and_clear_pix_on_reversal.sql` | ✅ OK | +FUNCTION: add_manual_bl_charge, add_manual_invoice_charge, delete_manual_bl_charge, delete_manual_invoice_charge +2; GRANTx6/REVOKEx6 | manter |
| 109 | `20260614135728_fix_anon_executable_import_rpcs.sql` | ✅ OK | +FUNCTION: import_baplie_staging_transactional, import_vehicle_rows_transactional; GRANTx2/REVOKEx2 | manter |
| 110 | `20260614140808_revoke_anon_reverse_payment_rpcs.sql` | ✅ OK | GRANTx2/REVOKEx2 | manter |
| 111 | `20260614160000_pix_exact_and_manual_overpayment_refunds.sql` | ✅ OK | +TABLE: invoice_refunds; +FUNCTION: get_invoice_pending_refund, register_ledger_invoice_payment; +INDEX: idx_invoice_refunds_invoice, idx_invoice_refunds_pending; +POLICY: invoice_refunds_delete_admin, invoice_refunds_insert_admin, invoice_refunds_select_admin, invoice_refunds_update_admin; GRANTx2/REVOKEx2 | manter |
| 112 | `20260614170000_settle_invoice_refunds.sql` | ✅ OK | +FUNCTION: list_invoice_refunds, settle_invoice_refund; GRANTx2/REVOKEx2 | manter |
| 113 | `20260614180000_require_justification_on_payment_reversal.sql` | ✅ OK | +FUNCTION: reverse_demurrage_payment, reverse_invoice_payment; GRANTx2/REVOKEx2 | manter |
| 114 | `20260615000001_portal_fase1_indexes_and_cleanup.sql` | 📦 Unificável | +INDEX: idx_bl_receivables_customer_source, idx_demurrage_invoice_items_invoice, idx_demurrage_invoices_customer_status; -FUNCTION: portal_check_auth_method, portal_get_session_overview, portal_login, portal_logout +1; GRANTx0/REVOKEx2 | U7 portal_fase1-3 |
| 115 | `20260615000002_portal_fase1_login_cnpj.sql` | 📦 Unificável | +FUNCTION: get_customer_portal_account, portal_get_session_overview_v2, portal_resolve_login, upsert_customer_portal_account; +INDEX: idx_portal_accounts_login_cnpj; col+: login_cnpj; GRANTx4/REVOKEx4 | U7 portal_fase1-3 |
| 116 | `20260615000003_portal_fase2_notifications_disputes_profile.sql` | 📦 Unificável | +TABLE: portal_notifications; +FUNCTION: notify_demurrage_issued, notify_dispute_responded, notify_invoice_issued, portal_get_profile +7; +INDEX: idx_portal_notifications_customer; +TRIGGER: trg_notify_demurrage_issued, trg_notify_dispute_responded, trg_notify_invoice_issued; GRANTx8/REVOKEx8 | U7 portal_fase1-3 |
| 117 | `20260615000004_portal_fase3_rate_limiting.sql` | 📦 Unificável | +TABLE: portal_rate_limits; +FUNCTION: check_portal_rate_limit, portal_create_consolidation, portal_obsolete_consolidation, portal_open_demurrage_dispute; +INDEX: idx_portal_rate_limits_lookup; GRANTx4/REVOKEx4 | U7 portal_fase1-3 |
| 118 | `20260615010000_fix_bls_financial_status_on_reversal.sql` | ✅ OK | +FUNCTION: reverse_invoice_payment; GRANTx1/REVOKEx1 | manter |
| 119 | `20260615145427_portal_fixes_post_pr227.sql` | ✅ OK | +FUNCTION: portal_list_notifications, portal_obsolete_consolidation, portal_update_profile; GRANTx4/REVOKEx3 | manter |
| 120 | `20260615190000_portal_invoice_consolidated_breakdown.sql` | ✅ OK | +FUNCTION: portal_invoice_details; GRANTx1/REVOKEx0 | manter |
| 121 | `20260615200000_fix_portal_create_consolidation_jsonb.sql` | ✅ OK | +FUNCTION: portal_create_consolidation; GRANTx1/REVOKEx1 | manter |
| 122 | `20260615210000_harden_portal_resolve_login.sql` | ✅ OK | +TABLE: portal_login_resolution_attempts; +FUNCTION: portal_resolve_login; +INDEX: idx_portal_login_resolution_attempts_lookup; GRANTx1/REVOKEx2 | manter |
| 123 | `20260615220000_portal_ce_mercante_gate.sql` | ✅ OK | +FUNCTION: bl_has_portal_release, portal_create_consolidation, portal_get_demurrage_invoice_detail, portal_invoice_details +4; GRANTx7/REVOKEx3 | manter |
| 124 | `20260616000000_vessel_schedules.sql` | ✅ OK | +TABLE: ended_vessels, vessel_schedules; +FUNCTION: update_updated_at_column; +TRIGGER: update_vessel_schedules_updated_at; +POLICY: Authenticated users can view ended vessels, ended_vessels_delete_admin, ended_vessels_insert_active, vessel_schedules_delete_admin +3 | manter |
| 125 | `20260616120000_import_batches_ce_master.sql` | ✅ OK | col+: ce_master | manter |
| 126 | `20260618145508_preserve_customer_billing_block_reason.sql` | ✅ OK | +FUNCTION: import_manifest_with_postprocess_transactional; GRANTx1/REVOKEx1 | manter |
| 127 | `20260618163840_guard_invoiceable_ready_state.sql` | ✅ OK | +FUNCTION: mark_bl_ready_for_billing, promote_calculated_bl_ready_for_billing; +TRIGGER: trg_promote_calculated_bl_ready; GRANTx1/REVOKEx1 | manter |
| 128 | `20260619120000_review_gate_canonical_pendencies.sql` | ✅ OK | +FUNCTION: compute_bl_review_pendencies, save_bl_review; -FUNCTION: save_bl_review; GRANTx2/REVOKEx2 | manter |
| 129 | `20260619130000_review_gate_hardening.sql` | ✅ OK | +FUNCTION: apply_bl_review_gate_after_import, compute_bl_review_pendencies, get_customer_portal_account, import_manifest_with_postprocess_transactional +6; +TRIGGER: prevent_pending_review_invoice, trg_promote_calculated_bl_ready; -FUNCTION: save_bl_review, upsert_customer_portal_account; GRANTx7/REVOKEx11 | manter |
| 130 | `20260619190144_bl_timeline_rpc.sql` | ✅ OK | +FUNCTION: bl_timeline; GRANTx1/REVOKEx2 | manter |
| 131 | `20260622132451_clear_demurrage_extract_flag_on_reversal.sql` | ✅ OK | +FUNCTION: reverse_demurrage_payment; GRANTx1/REVOKEx1 | manter |
| 132 | `20260622132732_create_demurrage_invoice_atomic.sql` | ✅ OK | +FUNCTION: create_demurrage_invoice_with_items; GRANTx1/REVOKEx1 | manter |
| 133 | `20260622133100_mark_bls_ready_and_create_invoice_atomic.sql` | ✅ OK | +FUNCTION: mark_bls_ready_and_create_invoice; GRANTx1/REVOKEx1 | manter |
| 134 | `20260622173159_atomic_customer_update_audit.sql` | ✅ OK | +FUNCTION: update_customer_with_audit; GRANTx1/REVOKEx1 | manter |
| 135 | `20260622174608_atomic_vessel_schedule_operations.sql` | ✅ OK | +FUNCTION: archive_vessel_schedule, reorder_vessel_schedules; GRANTx2/REVOKEx2 | manter |
| 136 | `20260622174832_import_granite_manifest_transactional.sql` | ✅ OK | +FUNCTION: import_granite_manifest_transactional; GRANTx1/REVOKEx1 | manter |
| 137 | `20260622175108_classify_granite_invoices.sql` | ✅ OK | +FUNCTION: classify_granite_invoice; +TRIGGER: trg_classify_granite_invoice; GRANTx0/REVOKEx1 | manter |
| 138 | `20260622180300_audit_container_dates_and_propagate_ata.sql` | ✅ OK | +FUNCTION: propagate_voyage_ata_to_containers, update_container_demurrage_dates; +TRIGGER: trg_propagate_voyage_ata_to_containers; GRANTx1/REVOKEx5 | manter |
| 139 | `20260622213000_grant_vessel_schedule_privileges.sql` | ✅ OK | GRANTx2/REVOKEx0 | manter |
| 140 | `20260622213500_import_batches_rate_limit_timestamp_compat.sql` | ✅ OK | col+: created_at | manter |
| 141 | `20260622214500_secure_billing_core_wrappers.sql` | ✅ OK | GRANTx0/REVOKEx1 | manter |
| 142 | `20260622215000_secure_cancel_invoice_wrapper.sql` | ✅ OK | — | manter |
| 143 | `20260623062000_create_customer_with_contacts_atomic.sql` | ✅ OK | +FUNCTION: create_customer_with_contacts; GRANTx1/REVOKEx1 | manter |
| 144 | `20260623095500_import_breakbulk_manifest_transactional.sql` | ✅ OK | +FUNCTION: import_breakbulk_manifest_transactional; GRANTx1/REVOKEx1 | manter |
| 145 | `20260623110000_set_import_batch_ce_master_atomic.sql` | ✅ OK | +FUNCTION: set_import_batch_ce_master; GRANTx1/REVOKEx1 | manter |
| 146 | `20260623111000_import_vazios_transactional.sql` | ✅ OK | +FUNCTION: import_vazios_bookings_transactional, import_vazios_importacao_transactional, replace_vazios_from_baplie_transactional; GRANTx3/REVOKEx3 | manter |
| 147 | `20260623112000_save_bl_demurrage_config_atomic.sql` | ✅ OK | +FUNCTION: save_bl_demurrage_config; GRANTx1/REVOKEx1 | manter |
| 148 | `20260623120000_save_granite_bl_review_atomic.sql` | ✅ OK | +FUNCTION: save_granite_bl_review; GRANTx1/REVOKEx1 | manter |
| 149 | `20260623130000_remove_billing_from_import_function.sql` | ✅ OK | +FUNCTION: import_manifest_with_postprocess_transactional; GRANTx1/REVOKEx1 | manter |
| 150 | `20260624100000_revoke_anon_portal_read_rpcs.sql` | ✅ OK | GRANTx0/REVOKEx6 | manter |
| 151 | `20260624100100_guard_definer_rpcs_active_user.sql` | ✅ OK | +FUNCTION: calculate_bl_local_charges, detect_overdue_invoices, list_bl_local_charge_lines, list_customer_reconciliation_queue +1; GRANTx5/REVOKEx5 | manter |
| 152 | `20260624110000_revoke_anon_definer_drift.sql` | ✅ OK | GRANTx1/REVOKEx2 | manter |
| 153 | `20260624120000_demurrage_invoice_history.sql` | 📦 Unificável | +TABLE: demurrage_invoice_history; +INDEX: idx_demurrage_inv_hist_date, idx_demurrage_inv_hist_invoice; +POLICY: authenticated_read_demurrage_invoice_history | U8 demurrage_rework |
| 154 | `20260624121000_demurrage_rename_frozen_to_current.sql` | 📦 Unificável | +FUNCTION: confirm_unified_pix_matches, portal_list_demurrage_invoices | U8 demurrage_rework |
| 155 | `20260624122000_demurrage_recalculate_rpcs.sql` | 📦 Unificável | +FUNCTION: recalculate_demurrage_invoices, recalculate_demurrage_invoices_manual; GRANTx2/REVOKEx2 | U8 demurrage_rework |
| 156 | `20260624130000_demurrage_create_invoice_issued.sql` | 📦 Unificável | +FUNCTION: create_demurrage_invoice_with_items; -FUNCTION: create_demurrage_invoice_with_items; GRANTx1/REVOKEx1 | U8 demurrage_rework |
| 157 | `20260624131000_demurrage_drop_overdue.sql` | 📦 Unificável | +FUNCTION: mark_overdue_invoices | U8 demurrage_rework |
| 158 | `20260624140000_demurrage_pix_window_conciliation.sql` | 📦 Unificável | +FUNCTION: confirm_demurrage_pix_matches, confirm_unified_pix_matches, get_demurrage_recent_values; GRANTx2/REVOKEx2 | U8 demurrage_rework |
| 159 | `20260624150000_portal_demurrage_reference.sql` | 📦 Unificável | +FUNCTION: portal_list_demurrage_invoices | U8 demurrage_rework |

## Distribuição

- ✅ OK: 125
- 📦 Unificável: 31
- 🔁 Duplicata: 2
- 💀 Obsoleta: 1

## Mapeamento de Renumber proposto (old → new)

| novo | nome novo | nome antigo | timestamp original (→ comentário no header) |
|---|---|---|---|
| 001 | `001_schema.sql` | `001_schema.sql` | (já 001) |
| 002 | `002_rls.sql` | `002_rls.sql` | (já 002) |
| 003 | `003_functions.sql` | `003_functions.sql` | (já 003) |
| 004 | `004_vehicles.sql` | `004_vehicles.sql` | (já 004) |
| 005 | `005_vehicles_model.sql` | `005_vehicles_model.sql` | (já 005) |
| 006 | `006_breakbulk_module.sql` | `006_breakbulk_module.sql` | (já 006) |
| 007 | `007_import_batches_cargo_mode.sql` | `007_import_batches_cargo_mode.sql` | (já 007) |
| 008 | `008_bls_ce_mercante.sql` | `008_bls_ce_mercante.sql` | (já 008) |
| 009 | `009_breakbulk_manifest_fields.sql` | `009_breakbulk_manifest_fields.sql` | (já 009) |
| 010 | `010_rls_by_role.sql` | `010_rls_by_role.sql` | (já 010) |
| 011 | `011_schema_hardening.sql` | `011_schema_hardening.sql` | (já 011) |
| 012 | `012_transactional_rpcs.sql` | `012_transactional_rpcs.sql` | (já 012) |
| 013 | `013_preserve_links_on_manifest_reimport.sql` | `013_preserve_links_on_manifest_reimport.sql` | (já 013) |
| 014 | `014_lock_down_financial_reads_and_audit_writes.sql` | `014_lock_down_financial_reads_and_audit_writes.sql` | (já 014) |
| 015 | `015_rate_limit_imports.sql` | `015_rate_limit_imports.sql` | (já 015) |
| 016 | `016_local_charges_stage_a.sql` | `016_local_charges_stage_a.sql` | (já 016) |
| 017 | `017_breakbulk_columns_compat.sql` | `017_breakbulk_columns_compat.sql` | (já 017) |
| 018 | `018_charge_calculations_conflict_index_fix.sql` | `018_charge_calculations_conflict_index_fix.sql` | (já 018) |
| 019 | `019_local_charges_manual_and_status_workflow.sql` | `019_local_charges_manual_and_status_workflow.sql` | (já 019) |
| 020 | `020_billing_hybrid_workflow.sql` | `020_billing_hybrid_workflow.sql` | (já 020) |
| 021 | `021_save_bl_review_stale_fast_fail.sql` | `021_save_bl_review_stale_fast_fail.sql` | (já 021) |
| 022 | `022_save_bl_review_conflict_code_pt409.sql` | `022_save_bl_review_conflict_code_pt409.sql` | (já 022) |
| 023 | `023_customer_commercial_rules.sql` | `023_customer_commercial_rules.sql` | (já 023) |
| 024 | `024_detect_overdue_invoices.sql` | `024_detect_overdue_invoices.sql` | (já 024) |
| 025 | `025_billing_orchestration_portal.sql` | `025_billing_orchestration_portal.sql` | (já 025) |
| 026 | `026_portal_crypto_schema_fix.sql` | `026_portal_crypto_schema_fix.sql` | (já 026) |
| 027 | `027_portal_overview_open_balance.sql` | `027_portal_overview_open_balance.sql` | (já 027) |
| 028 | `028_demurrage_module.sql` | `028_demurrage_module.sql` | (já 028) |
| 029 | `029_container_dates_indexes.sql` | `029_container_dates_indexes.sql` | (já 029) |
| 030 | `030_charge_table_required.sql` | `030_charge_table_required.sql` | (já 030) |
| 031 | `031_overdue_enforcement.sql` | `031_overdue_enforcement.sql` | (já 031) |
| 032 | `032_invoices_pix_columns.sql` | `032_invoices_pix_columns.sql` | (já 032) |
| 033 | `033_portal_demurrage.sql` | `033_portal_demurrage.sql` | (já 033) |
| 034 | `034_granite_module.sql` | `034_granite_module.sql` | (já 034) |
| 035 | `035_vazios_module.sql` | `035_vazios_module.sql` | (já 035) |
| 036 | `036_vazios_importacao_module.sql` | `036_vazios_importacao_module.sql` | (já 036) |
| 037 | `037_vazios_importacao_voyage_link.sql` | `037_vazios_importacao_voyage_link.sql` | (já 037) |
| 038 | `038_portal_invoice_alert.sql` | `038_portal_invoice_alert.sql` | (já 038) |
| 039 | `039_granite_invoiceable_view.sql` | `039_granite_invoiceable_view.sql` | (já 039) |
| 040 | `040_portal_login_rate_limit.sql` | `040_portal_login_rate_limit.sql` | (já 040) |
| 041 | `041_rls_missing_tables.sql` | `041_rls_missing_tables.sql` | (já 041) |
| 042 | `042_rls_module_hardening.sql` | `042_rls_module_hardening.sql` | (já 042) |
| 043 | `043_guard_customer_id_ready_for_billing.sql` | `043_guard_customer_id_ready_for_billing.sql` | (já 043) |
| 044 | `044_portal_supabase_auth_infra.sql` | `044_portal_supabase_auth_infra.sql` | (já 044) |
| 045 | `045_count_distinct_containers_fn.sql` | `045_count_distinct_containers_fn.sql` | (já 045) |
| 046 | `046_voyage_schedule_snapshot_trigger.sql` | `046_voyage_schedule_snapshot_trigger.sql` | (já 046) |
| 047 | `047_customers_search_index.sql` | `047_customers_search_index.sql` | (já 047) |
| 048 | `048_demurrage_rates_table.sql` | `048_demurrage_rates_table.sql` | (já 048) |
| 049 | `049_demurrage_roe_source.sql` | `049_demurrage_roe_source.sql` | (já 049) |
| 050 | `050_alignment_granite_portal_demurrage.sql` | `050_alignment_granite_portal_demurrage.sql` | (já 050) |
| 051 | `051_granite_empty_array_guard.sql` | `051_granite_empty_array_guard.sql` | (já 051) |
| 052 | `052_fix_voyage_snapshot_null_new_value.sql` | `052_fix_voyage_snapshot_null_new_value.sql` | (já 052) |
| 053 | `053_security_hardening.sql` | `053_security_hardening.sql` | (já 053) |
| 054 | `054_vazios_importacao_source.sql` | `054_vazios_importacao_source.sql` | (já 054) |
| 055 | `055_baplie_reconciliation_resolutions.sql` | `055_baplie_reconciliation_resolutions.sql` | (já 055) |
| 056 | `056_create_baplie_containers_staging.sql` **(renomeia)** | `20260520132021_create_baplie_containers_staging.sql` | 20260520132021 |
| 057 | `057_add_pod_to_vazios_importacao_containers.sql` **(renomeia)** | `20260520142818_add_pod_to_vazios_importacao_containers.sql` | 20260520142818 |
| 058 | `058_vazios_importacao_source.sql` **(renomeia)** | `20260520172541_vazios_importacao_source.sql` | 20260520172541 |
| 059 | `059_voyage_export_schedules.sql` **(renomeia)** | `20260521000000_voyage_export_schedules.sql` | 20260521000000 |
| 060 | `060_voyage_export_schedules_ces_linked.sql` **(renomeia)** | `20260521100000_voyage_export_schedules_ces_linked.sql` | 20260521100000 |
| 061 | `061_voyage_export_schedules_pol.sql` **(renomeia)** | `20260521110000_voyage_export_schedules_pol.sql` | 20260521110000 |
| 062 | `062_taxas_locais_granito.sql` **(renomeia)** | `20260523120000_taxas_locais_granito.sql` | 20260523120000 |
| 063 | `063_fix_billing_validation_alignment.sql` **(renomeia)** | `20260528114948_fix_billing_validation_alignment.sql` | 20260528114948 |
| 064 | `064_fix_granite_invoice_cancel_reissue.sql` **(renomeia)** | `20260528134131_fix_granite_invoice_cancel_reissue.sql` | 20260528134131 |
| 065 | `065_fix_null_charge_status_cntr.sql` **(renomeia)** | `20260528190050_fix_null_charge_status_cntr.sql` | 20260528190050 |
| 066 | `066_local_billing_ledger_phase1.sql` **(renomeia)** | `20260529100000_local_billing_ledger_phase1.sql` | 20260529100000 |
| 067 | `067_local_billing_ledger_phase2.sql` **(renomeia)** | `20260529110000_local_billing_ledger_phase2.sql` | 20260529110000 |
| 068 | `068_ledger_auto_emit_phase4a.sql` **(renomeia)** | `20260529120000_ledger_auto_emit_phase4a.sql` | 20260529120000 |
| 069 | `069_ledger_portal_reports_phase4d.sql` **(renomeia)** | `20260529130000_ledger_portal_reports_phase4d.sql` | 20260529130000 |
| 070 | `070_ledger_individual_invoice_rpc.sql` **(renomeia)** | `20260529140000_ledger_individual_invoice_rpc.sql` | 20260529140000 |
| 071 | `071_ledger_settlement_uniqueness_guards.sql` **(renomeia)** | `20260529141000_ledger_settlement_uniqueness_guards.sql` | 20260529141000 |
| 072 | `072_ledger_backfill_exception_report.sql` **(renomeia)** | `20260529142000_ledger_backfill_exception_report.sql` | 20260529142000 |
| 073 | `073_ledger_obsolete_consolidated_links.sql` **(renomeia)** | `20260529143000_ledger_obsolete_consolidated_links.sql` | 20260529143000 |
| 074 | `074_ledger_invoice_pix_payload.sql` **(renomeia)** | `20260529144000_ledger_invoice_pix_payload.sql` | 20260529144000 |
| 075 | `075_ledger_pix_txid_single_settlement_row.sql` **(renomeia)** | `20260529145000_ledger_pix_txid_single_settlement_row.sql` | 20260529145000 |
| 076 | `076_ledger_consolidated_reissue_links.sql` **(renomeia)** | `20260529150000_ledger_consolidated_reissue_links.sql` | 20260529150000 |
| 077 | `077_fix_user_profile_privilege_escalation.sql` **(renomeia)** | `20260530102906_fix_user_profile_privilege_escalation.sql` | 20260530102906 |
| 078 | `078_revoke_anon_execute_security_definer.sql` **(renomeia)** | `20260530102907_revoke_anon_execute_security_definer.sql` | 20260530102907 |
| 079 | `079_set_function_search_path.sql` **(renomeia)** | `20260530102908_set_function_search_path.sql` | 20260530102908 |
| 080 | `080_tighten_permissive_rls_policies.sql` **(renomeia)** | `20260530102909_tighten_permissive_rls_policies.sql` | 20260530102909 |
| 081 | `081_invoice_manual_other_charges.sql` **(renomeia)** | `20260602141903_invoice_manual_other_charges.sql` | 20260602141903 |
| 082 | `082_invoice_manual_other_charges_revoke_anon.sql` **(renomeia)** | `20260602142605_invoice_manual_other_charges_revoke_anon.sql` | 20260602142605 |
| 083 | `083_portal_ledger_alignment.sql` **(renomeia)** | `20260603115147_portal_ledger_alignment.sql` | 20260603115147 |
| 084 | `084_portal_auth_uid_rework.sql` **(renomeia)** | `20260603130350_portal_auth_uid_rework.sql` | 20260603130350 |
| 085 | `085_portal_billing_redesign.sql` **(renomeia)** | `20260603192044_portal_billing_redesign.sql` | 20260603192044 |
| 086 | `086_consolidated_invoice_item_breakdown.sql` **(renomeia)** | `20260608174131_consolidated_invoice_item_breakdown.sql` | 20260608174131 |
| 087 | `087_apply_ce_mercante_manifest.sql` **(renomeia)** | `20260608191844_apply_ce_mercante_manifest.sql` | 20260608191844 |
| 088 | `088_revoke_anon_apply_ce_mercante_manifest.sql` **(renomeia)** | `20260608192000_revoke_anon_apply_ce_mercante_manifest.sql` | 20260608192000 |
| 089 | `089_demurrage_date_order_constraints.sql` **(renomeia)** | `20260609132000_demurrage_date_order_constraints.sql` | 20260609132000 |
| 090 | `090_restrict_consolidated_invoice_breakdown.sql` **(renomeia)** | `20260609133000_restrict_consolidated_invoice_breakdown.sql` | 20260609133000 |
| 091 | `091_harden_remaining_permissive_rls.sql` **(renomeia)** | `20260609134000_harden_remaining_permissive_rls.sql` | 20260609134000 |
| 092 | `092_portal_operation_bls.sql` **(renomeia)** | `20260609200829_portal_operation_bls.sql` | 20260609200829 |
| 093 | `093_revoke_anon_security_definer_comprehensive.sql` **(renomeia)** | `20260609225321_revoke_anon_security_definer_comprehensive.sql` | 20260609225321 |
| 094 | `094_drop_duplicate_invoices_index.sql` **(renomeia)** | `20260609225846_drop_duplicate_invoices_index.sql` | 20260609225846 |
| 095 | `095_confirm_demurrage_pix_matches_batch.sql` **(renomeia)** | `20260610094207_confirm_demurrage_pix_matches_batch.sql` | 20260610094207 |
| 096 | `096_rls_initplan_performance_pass.sql` **(renomeia)** | `20260610094629_rls_initplan_performance_pass.sql` | 20260610094629 |
| 097 | `097_vazios_importacao_delete_admin_only.sql` **(renomeia)** | `20260610163251_vazios_importacao_delete_admin_only.sql` | 20260610163251 |
| 098 | `098_fix_recalc_clears_billing_hold_reason.sql` **(renomeia)** | `20260612144751_fix_recalc_clears_billing_hold_reason.sql` | 20260612144751 |
| 099 | `099_transactional_baplie_vehicle_imports.sql` **(renomeia)** | `20260612153000_transactional_baplie_vehicle_imports.sql` | 20260612153000 |
| 100 | `100_create_invoice_from_bls_with_ledger.sql` **(renomeia)** | `20260612154000_create_invoice_from_bls_with_ledger.sql` | 20260612154000 |
| 101 | `101_manifest_import_postprocess_transactional.sql` **(renomeia)** | `20260612155000_manifest_import_postprocess_transactional.sql` | 20260612155000 |
| 102 | `102_mark_ready_and_invoice_atomic.sql` **(renomeia)** | `20260612160000_mark_ready_and_invoice_atomic.sql` | 20260612160000 |
| 103 | `103_confirm_unified_pix_matches.sql` **(renomeia)** | `20260612161000_confirm_unified_pix_matches.sql` | 20260612161000 |
| 104 | `104_register_ledger_partial_payments.sql` **(renomeia)** | `20260612162000_register_ledger_partial_payments.sql` | 20260612162000 |
| 105 | `105_portal_invoice_history_links.sql` **(renomeia)** | `20260612163000_portal_invoice_history_links.sql` | 20260612163000 |
| 106 | `106_fix_pix_txid_trigger_for_partial_payments.sql` **(renomeia)** | `20260612164000_fix_pix_txid_trigger_for_partial_payments.sql` | 20260612164000 |
| 107 | `107_reverse_invoice_payment.sql` **(renomeia)** | `20260613170000_reverse_invoice_payment.sql` | 20260613170000 |
| 108 | `108_guard_manual_charges_and_clear_pix_on_reversal.sql` **(renomeia)** | `20260614120000_guard_manual_charges_and_clear_pix_on_reversal.sql` | 20260614120000 |
| 109 | `109_fix_anon_executable_import_rpcs.sql` **(renomeia)** | `20260614135728_fix_anon_executable_import_rpcs.sql` | 20260614135728 |
| 110 | `110_revoke_anon_reverse_payment_rpcs.sql` **(renomeia)** | `20260614140808_revoke_anon_reverse_payment_rpcs.sql` | 20260614140808 |
| 111 | `111_pix_exact_and_manual_overpayment_refunds.sql` **(renomeia)** | `20260614160000_pix_exact_and_manual_overpayment_refunds.sql` | 20260614160000 |
| 112 | `112_settle_invoice_refunds.sql` **(renomeia)** | `20260614170000_settle_invoice_refunds.sql` | 20260614170000 |
| 113 | `113_require_justification_on_payment_reversal.sql` **(renomeia)** | `20260614180000_require_justification_on_payment_reversal.sql` | 20260614180000 |
| 114 | `114_portal_fase1_indexes_and_cleanup.sql` **(renomeia)** | `20260615000001_portal_fase1_indexes_and_cleanup.sql` | 20260615000001 |
| 115 | `115_portal_fase1_login_cnpj.sql` **(renomeia)** | `20260615000002_portal_fase1_login_cnpj.sql` | 20260615000002 |
| 116 | `116_portal_fase2_notifications_disputes_profile.sql` **(renomeia)** | `20260615000003_portal_fase2_notifications_disputes_profile.sql` | 20260615000003 |
| 117 | `117_portal_fase3_rate_limiting.sql` **(renomeia)** | `20260615000004_portal_fase3_rate_limiting.sql` | 20260615000004 |
| 118 | `118_fix_bls_financial_status_on_reversal.sql` **(renomeia)** | `20260615010000_fix_bls_financial_status_on_reversal.sql` | 20260615010000 |
| 119 | `119_portal_fixes_post_pr227.sql` **(renomeia)** | `20260615145427_portal_fixes_post_pr227.sql` | 20260615145427 |
| 120 | `120_portal_invoice_consolidated_breakdown.sql` **(renomeia)** | `20260615190000_portal_invoice_consolidated_breakdown.sql` | 20260615190000 |
| 121 | `121_fix_portal_create_consolidation_jsonb.sql` **(renomeia)** | `20260615200000_fix_portal_create_consolidation_jsonb.sql` | 20260615200000 |
| 122 | `122_harden_portal_resolve_login.sql` **(renomeia)** | `20260615210000_harden_portal_resolve_login.sql` | 20260615210000 |
| 123 | `123_portal_ce_mercante_gate.sql` **(renomeia)** | `20260615220000_portal_ce_mercante_gate.sql` | 20260615220000 |
| 124 | `124_vessel_schedules.sql` **(renomeia)** | `20260616000000_vessel_schedules.sql` | 20260616000000 |
| 125 | `125_import_batches_ce_master.sql` **(renomeia)** | `20260616120000_import_batches_ce_master.sql` | 20260616120000 |
| 126 | `126_preserve_customer_billing_block_reason.sql` **(renomeia)** | `20260618145508_preserve_customer_billing_block_reason.sql` | 20260618145508 |
| 127 | `127_guard_invoiceable_ready_state.sql` **(renomeia)** | `20260618163840_guard_invoiceable_ready_state.sql` | 20260618163840 |
| 128 | `128_review_gate_canonical_pendencies.sql` **(renomeia)** | `20260619120000_review_gate_canonical_pendencies.sql` | 20260619120000 |
| 129 | `129_review_gate_hardening.sql` **(renomeia)** | `20260619130000_review_gate_hardening.sql` | 20260619130000 |
| 130 | `130_bl_timeline_rpc.sql` **(renomeia)** | `20260619190144_bl_timeline_rpc.sql` | 20260619190144 |
| 131 | `131_clear_demurrage_extract_flag_on_reversal.sql` **(renomeia)** | `20260622132451_clear_demurrage_extract_flag_on_reversal.sql` | 20260622132451 |
| 132 | `132_create_demurrage_invoice_atomic.sql` **(renomeia)** | `20260622132732_create_demurrage_invoice_atomic.sql` | 20260622132732 |
| 133 | `133_mark_bls_ready_and_create_invoice_atomic.sql` **(renomeia)** | `20260622133100_mark_bls_ready_and_create_invoice_atomic.sql` | 20260622133100 |
| 134 | `134_atomic_customer_update_audit.sql` **(renomeia)** | `20260622173159_atomic_customer_update_audit.sql` | 20260622173159 |
| 135 | `135_atomic_vessel_schedule_operations.sql` **(renomeia)** | `20260622174608_atomic_vessel_schedule_operations.sql` | 20260622174608 |
| 136 | `136_import_granite_manifest_transactional.sql` **(renomeia)** | `20260622174832_import_granite_manifest_transactional.sql` | 20260622174832 |
| 137 | `137_classify_granite_invoices.sql` **(renomeia)** | `20260622175108_classify_granite_invoices.sql` | 20260622175108 |
| 138 | `138_audit_container_dates_and_propagate_ata.sql` **(renomeia)** | `20260622180300_audit_container_dates_and_propagate_ata.sql` | 20260622180300 |
| 139 | `139_grant_vessel_schedule_privileges.sql` **(renomeia)** | `20260622213000_grant_vessel_schedule_privileges.sql` | 20260622213000 |
| 140 | `140_import_batches_rate_limit_timestamp_compat.sql` **(renomeia)** | `20260622213500_import_batches_rate_limit_timestamp_compat.sql` | 20260622213500 |
| 141 | `141_secure_billing_core_wrappers.sql` **(renomeia)** | `20260622214500_secure_billing_core_wrappers.sql` | 20260622214500 |
| 142 | `142_secure_cancel_invoice_wrapper.sql` **(renomeia)** | `20260622215000_secure_cancel_invoice_wrapper.sql` | 20260622215000 |
| 143 | `143_create_customer_with_contacts_atomic.sql` **(renomeia)** | `20260623062000_create_customer_with_contacts_atomic.sql` | 20260623062000 |
| 144 | `144_import_breakbulk_manifest_transactional.sql` **(renomeia)** | `20260623095500_import_breakbulk_manifest_transactional.sql` | 20260623095500 |
| 145 | `145_set_import_batch_ce_master_atomic.sql` **(renomeia)** | `20260623110000_set_import_batch_ce_master_atomic.sql` | 20260623110000 |
| 146 | `146_import_vazios_transactional.sql` **(renomeia)** | `20260623111000_import_vazios_transactional.sql` | 20260623111000 |
| 147 | `147_save_bl_demurrage_config_atomic.sql` **(renomeia)** | `20260623112000_save_bl_demurrage_config_atomic.sql` | 20260623112000 |
| 148 | `148_save_granite_bl_review_atomic.sql` **(renomeia)** | `20260623120000_save_granite_bl_review_atomic.sql` | 20260623120000 |
| 149 | `149_remove_billing_from_import_function.sql` **(renomeia)** | `20260623130000_remove_billing_from_import_function.sql` | 20260623130000 |
| 150 | `150_revoke_anon_portal_read_rpcs.sql` **(renomeia)** | `20260624100000_revoke_anon_portal_read_rpcs.sql` | 20260624100000 |
| 151 | `151_guard_definer_rpcs_active_user.sql` **(renomeia)** | `20260624100100_guard_definer_rpcs_active_user.sql` | 20260624100100 |
| 152 | `152_revoke_anon_definer_drift.sql` **(renomeia)** | `20260624110000_revoke_anon_definer_drift.sql` | 20260624110000 |
| 153 | `153_demurrage_invoice_history.sql` **(renomeia)** | `20260624120000_demurrage_invoice_history.sql` | 20260624120000 |
| 154 | `154_demurrage_rename_frozen_to_current.sql` **(renomeia)** | `20260624121000_demurrage_rename_frozen_to_current.sql` | 20260624121000 |
| 155 | `155_demurrage_recalculate_rpcs.sql` **(renomeia)** | `20260624122000_demurrage_recalculate_rpcs.sql` | 20260624122000 |
| 156 | `156_demurrage_create_invoice_issued.sql` **(renomeia)** | `20260624130000_demurrage_create_invoice_issued.sql` | 20260624130000 |
| 157 | `157_demurrage_drop_overdue.sql` **(renomeia)** | `20260624131000_demurrage_drop_overdue.sql` | 20260624131000 |
| 158 | `158_demurrage_pix_window_conciliation.sql` **(renomeia)** | `20260624140000_demurrage_pix_window_conciliation.sql` | 20260624140000 |
| 159 | `159_portal_demurrage_reference.sql` **(renomeia)** | `20260624150000_portal_demurrage_reference.sql` | 20260624150000 |