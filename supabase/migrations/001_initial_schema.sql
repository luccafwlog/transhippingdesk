-- Transhipping Desk — Schema Inicial v1.0 (Estrutura)
-- Consolidado em 2026-09-02 a partir das 383 migrações históricas pré-v1.

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

-- ---------------------------------------------------------------------------
-- ADR 0047 — os defaults de privilégio do schema `public` nascem fechados.
--
-- O Supabase mantém, por padrão, ALTER DEFAULT PRIVILEGES que concedem acesso a
-- `anon` e `authenticated` em TODA tabela, sequência e função nova de `public`.
-- A migration arquivada 297 inverteu esse default em produção. Esses defaults
-- vivem em `pg_default_acl`, fora do schema — o dump que originou este arquivo
-- não os carrega, e sem esta seção um banco novo (branch de preview, `supabase
-- db reset`) nasceria MAIS ABERTO que produção: `anon` receberia ALL nas 106
-- tabelas e EXECUTE nas 397 funções.
--
-- Precisa vir antes de qualquer CREATE: default privilege só vale na criação.
-- Os GRANT explícitos da 002 restauram exatamente o ACL auditado em produção.
-- ---------------------------------------------------------------------------

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;


--
-- Name: customer_communication_saved_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_communication_saved_templates (
    id bigint NOT NULL,
    name text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_communication_saved_templates_body_check CHECK ((char_length(btrim(body)) > 0)),
    CONSTRAINT customer_communication_saved_templates_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 120))),
    CONSTRAINT customer_communication_saved_templates_subject_check CHECK ((char_length(btrim(subject)) > 0))
);



--
-- Name: pix_reconciliation_exceptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pix_reconciliation_exceptions (
    id bigint NOT NULL,
    import_key text NOT NULL,
    line_number integer NOT NULL,
    txid text DEFAULT ''::text NOT NULL,
    normalized_txid text DEFAULT ''::text NOT NULL,
    cnpj text DEFAULT ''::text NOT NULL,
    paid_at timestamp with time zone,
    amount_brl numeric(14,2) NOT NULL,
    reason text NOT NULL,
    candidate_count integer DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    resolution_source text,
    resolved_invoice_id bigint,
    resolved_demurrage_invoice_id bigint,
    CONSTRAINT pix_reconciliation_exceptions_amount_brl_check CHECK ((amount_brl >= (0)::numeric)),
    CONSTRAINT pix_reconciliation_exceptions_candidate_count_check CHECK ((candidate_count >= 0)),
    CONSTRAINT pix_reconciliation_exceptions_import_key_check CHECK ((char_length(btrim(import_key)) >= 8)),
    CONSTRAINT pix_reconciliation_exceptions_line_number_check CHECK ((line_number > 0)),
    CONSTRAINT pix_reconciliation_exceptions_reason_check CHECK ((reason = ANY (ARRAY['unmatched'::text, 'ambiguous'::text]))),
    CONSTRAINT pix_reconciliation_exceptions_resolution_source_check CHECK ((resolution_source = ANY (ARRAY['local'::text, 'demurrage'::text]))),
    CONSTRAINT pix_reconciliation_exceptions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'resolved'::text])))
);



--
-- Name: portal_provisioning_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_provisioning_events (
    id bigint NOT NULL,
    customer_id bigint NOT NULL,
    account_id bigint,
    invite_id bigint,
    previous_decision text,
    new_decision text,
    previous_situation text,
    new_situation text,
    actor_type text NOT NULL,
    actor_id uuid,
    reason text,
    request_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT portal_provisioning_events_actor_type_check CHECK ((actor_type = ANY (ARRAY['documentacao'::text, 'administrativo'::text, 'cliente'::text, 'sistema'::text])))
);



--
-- Name: agency_departure_report_department_signoffs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agency_departure_report_department_signoffs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_id uuid NOT NULL,
    department text NOT NULL,
    signed_by uuid,
    signed_at timestamp with time zone,
    CONSTRAINT agency_departure_report_department_signoffs_department_check CHECK ((department = ANY (ARRAY['operacoes'::text, 'documentacao'::text, 'equipamentos'::text])))
);



--
-- Name: agency_departure_report_occurrences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agency_departure_report_occurrences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_id uuid NOT NULL,
    body text NOT NULL,
    author_id uuid NOT NULL,
    department text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    section text,
    CONSTRAINT agency_departure_report_occurrences_body_check CHECK ((btrim(body) <> ''::text)),
    CONSTRAINT agency_departure_report_occurrences_section_check CHECK (((section IS NULL) OR (section = ANY (ARRAY['datas'::text, 'carga_descarregada'::text, 'carga_carregada'::text, 'veiculos'::text, 'vazios_embarcados'::text, 'vazios_descarregados'::text, 'ocorrencias'::text, 'operacao_patio'::text]))))
);



--
-- Name: agency_departure_report_signoffs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agency_departure_report_signoffs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_id uuid NOT NULL,
    section text NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    department text NOT NULL,
    signed_by uuid,
    signed_at timestamp with time zone,
    observation text,
    CONSTRAINT agency_departure_report_signoffs_section_check CHECK ((section = ANY (ARRAY['datas'::text, 'carga_descarregada'::text, 'carga_carregada'::text, 'veiculos'::text, 'vazios_embarcados'::text, 'vazios_descarregados'::text]))),
    CONSTRAINT agency_departure_report_signoffs_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'confirmed'::text, 'nothing_to_declare'::text])))
);



--
-- Name: agency_departure_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agency_departure_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    voyage_id bigint NOT NULL,
    port text NOT NULL,
    terminal text,
    status text DEFAULT 'open'::text NOT NULL,
    closed_at timestamp with time zone,
    closed_by uuid,
    closed_snapshot jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    terminal_id uuid,
    terminal_port_id bigint,
    CONSTRAINT agency_departure_reports_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text]))),
    CONSTRAINT agency_departure_reports_terminal_pair_check CHECK ((((terminal_id IS NULL) AND (terminal_port_id IS NULL)) OR ((terminal_id IS NOT NULL) AND (terminal_port_id IS NOT NULL))))
);



--
-- Name: agency_report_pending_baselines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agency_report_pending_baselines (
    baseline_key text NOT NULL,
    captured_at timestamp with time zone NOT NULL
);



--
-- Name: TABLE agency_report_pending_baselines; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.agency_report_pending_baselines IS 'Baselines internos de deteccao de pendencias do ADR, capturados na aplicacao da migration.';



--
-- Name: alert_item_dismissals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alert_item_dismissals (
    id bigint NOT NULL,
    alert_item_id bigint NOT NULL,
    occurrence_id uuid NOT NULL,
    reason text NOT NULL,
    dismissed_by uuid NOT NULL,
    dismissed_at timestamp with time zone DEFAULT now() NOT NULL,
    review_at timestamp with time zone NOT NULL,
    CONSTRAINT alert_item_dismissals_check CHECK ((review_at > dismissed_at)),
    CONSTRAINT alert_item_dismissals_reason_check CHECK ((char_length(btrim(reason)) >= 3))
);



--
-- Name: alert_item_dismissals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.alert_item_dismissals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: alert_item_dismissals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.alert_item_dismissals_id_seq OWNED BY public.alert_item_dismissals.id;



--
-- Name: alert_item_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alert_item_events (
    id bigint NOT NULL,
    alert_item_id bigint NOT NULL,
    occurrence_id uuid NOT NULL,
    event_type text NOT NULL,
    previous_status text,
    new_status text NOT NULL,
    actor_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT alert_item_events_event_type_check CHECK ((event_type = ANY (ARRAY['opened'::text, 'updated'::text, 'resolved'::text, 'dismissed'::text]))),
    CONSTRAINT alert_item_events_new_status_check CHECK ((new_status = ANY (ARRAY['active'::text, 'resolved'::text])))
);



--
-- Name: alert_item_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.alert_item_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: alert_item_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.alert_item_events_id_seq OWNED BY public.alert_item_events.id;



--
-- Name: alert_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alert_items (
    id bigint NOT NULL,
    alert_id bigint NOT NULL,
    item_type text NOT NULL,
    source text NOT NULL,
    severity text NOT NULL,
    department text,
    destination text,
    message text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    occurrence_id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT alert_items_severity_check CHECK ((severity = ANY (ARRAY['normal'::text, 'critical'::text]))),
    CONSTRAINT alert_items_status_check CHECK ((status = ANY (ARRAY['active'::text, 'resolved'::text])))
);



--
-- Name: alert_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.alert_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: alert_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.alert_items_id_seq OWNED BY public.alert_items.id;



--
-- Name: alert_notification_failures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alert_notification_failures (
    id bigint NOT NULL,
    alert_id bigint,
    alert_item_id bigint,
    event_id bigint,
    item_type text NOT NULL,
    department text NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



--
-- Name: alert_notification_failures_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.alert_notification_failures_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: alert_notification_failures_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.alert_notification_failures_id_seq OWNED BY public.alert_notification_failures.id;



--
-- Name: alert_type_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alert_type_catalog (
    type text NOT NULL,
    severity text NOT NULL,
    responsible_department text,
    audience_departments text[] DEFAULT '{}'::text[] NOT NULL,
    default_destination text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT alert_type_catalog_severity_check CHECK ((severity = ANY (ARRAY['normal'::text, 'critical'::text])))
);



--
-- Name: TABLE alert_type_catalog; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.alert_type_catalog IS 'Catálogo único de tipo, gravidade, audiência e destino dos itens de alerta.';



--
-- Name: alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alerts (
    id bigint NOT NULL,
    type text NOT NULL,
    entity_type text,
    entity_id text,
    message text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    assigned_to uuid,
    created_at timestamp with time zone DEFAULT now(),
    closed_at timestamp with time zone,
    notified_at timestamp with time zone,
    CONSTRAINT alerts_status_check CHECK ((status = ANY (ARRAY['open'::text, 'acknowledged'::text, 'closed'::text])))
);



--
-- Name: COLUMN alerts.type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.alerts.type IS 'Tipo histórico ou aggregate; itens novos vivem em alert_items e usam o catálogo central.';



--
-- Name: alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.alerts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.alerts_id_seq OWNED BY public.alerts.id;



--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    id integer DEFAULT 1 NOT NULL,
    communications_enabled boolean DEFAULT false NOT NULL,
    demurrage_dunning_interval_days integer DEFAULT 7 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_settings_demurrage_dunning_interval_days_check CHECK ((demurrage_dunning_interval_days > 0)),
    CONSTRAINT app_settings_id_check CHECK ((id = 1))
);



--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id bigint NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    field_name text NOT NULL,
    old_value text,
    new_value text,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT now(),
    justification text,
    actor_role text ,
    actor_department text
);



--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_logs_id_seq OWNED BY public.audit_logs.id;



--
-- Name: baplie_containers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.baplie_containers (
    id bigint NOT NULL,
    voyage_id bigint NOT NULL,
    container_number text NOT NULL,
    size_type text,
    status text,
    weight_kg numeric,
    pol text,
    pod text,
    final_dest text,
    bl_ref text,
    slot text,
    is_imo boolean DEFAULT false NOT NULL,
    imo_class text,
    un_number text,
    is_oog boolean DEFAULT false NOT NULL,
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    imported_by uuid,
    CONSTRAINT baplie_containers_status_check CHECK ((status = ANY (ARRAY['full'::text, 'empty'::text])))
);



--
-- Name: baplie_containers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.baplie_containers ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.baplie_containers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



--
-- Name: baplie_reconciliation_resolutions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.baplie_reconciliation_resolutions (
    id bigint NOT NULL,
    voyage_id bigint NOT NULL,
    bl_container_id bigint NOT NULL,
    field_name text NOT NULL,
    baplie_value text NOT NULL,
    manifest_value text NOT NULL,
    resolution text DEFAULT 'manifest'::text NOT NULL,
    resolved_by uuid,
    resolved_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT baplie_reconciliation_resolutions_field_name_check CHECK ((field_name = ANY (ARRAY['is_imo'::text, 'imo_class'::text, 'un_number'::text]))),
    CONSTRAINT baplie_reconciliation_resolutions_resolution_check CHECK ((resolution = 'manifest'::text))
);



--
-- Name: baplie_reconciliation_resolutions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.baplie_reconciliation_resolutions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.baplie_reconciliation_resolutions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



--
-- Name: billing_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_batches (
    id bigint NOT NULL,
    customer_id bigint NOT NULL,
    origin text DEFAULT 'internal'::text NOT NULL,
    status text DEFAULT 'requested'::text NOT NULL,
    notes text,
    requested_by uuid,
    portal_account_id bigint,
    invoice_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT billing_batches_origin_check CHECK ((origin = ANY (ARRAY['internal'::text, 'portal'::text]))),
    CONSTRAINT billing_batches_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'issued'::text, 'cancelled'::text, 'failed'::text])))
);



--
-- Name: billing_batches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.billing_batches_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: billing_batches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.billing_batches_id_seq OWNED BY public.billing_batches.id;



--
-- Name: billing_run_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_run_logs (
    id bigint NOT NULL,
    billing_run_id bigint NOT NULL,
    manifest_id bigint NOT NULL,
    bl_id text,
    level text DEFAULT 'info'::text NOT NULL,
    code text NOT NULL,
    message text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT billing_run_logs_level_check CHECK ((level = ANY (ARRAY['info'::text, 'warning'::text, 'error'::text])))
);



--
-- Name: billing_run_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.billing_run_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: billing_run_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.billing_run_logs_id_seq OWNED BY public.billing_run_logs.id;



--
-- Name: billing_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_runs (
    id bigint NOT NULL,
    manifest_id bigint NOT NULL,
    trigger_source text DEFAULT 'manifest_import'::text NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    requested_by uuid,
    input_hash text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    total_bls integer DEFAULT 0 NOT NULL,
    eligible_bls integer DEFAULT 0 NOT NULL,
    blocked_bls integer DEFAULT 0 NOT NULL,
    calculated_bls integer DEFAULT 0 NOT NULL,
    total_brl numeric(14,2) DEFAULT 0 NOT NULL,
    total_usd numeric(14,2) DEFAULT 0 NOT NULL,
    summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT billing_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'completed_with_blocks'::text, 'failed'::text]))),
    CONSTRAINT billing_runs_trigger_source_check CHECK ((trigger_source = ANY (ARRAY['manifest_import'::text, 'manual_reprocess'::text, 'manual_reconciliation'::text])))
);



--
-- Name: billing_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.billing_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: billing_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.billing_runs_id_seq OWNED BY public.billing_runs.id;



--
-- Name: bl_breakbulk_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bl_breakbulk_items (
    id bigint NOT NULL,
    bl_id text NOT NULL,
    item_description text NOT NULL,
    package_qty numeric(12,3),
    package_unit text,
    gross_weight_kg numeric(12,3),
    cbm numeric(12,3),
    marks text,
    created_at timestamp with time zone DEFAULT now()
);



--
-- Name: bl_breakbulk_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bl_breakbulk_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: bl_breakbulk_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bl_breakbulk_items_id_seq OWNED BY public.bl_breakbulk_items.id;



--
-- Name: bl_containers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bl_containers (
    id bigint NOT NULL,
    bl_id text NOT NULL,
    container_number text NOT NULL,
    seal_number text,
    type text,
    tare_weight_kg numeric(10,3),
    gross_weight_kg numeric(10,3),
    cbm numeric(10,3),
    is_oog boolean DEFAULT false,
    is_imo boolean DEFAULT false,
    imo_class text,
    un_number text,
    created_at timestamp with time zone DEFAULT now(),
    discharge_date date,
    return_date date,
    demurrage_status text DEFAULT 'within_free_time'::text,
    unpacking_location text,
    CONSTRAINT bl_containers_demurrage_status_check CHECK ((demurrage_status = ANY (ARRAY['within_free_time'::text, 'overdue'::text, 'returned'::text]))),
    CONSTRAINT bl_containers_gross_weight_nonneg CHECK (((gross_weight_kg IS NULL) OR (gross_weight_kg >= (0)::numeric)))
);



--
-- Name: bl_containers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bl_containers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: bl_containers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bl_containers_id_seq OWNED BY public.bl_containers.id;



--
-- Name: bl_freight_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bl_freight_lines (
    bl_id text NOT NULL,
    seq integer NOT NULL,
    description text,
    category text,
    mercante_code text,
    currency text,
    amount numeric(14,2),
    payment text
);



--
-- Name: bl_receivables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bl_receivables (
    id bigint NOT NULL,
    bl_id text NOT NULL,
    customer_id bigint NOT NULL,
    source text DEFAULT 'local_charges'::text NOT NULL,
    original_amount_brl numeric(14,2) DEFAULT 0 NOT NULL,
    settled_amount_brl numeric(14,2) DEFAULT 0 NOT NULL,
    balance_brl numeric(14,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    voyage_id bigint,
    cargo_mode text,
    pol text,
    pod text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    roe_frozen numeric(10,4),
    roe_effective_date_frozen date,
    CONSTRAINT bl_receivables_amounts_non_negative CHECK (((original_amount_brl >= (0)::numeric) AND (settled_amount_brl >= (0)::numeric) AND (balance_brl >= (0)::numeric))),
    CONSTRAINT bl_receivables_source_check CHECK ((source = 'local_charges'::text)),
    CONSTRAINT bl_receivables_status_check CHECK ((status = ANY (ARRAY['open'::text, 'partially_settled'::text, 'settled'::text, 'void'::text])))
);



--
-- Name: bl_receivables_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bl_receivables_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: bl_receivables_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bl_receivables_id_seq OWNED BY public.bl_receivables.id;



--
-- Name: bl_transshipments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bl_transshipments (
    id bigint NOT NULL,
    bl_id text NOT NULL,
    omission_id bigint NOT NULL,
    disposition text DEFAULT 'transshipment'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bl_transshipments_disposition_check CHECK ((disposition = ANY (ARRAY['transshipment'::text, 'cod'::text])))
);



--
-- Name: bl_transshipments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bl_transshipments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: bl_transshipments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bl_transshipments_id_seq OWNED BY public.bl_transshipments.id;



--
-- Name: bls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bls (
    id text NOT NULL,
    voyage_id bigint NOT NULL,
    batch_id bigint,
    shipper text,
    consignee text,
    notify_party text,
    customer_id bigint,
    pol text,
    pod text,
    place_of_delivery text,
    cargo_description text,
    total_weight_kg numeric(12,3),
    total_cbm numeric(10,3),
    incoterm text,
    payment_type text,
    financial_status text DEFAULT 'pending'::text,
    review_status text DEFAULT 'ok'::text,
    free_time_override integer,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    cargo_mode text DEFAULT 'container'::text NOT NULL,
    ce_mercante text,
    bb_machine_qty numeric(12,3),
    bb_packages_qty numeric(12,3),
    bb_packages_total numeric(12,3),
    bb_weight_ton numeric(12,3),
    charge_status text,
    charges_calculated_at timestamp with time zone,
    charges_reviewed_at timestamp with time zone,
    charge_exemption_reason text,
    container_load_type text,
    manifest_customer_cnpj_cpf text,
    manifest_customer_name text,
    manifest_customer_email text,
    customer_reconciliation_status text DEFAULT 'missing_customer'::text,
    customer_reconciliation_notes text,
    billing_hold_reason text,
    last_billing_run_id bigint,
    demurrage_rate_override_p1_usd numeric(10,2),
    demurrage_rate_override_p2_usd numeric(10,2),
    demurrage_roe_manual boolean DEFAULT false,
    demurrage_roe numeric(10,4),
    consignee_block text,
    consignee_address text,
    consignee_phone text,
    shipper_block text,
    notify_cnpj_cpf text,
    notify_block text,
    notify2_block text,
    total_packages integer,
    packages_unit text,
    bl_emission_date date,
    place_of_receipt text,
    movement_from text,
    movement_to text,
    issue_place text,
    suggested_customer_id bigint,
    ncm_codes text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT bls_cargo_mode_check CHECK ((cargo_mode = ANY (ARRAY['container'::text, 'carga_solta'::text]))),
    CONSTRAINT bls_charge_status_check CHECK ((charge_status = ANY (ARRAY['not_calculated'::text, 'calculated'::text, 'review_required'::text, 'reviewed'::text, 'ready_for_billing'::text, 'exempt'::text]))),
    CONSTRAINT bls_container_load_type_check CHECK (((container_load_type = ANY (ARRAY['FCL'::text, 'LCL'::text])) OR (container_load_type IS NULL))),
    CONSTRAINT bls_customer_reconciliation_status_check CHECK ((customer_reconciliation_status = ANY (ARRAY['matched_document'::text, 'matched_name'::text, 'missing_customer'::text, 'reconciled'::text, 'rejected'::text]))),
    CONSTRAINT bls_financial_status_check CHECK ((financial_status = ANY (ARRAY['pending'::text, 'invoiced'::text, 'paid'::text, 'cancelled'::text]))),
    CONSTRAINT bls_ncm_codes_digits CHECK ((array_to_string(ncm_codes, ','::text) ~ '^([0-9]{4,8}(,[0-9]{4,8})*)?$'::text)),
    CONSTRAINT bls_payment_type_check CHECK ((payment_type = ANY (ARRAY['PREPAID'::text, 'COLLECT'::text]))),
    CONSTRAINT bls_review_status_check CHECK ((review_status = ANY (ARRAY['ok'::text, 'pending_review'::text, 'reviewed'::text]))),
    CONSTRAINT bls_total_cbm_nonneg CHECK (((total_cbm IS NULL) OR (total_cbm >= (0)::numeric))),
    CONSTRAINT bls_total_weight_kg_nonneg CHECK (((total_weight_kg IS NULL) OR (total_weight_kg >= (0)::numeric)))
);



--
-- Name: COLUMN bls.ncm_codes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bls.ncm_codes IS 'NCM da carga do B/L, somente dígitos (4 a 8), sem pontuação e sem duplicata. Vazio enquanto ninguém cadastrou nem o documento declarou. Necessário para a manifestação no Mercante.';



--
-- Name: carriers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.carriers (
    id bigint NOT NULL,
    name text NOT NULL,
    scac text,
    created_at timestamp with time zone DEFAULT now()
);



--
-- Name: carriers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.carriers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: carriers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.carriers_id_seq OWNED BY public.carriers.id;



--
-- Name: charge_calculations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.charge_calculations (
    id bigint NOT NULL,
    bl_id text,
    charge_table_id bigint,
    charge_item_id bigint,
    container_id bigint,
    quantity numeric(10,3) DEFAULT 1,
    unit_value_brl numeric(12,2),
    total_value_brl numeric(14,2),
    override_applied boolean DEFAULT false,
    calculated_at timestamp with time zone DEFAULT now(),
    source text,
    status text,
    calculation_key text,
    unit_value_usd numeric(12,2),
    total_value_usd numeric(14,2),
    notes text,
    manual_reason text,
    review_reason text,
    created_by uuid,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    manifest_id bigint,
    billing_run_id bigint,
    pricing_rule_version_id bigint,
    CONSTRAINT charge_calculations_source_check CHECK ((source = ANY (ARRAY['auto'::text, 'manual'::text]))),
    CONSTRAINT charge_calculations_status_check CHECK ((status = ANY (ARRAY['calculated'::text, 'review_required'::text, 'reviewed'::text, 'ready_for_billing'::text, 'exempt'::text])))
);



--
-- Name: charge_calculations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.charge_calculations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: charge_calculations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.charge_calculations_id_seq OWNED BY public.charge_calculations.id;



--
-- Name: charge_table_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.charge_table_items (
    id bigint NOT NULL,
    charge_table_id bigint,
    name text NOT NULL,
    applies_to text NOT NULL,
    container_type text,
    cargo_profile text,
    value_brl numeric(12,2) NOT NULL,
    currency text DEFAULT 'BRL'::text,
    created_at timestamp with time zone DEFAULT now(),
    category text,
    application_basis text,
    unit_value_brl numeric(12,2),
    unit_value_usd numeric(12,2),
    manual_only boolean DEFAULT false,
    active boolean DEFAULT true,
    sort_order integer DEFAULT 100,
    CONSTRAINT charge_table_items_application_basis_check CHECK ((application_basis = ANY (ARRAY['bl'::text, 'container_distinct_voyage'::text, 'weight_ton'::text, 'teu'::text]))),
    CONSTRAINT charge_table_items_applies_to_check CHECK ((applies_to = ANY (ARRAY['bl'::text, 'container'::text, 'teu'::text]))),
    CONSTRAINT charge_table_items_cargo_profile_check CHECK ((cargo_profile = ANY (ARRAY['standard'::text, 'oog'::text, 'imo'::text, 'any'::text]))),
    CONSTRAINT charge_table_items_category_check CHECK ((category = ANY (ARRAY['base'::text, 'other_charge'::text])))
);



--
-- Name: charge_table_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.charge_table_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: charge_table_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.charge_table_items_id_seq OWNED BY public.charge_table_items.id;



--
-- Name: charge_tables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.charge_tables (
    id bigint NOT NULL,
    name text NOT NULL,
    pod text,
    carrier_id bigint,
    valid_from date NOT NULL,
    valid_to date,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    cargo_mode text DEFAULT 'container'::text,
    notes text,
    CONSTRAINT charge_tables_cargo_mode_check CHECK ((cargo_mode = ANY (ARRAY['container'::text, 'carga_solta'::text, 'granito'::text])))
);



--
-- Name: charge_tables_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.charge_tables_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: charge_tables_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.charge_tables_id_seq OWNED BY public.charge_tables.id;



--
-- Name: cod_adjustments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cod_adjustments (
    id bigint NOT NULL,
    bl_id text NOT NULL,
    omission_id bigint NOT NULL,
    original_value_brl numeric(14,2) DEFAULT 0 NOT NULL,
    new_destination_value_brl numeric(14,2) DEFAULT 0 NOT NULL,
    difference_brl numeric(14,2) DEFAULT 0 NOT NULL,
    paid_amount_brl numeric(14,2) DEFAULT 0 NOT NULL,
    outstanding_balance_brl numeric(14,2) DEFAULT 0 NOT NULL,
    offset_amount_brl numeric(14,2) DEFAULT 0 NOT NULL,
    refund_amount_brl numeric(14,2) DEFAULT 0 NOT NULL,
    action text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    manual_review_required boolean DEFAULT false NOT NULL,
    resulting_document_id bigint,
    resulting_document_type text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cod_adjustments_action_check CHECK ((action = ANY (ARRAY['complementary_invoice'::text, 'cancel_and_reissue'::text, 'manual_charge_review'::text, 'offset_open_balance'::text, 'refund_overpayment'::text]))),
    CONSTRAINT cod_adjustments_difference_check CHECK ((difference_brl = round((new_destination_value_brl - original_value_brl), 2))),
    CONSTRAINT cod_adjustments_document_type_check CHECK (((resulting_document_type IS NULL) OR (resulting_document_type = ANY (ARRAY['invoice'::text, 'refund'::text])))),
    CONSTRAINT cod_adjustments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'settled'::text, 'cancelled'::text]))),
    CONSTRAINT cod_adjustments_values_non_negative CHECK (((original_value_brl >= (0)::numeric) AND (new_destination_value_brl >= (0)::numeric) AND (paid_amount_brl >= (0)::numeric) AND (outstanding_balance_brl >= (0)::numeric) AND (offset_amount_brl >= (0)::numeric) AND (refund_amount_brl >= (0)::numeric)))
);



--
-- Name: cod_adjustments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cod_adjustments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: cod_adjustments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cod_adjustments_id_seq OWNED BY public.cod_adjustments.id;



--
-- Name: customer_communication_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_communication_attachments (
    id bigint NOT NULL,
    communication_id bigint NOT NULL,
    storage_path text NOT NULL,
    file_name text NOT NULL,
    mime_type text NOT NULL,
    size_bytes bigint NOT NULL,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_communication_attachments_file_name_check CHECK ((char_length(btrim(file_name)) > 0)),
    CONSTRAINT customer_communication_attachments_mime_type_check CHECK ((mime_type = ANY (ARRAY['application/pdf'::text, 'image/jpeg'::text, 'image/png'::text, 'text/plain'::text]))),
    CONSTRAINT customer_communication_attachments_size_bytes_check CHECK (((size_bytes >= 0) AND (size_bytes <= 10485760)))
);



--
-- Name: customer_communication_attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_communication_attachments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: customer_communication_attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_communication_attachments_id_seq OWNED BY public.customer_communication_attachments.id;



--
-- Name: customer_communication_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_communication_attempts (
    id bigint NOT NULL,
    communication_id bigint NOT NULL,
    recipient_masked text NOT NULL,
    status text DEFAULT 'aceito'::text NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    provider_message_id text,
    last_error text,
    idempotency_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_communication_attempts_retry_count_check CHECK ((retry_count >= 0)),
    CONSTRAINT customer_communication_attempts_status_check CHECK ((status = ANY (ARRAY['aceito'::text, 'entregue'::text, 'bounce'::text, 'complaint'::text, 'falha_transitoria'::text, 'falha_permanente'::text])))
);



--
-- Name: customer_communication_attempts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_communication_attempts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: customer_communication_attempts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_communication_attempts_id_seq OWNED BY public.customer_communication_attempts.id;



--
-- Name: customer_communication_automation_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_communication_automation_claims (
    claim_key text NOT NULL,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL,
    released_at timestamp with time zone
);



--
-- Name: customer_communication_bls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_communication_bls (
    communication_id bigint NOT NULL,
    bl_id text NOT NULL
);



--
-- Name: customer_communication_kinds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_communication_kinds (
    kind text NOT NULL,
    nature text NOT NULL,
    CONSTRAINT customer_communication_kinds_nature_check CHECK ((nature = ANY (ARRAY['avisos_gerais'::text, 'avisos_operacionais'::text, 'documentacao'::text, 'demurrage'::text])))
);



--
-- Name: customer_communication_saved_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_communication_saved_templates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: customer_communication_saved_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_communication_saved_templates_id_seq OWNED BY public.customer_communication_saved_templates.id;



--
-- Name: customer_communication_suppressions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_communication_suppressions (
    id bigint NOT NULL,
    email text NOT NULL,
    reason text DEFAULT 'complaint'::text NOT NULL,
    suppressed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_communication_suppressions_reason_check CHECK ((reason = 'complaint'::text))
);



--
-- Name: customer_communication_suppressions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_communication_suppressions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: customer_communication_suppressions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_communication_suppressions_id_seq OWNED BY public.customer_communication_suppressions.id;



--
-- Name: customer_communication_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_communication_templates (
    id bigint NOT NULL,
    kind text NOT NULL,
    subject_template text NOT NULL,
    body_html_template text NOT NULL,
    body_text_template text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_communication_templates_body_html_template_check CHECK ((char_length(btrim(body_html_template)) > 0)),
    CONSTRAINT customer_communication_templates_body_text_template_check CHECK ((char_length(btrim(body_text_template)) > 0)),
    CONSTRAINT customer_communication_templates_kind_check CHECK ((kind = ANY (ARRAY['aviso_chegada_noa'::text, 'aviso_prontidao_nor'::text, 'aviso_atracacao_nob'::text, 'ce_mercante_taxas'::text, 'cobranca_demurrage'::text, 'institucional'::text, 'livre'::text]))),
    CONSTRAINT customer_communication_templates_subject_template_check CHECK ((char_length(btrim(subject_template)) > 0))
);



--
-- Name: customer_communication_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_communication_templates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: customer_communication_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_communication_templates_id_seq OWNED BY public.customer_communication_templates.id;



--
-- Name: customer_communications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_communications (
    id bigint NOT NULL,
    customer_id bigint NOT NULL,
    kind text NOT NULL,
    nature text NOT NULL,
    anchor_voyage_id bigint,
    anchor_port text,
    anchor_atracacao_id uuid,
    anchor_invoice_id bigint,
    attempt_discriminator integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'simulado'::text NOT NULL,
    dispatch_id uuid,
    vessel_name text,
    voyage_number text,
    terminal_name text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    origin text DEFAULT 'manual'::text NOT NULL,
    CONSTRAINT customer_communications_anchor_port_check CHECK (((anchor_port IS NULL) OR (btrim(anchor_port) <> ''::text))),
    CONSTRAINT customer_communications_attempt_discriminator_check CHECK ((attempt_discriminator >= 0)),
    CONSTRAINT customer_communications_origin_check CHECK ((origin = ANY (ARRAY['manual'::text, 'automatico'::text]))),
    CONSTRAINT customer_communications_status_check CHECK ((status = ANY (ARRAY['enviado'::text, 'simulado'::text, 'falha'::text])))
);



--
-- Name: customer_communications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_communications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: customer_communications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_communications_id_seq OWNED BY public.customer_communications.id;



--
-- Name: customer_contact_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_contact_preferences (
    contact_id bigint NOT NULL,
    nature text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    source text DEFAULT 'interno'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_contact_preferences_nature_check CHECK ((nature = ANY (ARRAY['avisos_gerais'::text, 'avisos_operacionais'::text, 'documentacao'::text, 'demurrage'::text]))),
    CONSTRAINT customer_contact_preferences_source_check CHECK ((source = ANY (ARRAY['interno'::text, 'cliente'::text])))
);



--
-- Name: customer_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_contacts (
    id bigint NOT NULL,
    customer_id bigint,
    name text,
    email text,
    phone text,
    purpose text,
    is_primary boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT customer_contacts_purpose_check CHECK ((purpose = ANY (ARRAY['faturamento'::text, 'operacional'::text, 'financeiro'::text, 'geral'::text])))
);



--
-- Name: customer_contacts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_contacts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: customer_contacts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_contacts_id_seq OWNED BY public.customer_contacts.id;



--
-- Name: customer_demurrage_agreements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_demurrage_agreements (
    id bigint NOT NULL,
    customer_id bigint NOT NULL,
    free_days integer NOT NULL,
    p1_usd numeric(10,2),
    p2_usd numeric(10,2),
    valid_from date DEFAULT CURRENT_DATE NOT NULL,
    valid_to date,
    active boolean DEFAULT true NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_demurrage_agreements_dates_check CHECK (((valid_to IS NULL) OR (valid_to >= valid_from))),
    CONSTRAINT customer_demurrage_agreements_free_days_check CHECK (((free_days >= 0) AND (free_days <= 365))),
    CONSTRAINT customer_demurrage_agreements_p1_usd_check CHECK (((p1_usd IS NULL) OR (p1_usd >= (0)::numeric))),
    CONSTRAINT customer_demurrage_agreements_p2_usd_check CHECK (((p2_usd IS NULL) OR (p2_usd >= (0)::numeric)))
);



--
-- Name: customer_demurrage_agreements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_demurrage_agreements_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: customer_demurrage_agreements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_demurrage_agreements_id_seq OWNED BY public.customer_demurrage_agreements.id;



--
-- Name: customer_portal_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_portal_accounts (
    id bigint NOT NULL,
    customer_id bigint NOT NULL,
    contact_email text,
    password_hash text,
    active boolean DEFAULT true NOT NULL,
    created_by uuid,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    auth_user_id uuid,
    portal_email text,
    login_cnpj text,
    provisioning_decision text DEFAULT 'aguardando_analise'::text NOT NULL,
    account_situation text DEFAULT 'sem_conta'::text NOT NULL,
    recovery_email text,
    recovery_email_source text,
    pending_recovery_email text,
    recovery_email_status text DEFAULT 'ok'::text NOT NULL,
    credentials_revoked_at timestamp with time zone,
    CONSTRAINT customer_portal_accounts_account_situation_check CHECK ((account_situation = ANY (ARRAY['sem_conta'::text, 'convite_pendente'::text, 'convite_expirado'::text, 'falha_no_envio'::text, 'ativo'::text, 'suspenso'::text]))),
    CONSTRAINT customer_portal_accounts_provisioning_decision_check CHECK ((provisioning_decision = ANY (ARRAY['aguardando_analise'::text, 'aprovado_para_provisionar'::text]))),
    CONSTRAINT customer_portal_accounts_recovery_email_source_check CHECK ((recovery_email_source = ANY (ARRAY['candidato'::text, 'informado_manualmente'::text]))),
    CONSTRAINT customer_portal_accounts_recovery_email_status_check CHECK ((recovery_email_status = ANY (ARRAY['ok'::text, 'bounce_permanente'::text, 'complaint'::text])))
);



--
-- Name: COLUMN customer_portal_accounts.recovery_email_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.customer_portal_accounts.recovery_email_status IS 'Saúde do endereço em recovery_email, marcada pelo webhook de bounce/complaint. Independente de account_situation.';



--
-- Name: COLUMN customer_portal_accounts.credentials_revoked_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.customer_portal_accounts.credentials_revoked_at IS 'Instante da última revogação de credencial do Portal. Token com iat anterior é recusado por current_portal_customer_id().';



--
-- Name: customer_portal_accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_portal_accounts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: customer_portal_accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_portal_accounts_id_seq OWNED BY public.customer_portal_accounts.id;



--
-- Name: customer_portal_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_portal_sessions (
    id bigint NOT NULL,
    account_id bigint NOT NULL,
    customer_id bigint NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



--
-- Name: customer_portal_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_portal_sessions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: customer_portal_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_portal_sessions_id_seq OWNED BY public.customer_portal_sessions.id;



--
-- Name: customer_rate_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_rate_overrides (
    id bigint NOT NULL,
    customer_id bigint,
    charge_item_id bigint,
    override_value numeric(12,2) NOT NULL,
    valid_from date,
    valid_to date,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);



--
-- Name: customer_rate_overrides_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_rate_overrides_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: customer_rate_overrides_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_rate_overrides_id_seq OWNED BY public.customer_rate_overrides.id;



--
-- Name: customer_reconciliation_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_reconciliation_queue (
    id bigint NOT NULL,
    manifest_id bigint,
    bl_id text NOT NULL,
    customer_id bigint,
    cnpj_cpf text,
    manifest_customer_name text,
    manifest_customer_email text,
    detection_type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    notes text,
    resolution_notes text,
    approved_by uuid,
    approved_at timestamp with time zone,
    rejected_by uuid,
    rejected_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_reconciliation_queue_detection_type_check CHECK ((detection_type = ANY (ARRAY['document'::text, 'name'::text, 'missing'::text, 'manual'::text]))),
    CONSTRAINT customer_reconciliation_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);



--
-- Name: customer_reconciliation_queue_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_reconciliation_queue_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: customer_reconciliation_queue_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_reconciliation_queue_id_seq OWNED BY public.customer_reconciliation_queue.id;



--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id bigint NOT NULL,
    cnpj_cpf text NOT NULL,
    name text NOT NULL,
    trade_name text,
    address text,
    city text,
    state text,
    zip text,
    notes text,
    pending_balance numeric(14,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);



--
-- Name: customers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: customers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customers_id_seq OWNED BY public.customers.id;



--
-- Name: demurrage_dispute_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.demurrage_dispute_attachments (
    id bigint NOT NULL,
    message_id bigint NOT NULL,
    dispute_id bigint NOT NULL,
    customer_id bigint NOT NULL,
    storage_path text NOT NULL,
    file_name text NOT NULL,
    mime_type text NOT NULL,
    size_bytes bigint NOT NULL,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT demurrage_dispute_attachments_size_bytes_check CHECK (((size_bytes > 0) AND (size_bytes <= 10485760)))
);



--
-- Name: demurrage_dispute_attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.demurrage_dispute_attachments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: demurrage_dispute_attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.demurrage_dispute_attachments_id_seq OWNED BY public.demurrage_dispute_attachments.id;



--
-- Name: demurrage_dispute_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.demurrage_dispute_messages (
    id bigint NOT NULL,
    dispute_id bigint NOT NULL,
    author_id uuid,
    author_type text NOT NULL,
    body text NOT NULL,
    next_responder text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT demurrage_dispute_messages_author_type_check CHECK ((author_type = ANY (ARRAY['cliente'::text, 'equipamentos'::text, 'sistema'::text]))),
    CONSTRAINT demurrage_dispute_messages_body_check CHECK ((char_length(btrim(body)) >= 1)),
    CONSTRAINT demurrage_dispute_messages_next_responder_check CHECK ((next_responder = ANY (ARRAY['cliente'::text, 'equipamentos'::text, 'ninguem'::text])))
);



--
-- Name: demurrage_dispute_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.demurrage_dispute_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: demurrage_dispute_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.demurrage_dispute_messages_id_seq OWNED BY public.demurrage_dispute_messages.id;



--
-- Name: demurrage_disputes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.demurrage_disputes (
    id bigint NOT NULL,
    demurrage_invoice_id bigint NOT NULL,
    customer_id bigint NOT NULL,
    state text DEFAULT 'aberta'::text NOT NULL,
    next_responder text DEFAULT 'equipamentos'::text NOT NULL,
    subject text,
    opened_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    CONSTRAINT demurrage_disputes_next_responder_check CHECK ((next_responder = ANY (ARRAY['cliente'::text, 'equipamentos'::text, 'ninguem'::text]))),
    CONSTRAINT demurrage_disputes_opened_by_check CHECK ((opened_by = ANY (ARRAY['cliente'::text, 'equipamentos'::text, 'sistema'::text]))),
    CONSTRAINT demurrage_disputes_state_check CHECK ((state = ANY (ARRAY['aberta'::text, 'resolvida'::text, 'cancelada'::text])))
);



--
-- Name: demurrage_disputes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.demurrage_disputes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: demurrage_disputes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.demurrage_disputes_id_seq OWNED BY public.demurrage_disputes.id;



--
-- Name: demurrage_dunning_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.demurrage_dunning_claims (
    demurrage_invoice_id bigint NOT NULL,
    attempt_discriminator integer NOT NULL,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL,
    released_at timestamp with time zone,
    CONSTRAINT demurrage_dunning_claims_attempt_discriminator_check CHECK ((attempt_discriminator > 0))
);



--
-- Name: demurrage_invoice_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.demurrage_invoice_history (
    id bigint NOT NULL,
    invoice_id bigint NOT NULL,
    event_date date NOT NULL,
    ptax_used numeric(10,4) NOT NULL,
    roe_used numeric(10,4) NOT NULL,
    total_usd numeric(12,2) NOT NULL,
    total_brl numeric(14,2) NOT NULL,
    discount_usd numeric(12,2) DEFAULT 0 NOT NULL,
    source text DEFAULT 'bcb_live'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT demurrage_invoice_history_source_check CHECK ((source = ANY (ARRAY['bcb_live'::text, 'cached'::text, 'manual'::text, 'payment'::text])))
);



--
-- Name: demurrage_invoice_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.demurrage_invoice_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: demurrage_invoice_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.demurrage_invoice_history_id_seq OWNED BY public.demurrage_invoice_history.id;



--
-- Name: demurrage_invoice_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.demurrage_invoice_items (
    id bigint NOT NULL,
    invoice_id bigint NOT NULL,
    container_id bigint NOT NULL,
    container_number text NOT NULL,
    container_type text NOT NULL,
    discharge_date date NOT NULL,
    return_date date NOT NULL,
    total_days integer NOT NULL,
    free_days integer NOT NULL,
    days_p1 integer DEFAULT 0 NOT NULL,
    rate_p1_usd numeric(10,2) DEFAULT 0 NOT NULL,
    days_p2 integer DEFAULT 0 NOT NULL,
    rate_p2_usd numeric(10,2) DEFAULT 0 NOT NULL,
    subtotal_usd numeric(12,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);



--
-- Name: demurrage_invoice_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.demurrage_invoice_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: demurrage_invoice_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.demurrage_invoice_items_id_seq OWNED BY public.demurrage_invoice_items.id;



--
-- Name: demurrage_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.demurrage_invoices (
    id bigint NOT NULL,
    doc_number text NOT NULL,
    bl_id text NOT NULL,
    customer_id bigint NOT NULL,
    doc_date date DEFAULT CURRENT_DATE,
    due_date date,
    billed_at date,
    first_billed_at date,
    paid_at date,
    ready_at date,
    total_usd numeric(12,2) DEFAULT 0 NOT NULL,
    roe numeric(10,4),
    roe_manual boolean DEFAULT false,
    current_roe numeric(10,4),
    current_total_brl numeric(14,2),
    discount_type text,
    discount_value numeric(12,2),
    discount_mode text,
    discount_justification text,
    discount_approver text,
    dispute_open boolean DEFAULT false,
    dispute_subject text,
    dispute_reason text,
    dispute_status text,
    dispute_notes text,
    pix_payload text,
    pix_txid text,
    conciliated_by_extract boolean DEFAULT false,
    status text DEFAULT 'draft'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    roe_source text,
    CONSTRAINT demurrage_invoices_discount_mode_check CHECK ((discount_mode = ANY (ARRAY['percent'::text, 'fixed'::text]))),
    CONSTRAINT demurrage_invoices_discount_percent_check CHECK (((discount_mode IS NULL) OR (discount_mode <> 'percent'::text) OR ((discount_value >= (0)::numeric) AND (discount_value <= (100)::numeric)))),
    CONSTRAINT demurrage_invoices_discount_type_check CHECK ((discount_type = ANY (ARRAY['comercial'::text, 'datas'::text, 'cortesia'::text, 'acordo'::text, 'erro'::text]))),
    CONSTRAINT demurrage_invoices_dispute_status_check CHECK ((dispute_status = ANY (ARRAY['aberto'::text, 'resolvido'::text, 'cancelado'::text]))),
    CONSTRAINT demurrage_invoices_roe_source_check CHECK ((roe_source = ANY (ARRAY['bcb_live'::text, 'cached'::text, 'manual'::text]))),
    CONSTRAINT demurrage_invoices_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'issued'::text, 'overdue'::text, 'paid'::text, 'cancelled'::text])))
);



--
-- Name: COLUMN demurrage_invoices.roe_source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.demurrage_invoices.roe_source IS 'Fonte do ROE: bcb_live = PTAX em tempo real, cached = cache localStorage, manual = informado manualmente.';



--
-- Name: demurrage_invoices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.demurrage_invoices_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: demurrage_invoices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.demurrage_invoices_id_seq OWNED BY public.demurrage_invoices.id;



--
-- Name: demurrage_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.demurrage_rates (
    id bigint NOT NULL,
    container_type text NOT NULL,
    free_days integer DEFAULT 21 NOT NULL,
    p1_day_from integer NOT NULL,
    p1_day_to integer NOT NULL,
    p1_usd numeric(10,2) NOT NULL,
    p2_day_from integer NOT NULL,
    p2_usd numeric(10,2) NOT NULL,
    valid_from date DEFAULT CURRENT_DATE NOT NULL,
    valid_to date,
    active boolean DEFAULT true NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);



--
-- Name: demurrage_rates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.demurrage_rates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: demurrage_rates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.demurrage_rates_id_seq OWNED BY public.demurrage_rates.id;



--
-- Name: depot_services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.depot_services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    depot_id uuid NOT NULL,
    name text NOT NULL,
    rate_brl numeric(12,2) DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    natureza text DEFAULT 'geral'::text NOT NULL,
    container_type text,
    route_destino_id uuid,
    condition text,
    CONSTRAINT depot_services_condition_check CHECK (((condition IS NULL) OR (condition = ANY (ARRAY['vazio'::text, 'material'::text])))),
    CONSTRAINT depot_services_natureza_check CHECK ((natureza = ANY (ARRAY['armazenagem'::text, 'transporte'::text, 'geral'::text]))),
    CONSTRAINT depot_services_rate_brl_check CHECK ((rate_brl >= (0)::numeric))
);



--
-- Name: depots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.depots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tipo text DEFAULT 'depot'::text NOT NULL,
    free_time_vazio_days integer DEFAULT 0 NOT NULL,
    free_time_material_days integer DEFAULT 0 NOT NULL,
    port_id bigint,
    CONSTRAINT depots_code_normalized_check CHECK (((btrim(code) <> ''::text) AND (code = upper(btrim(code))))),
    CONSTRAINT depots_free_time_check CHECK (((free_time_vazio_days >= 0) AND (free_time_material_days >= 0) AND ((tipo = 'depot'::text) OR ((free_time_vazio_days = 0) AND (free_time_material_days = 0))))),
    CONSTRAINT depots_tipo_check CHECK ((tipo = ANY (ARRAY['depot'::text, 'terminal_portuario'::text]))),
    CONSTRAINT depots_tipo_port_check CHECK (((tipo = 'terminal_portuario'::text) OR ((tipo = 'depot'::text) AND (port_id IS NULL))))
);



--
-- Name: ended_vessels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ended_vessels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    original_id uuid,
    vessel_name text NOT NULL,
    voyage text NOT NULL,
    qingdao_etd text DEFAULT 'X'::text,
    shanghai_etd text DEFAULT 'X'::text,
    taicang_etd text DEFAULT 'X'::text,
    ningbo_etd text DEFAULT 'X'::text,
    nansha_etd text DEFAULT 'X'::text,
    pecem_eta text DEFAULT 'X'::text,
    salvador_eta text DEFAULT 'X'::text,
    vitoria_eta text DEFAULT 'X'::text,
    imo_number text,
    ended_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



--
-- Name: exchange_rate_reference; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exchange_rate_reference (
    id smallint DEFAULT 1 NOT NULL,
    ptax numeric(10,4) NOT NULL,
    roe numeric(10,4) NOT NULL,
    effective_date date NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT exchange_rate_reference_id_check CHECK ((id = 1))
);



--
-- Name: granite_bl_charges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.granite_bl_charges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bl_id uuid NOT NULL,
    rate_id uuid,
    description text,
    charge_type text,
    unit_value numeric(12,4),
    quantity numeric(14,3),
    subtotal numeric(12,2),
    currency text,
    calculated_at timestamp with time zone DEFAULT now()
);



--
-- Name: granite_bls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.granite_bls (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    manifest_id uuid NOT NULL,
    client_id bigint,
    sequence integer,
    booking_number text,
    bl_number text NOT NULL,
    shipper_ref text,
    vessel_voyage text,
    loading_port text,
    discharge_port text,
    shipper_name text,
    shipper_cnpj text,
    consignee_name text,
    charter text,
    shipper_m3 numeric(12,3),
    shipper_weight_kg numeric(14,3),
    blocks_qty integer,
    received_blocks_qty integer,
    final_m3 numeric(12,3),
    real_weight_kg numeric(14,3),
    stockyard text,
    remarks text,
    partial_restriction boolean DEFAULT false,
    cosco_transport text,
    fragile_blocks integer,
    cssc_selection text,
    cargo_readiness_date date,
    phase text,
    charge_status text DEFAULT 'not_calculated'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    ce_mercante text,
    suggested_client_id bigint,
    CONSTRAINT granite_bls_charge_status_check CHECK ((charge_status = ANY (ARRAY['not_calculated'::text, 'calculated'::text, 'ready_for_billing'::text, 'invoiced'::text])))
);



--
-- Name: granite_manifests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.granite_manifests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    voyage_id bigint,
    vessel_voyage text NOT NULL,
    loading_port text,
    discharge_port text,
    total_bls integer,
    total_weight_kg numeric(14,3),
    imported_at timestamp with time zone DEFAULT now(),
    imported_by uuid
);



--
-- Name: granite_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.granite_rates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    description text NOT NULL,
    charge_type text NOT NULL,
    unit_value numeric(12,4) NOT NULL,
    currency text DEFAULT 'BRL'::text NOT NULL,
    valid_from date,
    valid_to date,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT granite_rates_charge_type_check CHECK ((charge_type = ANY (ARRAY['per_kg'::text, 'per_ton'::text, 'per_bl'::text, 'fixed'::text])))
);



--
-- Name: import_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.import_batches (
    id bigint NOT NULL,
    voyage_id bigint NOT NULL,
    filename text NOT NULL,
    uploaded_by uuid,
    uploaded_at timestamp with time zone DEFAULT now(),
    status text DEFAULT 'processing'::text,
    total_bls integer DEFAULT 0,
    total_containers integer DEFAULT 0,
    error_count integer DEFAULT 0,
    cargo_mode text DEFAULT 'container'::text NOT NULL,
    file_hash text,
    ce_master text,
    route_summary text,
    created_at timestamp with time zone GENERATED ALWAYS AS (uploaded_at) STORED,
    CONSTRAINT import_batches_cargo_mode_check CHECK ((cargo_mode = ANY (ARRAY['container'::text, 'carga_solta'::text]))),
    CONSTRAINT import_batches_status_check CHECK ((status = ANY (ARRAY['processing'::text, 'completed'::text, 'partial'::text, 'failed'::text])))
);



--
-- Name: COLUMN import_batches.ce_master; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.import_batches.ce_master IS 'Número do CE Mercante master do manifesto (Sistema Mercante). Distinto dos CEs por B/L em bls.ce_mercante.';



--
-- Name: import_batches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.import_batches_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: import_batches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.import_batches_id_seq OWNED BY public.import_batches.id;



--
-- Name: import_errors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.import_errors (
    id bigint NOT NULL,
    batch_id bigint NOT NULL,
    row_number integer,
    bl_number text,
    error_type text NOT NULL,
    error_message text,
    raw_data jsonb
);



--
-- Name: import_errors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.import_errors_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: import_errors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.import_errors_id_seq OWNED BY public.import_errors.id;



--
-- Name: internal_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.internal_notifications (
    id bigint NOT NULL,
    alert_id bigint NOT NULL,
    alert_item_id bigint NOT NULL,
    event_id bigint NOT NULL,
    recipient_id uuid NOT NULL,
    recipient_department text NOT NULL,
    is_fallback boolean DEFAULT false NOT NULL,
    item_type text NOT NULL,
    severity text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    entity_type text,
    entity_id text,
    destination text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT internal_notifications_severity_check CHECK ((severity = ANY (ARRAY['normal'::text, 'critical'::text])))
);



--
-- Name: TABLE internal_notifications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.internal_notifications IS 'Notificação Interna: cópia congelada por destinatário; RLS por destinatário.';



--
-- Name: internal_notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.internal_notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: internal_notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.internal_notifications_id_seq OWNED BY public.internal_notifications.id;



--
-- Name: invoice_bls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_bls (
    id bigint NOT NULL,
    invoice_id bigint NOT NULL,
    bl_id text NOT NULL,
    charge_status_snapshot text,
    financial_status_snapshot text,
    subtotal_brl numeric(14,2) DEFAULT 0 NOT NULL,
    subtotal_usd numeric(14,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



--
-- Name: invoice_bls_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoice_bls_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: invoice_bls_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoice_bls_id_seq OWNED BY public.invoice_bls.id;



--
-- Name: invoice_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_counters (
    year integer NOT NULL,
    last_number integer DEFAULT 0 NOT NULL
);



--
-- Name: invoice_granite_bls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_granite_bls (
    id bigint NOT NULL,
    invoice_id bigint NOT NULL,
    granite_bl_id uuid NOT NULL,
    subtotal_brl numeric(14,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



--
-- Name: invoice_granite_bls_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoice_granite_bls_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: invoice_granite_bls_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoice_granite_bls_id_seq OWNED BY public.invoice_granite_bls.id;



--
-- Name: invoice_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_items (
    id bigint NOT NULL,
    invoice_id bigint,
    charge_calculation_id bigint,
    description text NOT NULL,
    quantity numeric(10,3) DEFAULT 1,
    unit_value_brl numeric(12,2),
    total_value_brl numeric(14,2) NOT NULL,
    bl_id text,
    manifest_id bigint,
    charge_table_id bigint,
    charge_item_id bigint,
    source text,
    currency text,
    unit_value_usd numeric(12,2),
    total_value_usd numeric(14,2),
    pricing_rule_version_id bigint,
    billing_run_id bigint,
    calculation_key text,
    snapshot_payload jsonb DEFAULT '{}'::jsonb NOT NULL
);



--
-- Name: invoice_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoice_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: invoice_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoice_items_id_seq OWNED BY public.invoice_items.id;



--
-- Name: invoice_lifecycle_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_lifecycle_events (
    id bigint NOT NULL,
    invoice_id bigint NOT NULL,
    event_type text NOT NULL,
    related_invoice_id bigint,
    receivable_id bigint,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    actor uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT invoice_lifecycle_events_type_check CHECK ((event_type = ANY (ARRAY['issued'::text, 'paid'::text, 'partially_paid'::text, 'covered'::text, 'obsolete'::text, 'cancelled'::text, 'reconciled_by_txid'::text, 'backfilled'::text])))
);



--
-- Name: invoice_lifecycle_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoice_lifecycle_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: invoice_lifecycle_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoice_lifecycle_events_id_seq OWNED BY public.invoice_lifecycle_events.id;



--
-- Name: invoice_receivable_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_receivable_links (
    id bigint NOT NULL,
    invoice_id bigint NOT NULL,
    receivable_id bigint NOT NULL,
    bl_id text NOT NULL,
    subtotal_brl numeric(14,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    bl_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT invoice_receivable_links_status_check CHECK ((status = ANY (ARRAY['active'::text, 'settled_by_this_invoice'::text, 'settled_elsewhere'::text, 'obsolete'::text])))
);



--
-- Name: invoice_receivable_links_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoice_receivable_links_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: invoice_receivable_links_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoice_receivable_links_id_seq OWNED BY public.invoice_receivable_links.id;



--
-- Name: invoice_refunds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_refunds (
    id bigint NOT NULL,
    invoice_id bigint NOT NULL,
    payment_id bigint,
    amount_brl numeric(14,2) NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    registered_by uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    settled_at timestamp with time zone,
    cod_adjustment_id bigint,
    CONSTRAINT invoice_refunds_amount_positive CHECK ((amount_brl > (0)::numeric)),
    CONSTRAINT invoice_refunds_origin_check CHECK (((payment_id IS NULL) <> (cod_adjustment_id IS NULL))),
    CONSTRAINT invoice_refunds_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'settled'::text, 'cancelled'::text])))
);



--
-- Name: invoice_refunds_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoice_refunds_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: invoice_refunds_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoice_refunds_id_seq OWNED BY public.invoice_refunds.id;



--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id bigint NOT NULL,
    invoice_number text NOT NULL,
    customer_id bigint NOT NULL,
    bl_id text,
    issued_at timestamp with time zone DEFAULT now(),
    total_brl numeric(14,2) NOT NULL,
    status text DEFAULT 'issued'::text,
    pix_payload text,
    notes text,
    cancelled_at timestamp with time zone,
    cancelled_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    total_paid_brl numeric(14,2) DEFAULT 0 NOT NULL,
    balance_brl numeric(14,2) DEFAULT 0 NOT NULL,
    issued_by uuid,
    cancel_reason text,
    updated_at timestamp with time zone DEFAULT now(),
    pix_txid text,
    conciliated_by_extract boolean DEFAULT false,
    invoice_type text DEFAULT 'individual'::text NOT NULL,
    obsolete_reason text,
    covered_by_invoice_id bigint,
    replaced_by_invoice_id bigint,
    CONSTRAINT invoices_balance_nonneg CHECK ((balance_brl >= (0)::numeric)),
    CONSTRAINT invoices_invoice_type_check CHECK ((invoice_type = ANY (ARRAY['individual'::text, 'consolidated'::text, 'granite'::text]))),
    CONSTRAINT invoices_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'issued'::text, 'partially_paid'::text, 'paid'::text, 'covered'::text, 'obsolete'::text, 'cancelled'::text]))),
    CONSTRAINT invoices_total_brl_positive CHECK ((total_brl >= (0)::numeric)),
    CONSTRAINT invoices_total_paid_nonneg CHECK ((total_paid_brl >= (0)::numeric))
);



--
-- Name: invoices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoices_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: invoices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoices_id_seq OWNED BY public.invoices.id;



--
-- Name: ledger_settlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ledger_settlements (
    id bigint NOT NULL,
    payment_id bigint,
    receivable_id bigint NOT NULL,
    invoice_id bigint,
    amount_brl numeric(14,2) NOT NULL,
    settled_at timestamp with time zone DEFAULT now() NOT NULL,
    method text,
    pix_txid text,
    source text DEFAULT 'manual'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ledger_settlements_amount_positive CHECK ((amount_brl > (0)::numeric)),
    CONSTRAINT ledger_settlements_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'pix_extract'::text, 'backfill'::text])))
);



--
-- Name: ledger_settlements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ledger_settlements_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: ledger_settlements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ledger_settlements_id_seq OWNED BY public.ledger_settlements.id;



--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id bigint NOT NULL,
    invoice_id bigint NOT NULL,
    amount_brl numeric(14,2) NOT NULL,
    payment_method text,
    paid_at timestamp with time zone,
    registered_by uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT payments_amount_brl_positive CHECK ((amount_brl > (0)::numeric)),
    CONSTRAINT payments_payment_method_check CHECK ((payment_method = ANY (ARRAY['pix'::text, 'ted'::text, 'doc'::text, 'boleto'::text, 'outros'::text])))
);



--
-- Name: payments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payments_id_seq OWNED BY public.payments.id;



--
-- Name: pix_reconciliation_exceptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pix_reconciliation_exceptions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: pix_reconciliation_exceptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pix_reconciliation_exceptions_id_seq OWNED BY public.pix_reconciliation_exceptions.id;



--
-- Name: portal_email_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_email_attempts (
    id bigint NOT NULL,
    account_id bigint,
    invite_id bigint,
    kind text NOT NULL,
    idempotency_key text NOT NULL,
    provider_message_id text,
    recipient_masked text NOT NULL,
    status text DEFAULT 'aceito'::text NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT portal_email_attempts_kind_check CHECK ((kind = ANY (ARRAY['convite'::text, 'reenvio'::text, 'recuperacao'::text, 'alteracao_email'::text, 'alerta_critico'::text, 'resumo_diario'::text, 'contato_bounced_notificacao'::text]))),
    CONSTRAINT portal_email_attempts_status_check CHECK ((status = ANY (ARRAY['aceito'::text, 'entregue'::text, 'bounce'::text, 'complaint'::text, 'falha_transitoria'::text, 'falha_permanente'::text])))
);



--
-- Name: portal_email_attempts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portal_email_attempts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: portal_email_attempts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portal_email_attempts_id_seq OWNED BY public.portal_email_attempts.id;



--
-- Name: portal_email_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_email_events (
    id bigint NOT NULL,
    provider_event_id text NOT NULL,
    attempt_id bigint,
    event_type text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    communication_attempt_id bigint,
    CONSTRAINT portal_email_events_single_attempt_check CHECK ((NOT ((attempt_id IS NOT NULL) AND (communication_attempt_id IS NOT NULL))))
);



--
-- Name: portal_email_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portal_email_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: portal_email_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portal_email_events_id_seq OWNED BY public.portal_email_events.id;



--
-- Name: portal_inspection_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_inspection_events (
    id bigint NOT NULL,
    inspector_id uuid NOT NULL,
    customer_id bigint NOT NULL,
    origin text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT portal_inspection_events_origin_check CHECK ((origin = ANY (ARRAY['provisionamento'::text, 'ficha'::text])))
);



--
-- Name: portal_inspection_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portal_inspection_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: portal_inspection_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portal_inspection_events_id_seq OWNED BY public.portal_inspection_events.id;



--
-- Name: portal_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_invites (
    id bigint NOT NULL,
    account_id bigint NOT NULL,
    purpose text NOT NULL,
    token_hash text NOT NULL,
    sent_to_email text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    status text DEFAULT 'pendente'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    consumed_at timestamp with time zone,
    cancelled_reason text,
    CONSTRAINT portal_invites_purpose_check CHECK ((purpose = ANY (ARRAY['convite'::text, 'recuperacao'::text, 'confirmacao_email'::text]))),
    CONSTRAINT portal_invites_status_check CHECK ((status = ANY (ARRAY['pendente'::text, 'consumido'::text, 'expirado'::text, 'cancelado'::text, 'invalidado_por_reenvio'::text])))
);



--
-- Name: portal_invites_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portal_invites_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: portal_invites_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portal_invites_id_seq OWNED BY public.portal_invites.id;



--
-- Name: portal_login_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_login_attempts (
    id bigint NOT NULL,
    cnpj_hash text NOT NULL,
    attempted_at timestamp with time zone DEFAULT now() NOT NULL,
    succeeded boolean DEFAULT false NOT NULL,
    source text DEFAULT 'login'::text NOT NULL,
    CONSTRAINT portal_login_attempts_source_check CHECK ((source = ANY (ARRAY['login'::text, 'recovery'::text])))
);



--
-- Name: portal_login_attempts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portal_login_attempts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: portal_login_attempts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portal_login_attempts_id_seq OWNED BY public.portal_login_attempts.id;



--
-- Name: portal_login_resolution_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_login_resolution_attempts (
    id bigint NOT NULL,
    login_hash text NOT NULL,
    attempted_at timestamp with time zone DEFAULT now() NOT NULL
);



--
-- Name: portal_login_resolution_attempts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portal_login_resolution_attempts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: portal_login_resolution_attempts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portal_login_resolution_attempts_id_seq OWNED BY public.portal_login_resolution_attempts.id;



--
-- Name: portal_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_notifications (
    id bigint NOT NULL,
    customer_id bigint NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    link text,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    bl_id text,
    CONSTRAINT portal_notifications_type_check CHECK ((type = ANY (ARRAY['invoice_issued'::text, 'demurrage_issued'::text, 'dispute_responded'::text, 'dispute_opened'::text, 'system'::text, 'transshipment'::text])))
);



--
-- Name: portal_notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portal_notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: portal_notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portal_notifications_id_seq OWNED BY public.portal_notifications.id;



--
-- Name: portal_provisioning_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portal_provisioning_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: portal_provisioning_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portal_provisioning_events_id_seq OWNED BY public.portal_provisioning_events.id;



--
-- Name: portal_rate_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_rate_limits (
    id bigint NOT NULL,
    customer_id bigint NOT NULL,
    action_name text NOT NULL,
    attempted_at timestamp with time zone DEFAULT now() NOT NULL
);



--
-- Name: portal_rate_limits_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portal_rate_limits_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: portal_rate_limits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portal_rate_limits_id_seq OWNED BY public.portal_rate_limits.id;



--
-- Name: portal_suppressed_emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_suppressed_emails (
    id bigint NOT NULL,
    email text NOT NULL,
    reason text NOT NULL,
    suppressed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT portal_suppressed_emails_reason_check CHECK ((reason = ANY (ARRAY['bounce_permanente'::text, 'complaint'::text])))
);



--
-- Name: portal_suppressed_emails_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portal_suppressed_emails_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: portal_suppressed_emails_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portal_suppressed_emails_id_seq OWNED BY public.portal_suppressed_emails.id;



--
-- Name: ports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ports (
    id bigint NOT NULL,
    name text NOT NULL,
    locode text,
    country text,
    created_at timestamp with time zone DEFAULT now()
);



--
-- Name: ports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: ports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ports_id_seq OWNED BY public.ports.id;



--
-- Name: pricing_rule_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_rule_versions (
    id bigint NOT NULL,
    version_key text NOT NULL,
    charge_table_id bigint,
    charge_item_id bigint,
    customer_id bigint,
    customer_rate_override_id bigint,
    reference_date date,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



--
-- Name: pricing_rule_versions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pricing_rule_versions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: pricing_rule_versions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pricing_rule_versions_id_seq OWNED BY public.pricing_rule_versions.id;



--
-- Name: provision_rate_limit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provision_rate_limit_log (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    called_at timestamp with time zone DEFAULT now() NOT NULL
);



--
-- Name: provision_rate_limit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.provision_rate_limit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: provision_rate_limit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.provision_rate_limit_log_id_seq OWNED BY public.provision_rate_limit_log.id;



--
-- Name: user_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_profiles (
    id uuid NOT NULL,
    full_name text NOT NULL,
    role text DEFAULT 'operator'::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_profiles_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'operator'::text, 'administrativo'::text, 'financeiro'::text, 'operacoes'::text, 'documentacao'::text, 'equipamentos'::text])))
);



--
-- Name: vazios_bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vazios_bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    manifest_id uuid NOT NULL,
    container_number text NOT NULL,
    container_type text,
    movement_date date,
    created_at timestamp with time zone DEFAULT now(),
    hand_in_date date,
    hand_out_date date,
    voyage_id bigint NOT NULL,
    condition text NOT NULL,
    local_id uuid NOT NULL,
    operation_id uuid NOT NULL,
    CONSTRAINT vazios_bookings_condition_check CHECK ((condition = ANY (ARRAY['vazio'::text, 'material'::text])))
);



--
-- Name: vazios_export_operations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vazios_export_operations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    voyage_id bigint NOT NULL,
    embark_port text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);



--
-- Name: vazios_export_service_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vazios_export_service_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    operation_id uuid NOT NULL,
    service_id uuid NOT NULL,
    local_id uuid NOT NULL,
    destino_id uuid,
    container_type text,
    condition text,
    quantidade numeric(12,2) DEFAULT 0 NOT NULL,
    percentual numeric(5,2),
    valor_unitario numeric(12,2) DEFAULT 0 NOT NULL,
    valor_sugerido numeric(12,2),
    quantidade_manual boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    observation text,
    CONSTRAINT vazios_export_service_lines_condition_check CHECK (((condition IS NULL) OR (condition = ANY (ARRAY['vazio'::text, 'material'::text])))),
    CONSTRAINT vazios_export_service_lines_percentual_check CHECK (((percentual IS NULL) OR (percentual = ANY (ARRAY[(50)::numeric, (100)::numeric])))),
    CONSTRAINT vazios_export_service_lines_quantidade_check CHECK ((quantidade >= (0)::numeric)),
    CONSTRAINT vazios_export_service_lines_valor_sugerido_check CHECK (((valor_sugerido IS NULL) OR (valor_sugerido >= (0)::numeric))),
    CONSTRAINT vazios_export_service_lines_valor_unitario_check CHECK ((valor_unitario >= (0)::numeric))
);



--
-- Name: vazios_importacao_containers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vazios_importacao_containers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    manifest_id uuid NOT NULL,
    container_number text NOT NULL,
    container_type text,
    tare_kg numeric,
    created_at timestamp with time zone DEFAULT now(),
    pod text,
    natureza text,
    pol text,
    CONSTRAINT vazios_importacao_containers_natureza_check CHECK (((natureza IS NULL) OR (natureza = ANY (ARRAY['cama'::text, 'cover_plate'::text]))))
);



--
-- Name: vazios_importacao_manifests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vazios_importacao_manifests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    description text,
    total_containers integer,
    imported_at timestamp with time zone DEFAULT now(),
    imported_by uuid,
    voyage_id bigint,
    source text DEFAULT 'manual'::text NOT NULL,
    CONSTRAINT vazios_imp_manifests_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'baplie'::text])))
);



--
-- Name: vazios_manifests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vazios_manifests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    voyage_id bigint,
    description text,
    total_bookings integer,
    imported_at timestamp with time zone DEFAULT now(),
    imported_by uuid
);



--
-- Name: vehicles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicles (
    id bigint NOT NULL,
    voyage_id bigint NOT NULL,
    container_id bigint NOT NULL,
    bl_id text NOT NULL,
    chassis text NOT NULL,
    brand text NOT NULL,
    model text NOT NULL,
    weight_kg numeric(12,3) NOT NULL,
    cbm numeric(10,3) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT vehicles_cbm_positive CHECK ((cbm > (0)::numeric)),
    CONSTRAINT vehicles_weight_kg_positive CHECK ((weight_kg > (0)::numeric))
);



--
-- Name: vehicles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vehicles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: vehicles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vehicles_id_seq OWNED BY public.vehicles.id;



--
-- Name: vessel_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vessel_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vessel_name text NOT NULL,
    voyage text NOT NULL,
    imo_number text,
    qingdao_etd text DEFAULT 'X'::text,
    shanghai_etd text DEFAULT 'X'::text,
    taicang_etd text DEFAULT 'X'::text,
    ningbo_etd text DEFAULT 'X'::text,
    nansha_etd text DEFAULT 'X'::text,
    pecem_eta text DEFAULT 'X'::text,
    salvador_eta text DEFAULT 'X'::text,
    vitoria_eta text DEFAULT 'X'::text,
    display_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);



--
-- Name: vessels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vessels (
    id bigint NOT NULL,
    name text NOT NULL,
    imo text,
    carrier_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);



--
-- Name: vessels_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vessels_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: vessels_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vessels_id_seq OWNED BY public.vessels.id;



--
-- Name: voyage_escala_operation_fronts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.voyage_escala_operation_fronts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    voyage_id bigint NOT NULL,
    port text NOT NULL,
    port_id bigint NOT NULL,
    sentido text NOT NULL,
    modalidade text NOT NULL,
    terminal_id uuid,
    source text NOT NULL,
    revision integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_changed_at timestamp with time zone DEFAULT now() NOT NULL,
    last_changed_by uuid,
    CONSTRAINT voyage_escala_operation_fronts_check CHECK ((((sentido = 'importacao'::text) AND (modalidade = ANY (ARRAY['carga_cheia'::text, 'carga_solta'::text, 'vazio'::text, 'veiculo'::text]))) OR ((sentido = 'exportacao'::text) AND (modalidade = ANY (ARRAY['granito'::text, 'vazio'::text]))))),
    CONSTRAINT voyage_escala_operation_fronts_check1 CHECK ((((sentido = 'importacao'::text) AND (source = 'operational_data'::text)) OR ((sentido = 'exportacao'::text) AND (source = 'export_declaration'::text)))),
    CONSTRAINT voyage_escala_operation_fronts_port_check CHECK (((port = upper(btrim(port))) AND (btrim(port) <> ''::text))),
    CONSTRAINT voyage_escala_operation_fronts_revision_check CHECK ((revision >= 0)),
    CONSTRAINT voyage_escala_operation_fronts_source_check CHECK ((source = ANY (ARRAY['operational_data'::text, 'export_declaration'::text])))
);



--
-- Name: voyage_escala_revision_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.voyage_escala_revision_state (
    voyage_id bigint NOT NULL,
    port text NOT NULL,
    port_id bigint NOT NULL,
    revision integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT voyage_escala_revision_state_port_check CHECK (((port = upper(btrim(port))) AND (btrim(port) <> ''::text))),
    CONSTRAINT voyage_escala_revision_state_revision_check CHECK ((revision >= 0))
);



--
-- Name: voyage_escala_terminal_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.voyage_escala_terminal_state (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    voyage_id bigint NOT NULL,
    port text NOT NULL,
    port_id bigint NOT NULL,
    terminal_id uuid,
    terminal_atb timestamp with time zone,
    terminal_atd timestamp with time zone,
    terminal_rtw integer,
    revision integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    terminal_etb timestamp with time zone,
    terminal_etd timestamp with time zone,
    CONSTRAINT voyage_escala_terminal_state_check CHECK (((terminal_atd IS NULL) OR ((terminal_atb IS NOT NULL) AND (terminal_atd >= terminal_atb)))),
    CONSTRAINT voyage_escala_terminal_state_port_check CHECK (((port = upper(btrim(port))) AND (btrim(port) <> ''::text))),
    CONSTRAINT voyage_escala_terminal_state_revision_check CHECK ((revision >= 0)),
    CONSTRAINT voyage_escala_terminal_state_terminal_atd_check CHECK (((terminal_atd IS NULL) OR ((terminal_atb IS NOT NULL) AND (terminal_atd >= terminal_atb)))),
    CONSTRAINT voyage_escala_terminal_state_terminal_etd_check CHECK (((terminal_etd IS NULL) OR ((terminal_etb IS NOT NULL) AND (terminal_etd >= terminal_etb))))
);



--
-- Name: COLUMN voyage_escala_terminal_state.terminal_etb; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.voyage_escala_terminal_state.terminal_etb IS 'ETB previsto da Atracacao; NULL quando ainda nao informado.';



--
-- Name: COLUMN voyage_escala_terminal_state.terminal_etd; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.voyage_escala_terminal_state.terminal_etd IS 'ETD previsto da Atracacao; NULL quando ainda nao informado.';



--
-- Name: voyage_export_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.voyage_export_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    voyage_id integer NOT NULL,
    has_granite boolean DEFAULT false NOT NULL,
    containers_qty integer,
    movements_qty integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    ce_status text DEFAULT 'waiting'::text,
    linked boolean DEFAULT false NOT NULL,
    pol text NOT NULL,
    tem_exportacao boolean DEFAULT true NOT NULL,
    discharge_ports text[] DEFAULT '{}'::text[] NOT NULL,
    has_empty boolean DEFAULT false NOT NULL,
    CONSTRAINT voyage_export_schedules_ce_status_check CHECK ((ce_status = ANY (ARRAY['waiting'::text, 'received'::text, 'launching'::text, 'approving'::text, 'approved'::text])))
);



--
-- Name: COLUMN voyage_export_schedules.pol; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.voyage_export_schedules.pol IS 'Porto brasileiro da escala. Identidade (voyage_id, pol); as datas ficam na escala, nao aqui.';



--
-- Name: COLUMN voyage_export_schedules.tem_exportacao; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.voyage_export_schedules.tem_exportacao IS 'Declaracao explicita de que a escala tera embarque (ADR 0035, nota editorial 2026-08-03). Nao e derivado de quantidade preenchida.';



--
-- Name: COLUMN voyage_export_schedules.discharge_ports; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.voyage_export_schedules.discharge_ports IS 'Portos de descarga da carga embarcada nesta escala (ADR 0035). Codigos UN/LOCODE em caixa alta, estrangeiros inclusive; vazio enquanto o destino nao foi definido.';



--
-- Name: COLUMN voyage_export_schedules.has_empty; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.voyage_export_schedules.has_empty IS 'Declaração explícita de embarque de vazios na escala; independente das quantidades realizadas.';



--
-- Name: voyage_omissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.voyage_omissions (
    id bigint NOT NULL,
    voyage_id bigint NOT NULL,
    omitted_pod text NOT NULL,
    discharge_pod text NOT NULL,
    reason text,
    omitted_by uuid,
    omitted_at timestamp with time zone DEFAULT now() NOT NULL,
    onward_vessel_name text,
    onward_carrier text,
    onward_voyage_number text,
    onward_etd timestamp with time zone,
    onward_eta timestamp with time zone,
    reverted_at timestamp with time zone,
    reverted_by uuid,
    revert_justification text
);



--
-- Name: voyage_omissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.voyage_omissions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: voyage_omissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.voyage_omissions_id_seq OWNED BY public.voyage_omissions.id;



--
-- Name: voyage_route_ce_master; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.voyage_route_ce_master (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    voyage_id bigint NOT NULL,
    pol text NOT NULL,
    pod text NOT NULL,
    ce_master text,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now(),
    cargo_mode text DEFAULT 'container'::text NOT NULL
);



--
-- Name: voyages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.voyages (
    id bigint NOT NULL,
    vessel_id bigint NOT NULL,
    voyage_number text NOT NULL,
    pol_id bigint,
    pod_id bigint,
    etd timestamp with time zone,
    eta timestamp with time zone,
    ata timestamp with time zone,
    status text DEFAULT 'active'::text,
    created_at timestamp with time zone DEFAULT now(),
    pod_schedule_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    pol_schedule_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    show_on_portal boolean DEFAULT false NOT NULL,
    CONSTRAINT voyages_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'cancelled'::text])))
);



--
-- Name: COLUMN voyages.pod_schedule_snapshot; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.voyages.pod_schedule_snapshot IS 'Snapshot do estado atual das datas por POD. Chave = pod, valor = {eta, etb, ata, atd, rtw, ces, linked}.';



--
-- Name: COLUMN voyages.pol_schedule_snapshot; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.voyages.pol_schedule_snapshot IS 'Snapshot do estado atual do ETD por POL. Chave = pol, valor = {etd}.';



--
-- Name: voyages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.voyages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: voyages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.voyages_id_seq OWNED BY public.voyages.id;



--
-- Name: alert_item_dismissals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_item_dismissals ALTER COLUMN id SET DEFAULT nextval('public.alert_item_dismissals_id_seq'::regclass);



--
-- Name: alert_item_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_item_events ALTER COLUMN id SET DEFAULT nextval('public.alert_item_events_id_seq'::regclass);



--
-- Name: alert_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_items ALTER COLUMN id SET DEFAULT nextval('public.alert_items_id_seq'::regclass);



--
-- Name: alert_notification_failures id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_notification_failures ALTER COLUMN id SET DEFAULT nextval('public.alert_notification_failures_id_seq'::regclass);



--
-- Name: alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts ALTER COLUMN id SET DEFAULT nextval('public.alerts_id_seq'::regclass);



--
-- Name: audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs ALTER COLUMN id SET DEFAULT nextval('public.audit_logs_id_seq'::regclass);



--
-- Name: billing_batches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_batches ALTER COLUMN id SET DEFAULT nextval('public.billing_batches_id_seq'::regclass);



--
-- Name: billing_run_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_run_logs ALTER COLUMN id SET DEFAULT nextval('public.billing_run_logs_id_seq'::regclass);



--
-- Name: billing_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_runs ALTER COLUMN id SET DEFAULT nextval('public.billing_runs_id_seq'::regclass);



--
-- Name: bl_breakbulk_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bl_breakbulk_items ALTER COLUMN id SET DEFAULT nextval('public.bl_breakbulk_items_id_seq'::regclass);



--
-- Name: bl_containers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bl_containers ALTER COLUMN id SET DEFAULT nextval('public.bl_containers_id_seq'::regclass);



--
-- Name: bl_receivables id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bl_receivables ALTER COLUMN id SET DEFAULT nextval('public.bl_receivables_id_seq'::regclass);



--
-- Name: bl_transshipments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bl_transshipments ALTER COLUMN id SET DEFAULT nextval('public.bl_transshipments_id_seq'::regclass);



--
-- Name: carriers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carriers ALTER COLUMN id SET DEFAULT nextval('public.carriers_id_seq'::regclass);



--
-- Name: charge_calculations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charge_calculations ALTER COLUMN id SET DEFAULT nextval('public.charge_calculations_id_seq'::regclass);



--
-- Name: charge_table_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charge_table_items ALTER COLUMN id SET DEFAULT nextval('public.charge_table_items_id_seq'::regclass);



--
-- Name: charge_tables id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charge_tables ALTER COLUMN id SET DEFAULT nextval('public.charge_tables_id_seq'::regclass);



--
-- Name: cod_adjustments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cod_adjustments ALTER COLUMN id SET DEFAULT nextval('public.cod_adjustments_id_seq'::regclass);



--
-- Name: customer_communication_attachments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_communication_attachments ALTER COLUMN id SET DEFAULT nextval('public.customer_communication_attachments_id_seq'::regclass);



--
-- Name: customer_communication_attempts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_communication_attempts ALTER COLUMN id SET DEFAULT nextval('public.customer_communication_attempts_id_seq'::regclass);



--
-- Name: customer_communication_saved_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_communication_saved_templates ALTER COLUMN id SET DEFAULT nextval('public.customer_communication_saved_templates_id_seq'::regclass);



--
-- Name: customer_communication_suppressions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_communication_suppressions ALTER COLUMN id SET DEFAULT nextval('public.customer_communication_suppressions_id_seq'::regclass);



--
-- Name: customer_communication_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_communication_templates ALTER COLUMN id SET DEFAULT nextval('public.customer_communication_templates_id_seq'::regclass);



--
-- Name: customer_communications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_communications ALTER COLUMN id SET DEFAULT nextval('public.customer_communications_id_seq'::regclass);



--
-- Name: customer_contacts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_contacts ALTER COLUMN id SET DEFAULT nextval('public.customer_contacts_id_seq'::regclass);



--
-- Name: customer_demurrage_agreements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_demurrage_agreements ALTER COLUMN id SET DEFAULT nextval('public.customer_demurrage_agreements_id_seq'::regclass);



--
-- Name: customer_portal_accounts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_portal_accounts ALTER COLUMN id SET DEFAULT nextval('public.customer_portal_accounts_id_seq'::regclass);



--
-- Name: customer_portal_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_portal_sessions ALTER COLUMN id SET DEFAULT nextval('public.customer_portal_sessions_id_seq'::regclass);



--
-- Name: customer_rate_overrides id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_rate_overrides ALTER COLUMN id SET DEFAULT nextval('public.customer_rate_overrides_id_seq'::regclass);



--
-- Name: customer_reconciliation_queue id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_reconciliation_queue ALTER COLUMN id SET DEFAULT nextval('public.customer_reconciliation_queue_id_seq'::regclass);



--
-- Name: customers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers ALTER COLUMN id SET DEFAULT nextval('public.customers_id_seq'::regclass);



--
-- Name: demurrage_dispute_attachments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_dispute_attachments ALTER COLUMN id SET DEFAULT nextval('public.demurrage_dispute_attachments_id_seq'::regclass);



--
-- Name: demurrage_dispute_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_dispute_messages ALTER COLUMN id SET DEFAULT nextval('public.demurrage_dispute_messages_id_seq'::regclass);



--
-- Name: demurrage_disputes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_disputes ALTER COLUMN id SET DEFAULT nextval('public.demurrage_disputes_id_seq'::regclass);



--
-- Name: demurrage_invoice_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_invoice_history ALTER COLUMN id SET DEFAULT nextval('public.demurrage_invoice_history_id_seq'::regclass);



--
-- Name: demurrage_invoice_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_invoice_items ALTER COLUMN id SET DEFAULT nextval('public.demurrage_invoice_items_id_seq'::regclass);



--
-- Name: demurrage_invoices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_invoices ALTER COLUMN id SET DEFAULT nextval('public.demurrage_invoices_id_seq'::regclass);



--
-- Name: demurrage_rates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_rates ALTER COLUMN id SET DEFAULT nextval('public.demurrage_rates_id_seq'::regclass);



--
-- Name: import_batches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_batches ALTER COLUMN id SET DEFAULT nextval('public.import_batches_id_seq'::regclass);



--
-- Name: import_errors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_errors ALTER COLUMN id SET DEFAULT nextval('public.import_errors_id_seq'::regclass);



--
-- Name: internal_notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.internal_notifications ALTER COLUMN id SET DEFAULT nextval('public.internal_notifications_id_seq'::regclass);



--
-- Name: invoice_bls id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_bls ALTER COLUMN id SET DEFAULT nextval('public.invoice_bls_id_seq'::regclass);



--
-- Name: invoice_granite_bls id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_granite_bls ALTER COLUMN id SET DEFAULT nextval('public.invoice_granite_bls_id_seq'::regclass);



--
-- Name: invoice_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items ALTER COLUMN id SET DEFAULT nextval('public.invoice_items_id_seq'::regclass);



--
-- Name: invoice_lifecycle_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_lifecycle_events ALTER COLUMN id SET DEFAULT nextval('public.invoice_lifecycle_events_id_seq'::regclass);



--
-- Name: invoice_receivable_links id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_receivable_links ALTER COLUMN id SET DEFAULT nextval('public.invoice_receivable_links_id_seq'::regclass);



--
-- Name: invoice_refunds id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_refunds ALTER COLUMN id SET DEFAULT nextval('public.invoice_refunds_id_seq'::regclass);



--
-- Name: invoices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices ALTER COLUMN id SET DEFAULT nextval('public.invoices_id_seq'::regclass);



--
-- Name: ledger_settlements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_settlements ALTER COLUMN id SET DEFAULT nextval('public.ledger_settlements_id_seq'::regclass);



--
-- Name: payments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments ALTER COLUMN id SET DEFAULT nextval('public.payments_id_seq'::regclass);



--
-- Name: pix_reconciliation_exceptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pix_reconciliation_exceptions ALTER COLUMN id SET DEFAULT nextval('public.pix_reconciliation_exceptions_id_seq'::regclass);



--
-- Name: portal_email_attempts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_email_attempts ALTER COLUMN id SET DEFAULT nextval('public.portal_email_attempts_id_seq'::regclass);



--
-- Name: portal_email_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_email_events ALTER COLUMN id SET DEFAULT nextval('public.portal_email_events_id_seq'::regclass);



--
-- Name: portal_inspection_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_inspection_events ALTER COLUMN id SET DEFAULT nextval('public.portal_inspection_events_id_seq'::regclass);



--
-- Name: portal_invites id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_invites ALTER COLUMN id SET DEFAULT nextval('public.portal_invites_id_seq'::regclass);



--
-- Name: portal_login_attempts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_login_attempts ALTER COLUMN id SET DEFAULT nextval('public.portal_login_attempts_id_seq'::regclass);



--
-- Name: portal_login_resolution_attempts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_login_resolution_attempts ALTER COLUMN id SET DEFAULT nextval('public.portal_login_resolution_attempts_id_seq'::regclass);



--
-- Name: portal_notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_notifications ALTER COLUMN id SET DEFAULT nextval('public.portal_notifications_id_seq'::regclass);



--
-- Name: portal_provisioning_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_provisioning_events ALTER COLUMN id SET DEFAULT nextval('public.portal_provisioning_events_id_seq'::regclass);



--
-- Name: portal_rate_limits id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_rate_limits ALTER COLUMN id SET DEFAULT nextval('public.portal_rate_limits_id_seq'::regclass);



--
-- Name: portal_suppressed_emails id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_suppressed_emails ALTER COLUMN id SET DEFAULT nextval('public.portal_suppressed_emails_id_seq'::regclass);



--
-- Name: ports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ports ALTER COLUMN id SET DEFAULT nextval('public.ports_id_seq'::regclass);



--
-- Name: pricing_rule_versions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_rule_versions ALTER COLUMN id SET DEFAULT nextval('public.pricing_rule_versions_id_seq'::regclass);



--
-- Name: provision_rate_limit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provision_rate_limit_log ALTER COLUMN id SET DEFAULT nextval('public.provision_rate_limit_log_id_seq'::regclass);



--
-- Name: vehicles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles ALTER COLUMN id SET DEFAULT nextval('public.vehicles_id_seq'::regclass);



--
-- Name: vessels id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vessels ALTER COLUMN id SET DEFAULT nextval('public.vessels_id_seq'::regclass);



--
-- Name: voyage_omissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voyage_omissions ALTER COLUMN id SET DEFAULT nextval('public.voyage_omissions_id_seq'::regclass);



--
-- Name: voyages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voyages ALTER COLUMN id SET DEFAULT nextval('public.voyages_id_seq'::regclass);



--
-- Name: agency_departure_report_department_signoffs agency_departure_report_department_sig_report_id_department_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_departure_report_department_signoffs
    ADD CONSTRAINT agency_departure_report_department_sig_report_id_department_key UNIQUE (report_id, department);



--
-- Name: agency_departure_report_department_signoffs agency_departure_report_department_signoffs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_departure_report_department_signoffs
    ADD CONSTRAINT agency_departure_report_department_signoffs_pkey PRIMARY KEY (id);



--
-- Name: agency_departure_report_occurrences agency_departure_report_occurrences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_departure_report_occurrences
    ADD CONSTRAINT agency_departure_report_occurrences_pkey PRIMARY KEY (id);



--
-- Name: agency_departure_report_signoffs agency_departure_report_signoffs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_departure_report_signoffs
    ADD CONSTRAINT agency_departure_report_signoffs_pkey PRIMARY KEY (id);



--
-- Name: agency_departure_report_signoffs agency_departure_report_signoffs_report_id_section_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_departure_report_signoffs
    ADD CONSTRAINT agency_departure_report_signoffs_report_id_section_key UNIQUE (report_id, section);



--
-- Name: agency_departure_reports agency_departure_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_departure_reports
    ADD CONSTRAINT agency_departure_reports_pkey PRIMARY KEY (id);



--
-- Name: agency_report_pending_baselines agency_report_pending_baselines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_report_pending_baselines
    ADD CONSTRAINT agency_report_pending_baselines_pkey PRIMARY KEY (baseline_key);



--
-- Name: alert_item_dismissals alert_item_dismissals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_item_dismissals
    ADD CONSTRAINT alert_item_dismissals_pkey PRIMARY KEY (id);



--
-- Name: alert_item_events alert_item_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_item_events
    ADD CONSTRAINT alert_item_events_pkey PRIMARY KEY (id);



--
-- Name: alert_items alert_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_items
    ADD CONSTRAINT alert_items_pkey PRIMARY KEY (id);



--
-- Name: alert_notification_failures alert_notification_failures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_notification_failures
    ADD CONSTRAINT alert_notification_failures_pkey PRIMARY KEY (id);



--
-- Name: alert_type_catalog alert_type_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_type_catalog
    ADD CONSTRAINT alert_type_catalog_pkey PRIMARY KEY (type);



--
-- Name: alerts alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_pkey PRIMARY KEY (id);



--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (id);



--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);



--
-- Name: baplie_containers baplie_containers_container_number_iso; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.baplie_containers
    ADD CONSTRAINT baplie_containers_container_number_iso CHECK ((container_number ~ '^[A-Z]{4}[0-9]{7}$'::text)) NOT VALID;



--
-- Name: baplie_containers baplie_containers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.baplie_containers
    ADD CONSTRAINT baplie_containers_pkey PRIMARY KEY (id);



--
-- Name: baplie_reconciliation_resolutions baplie_reconciliation_resolut_voyage_id_bl_container_id_fie_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.baplie_reconciliation_resolutions
    ADD CONSTRAINT baplie_reconciliation_resolut_voyage_id_bl_container_id_fie_key UNIQUE (voyage_id, bl_container_id, field_name, baplie_value, manifest_value, resolution);



--
-- Name: baplie_reconciliation_resolutions baplie_reconciliation_resolutions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.baplie_reconciliation_resolutions
    ADD CONSTRAINT baplie_reconciliation_resolutions_pkey PRIMARY KEY (id);



--
-- Name: billing_batches billing_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_batches
    ADD CONSTRAINT billing_batches_pkey PRIMARY KEY (id);



--
-- Name: billing_run_logs billing_run_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_run_logs
    ADD CONSTRAINT billing_run_logs_pkey PRIMARY KEY (id);



--
-- Name: billing_runs billing_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_runs
    ADD CONSTRAINT billing_runs_pkey PRIMARY KEY (id);



--
-- Name: bl_breakbulk_items bl_breakbulk_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bl_breakbulk_items
    ADD CONSTRAINT bl_breakbulk_items_pkey PRIMARY KEY (id);



--
-- Name: bl_containers bl_containers_container_number_iso; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.bl_containers
    ADD CONSTRAINT bl_containers_container_number_iso CHECK ((container_number ~ '^[A-Z]{4}[0-9]{7}$'::text)) NOT VALID;



--
-- Name: bl_containers bl_containers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bl_containers
    ADD CONSTRAINT bl_containers_pkey PRIMARY KEY (id);



--
-- Name: bl_containers bl_containers_return_after_discharge_chk; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.bl_containers
    ADD CONSTRAINT bl_containers_return_after_discharge_chk CHECK (((return_date IS NULL) OR (discharge_date IS NULL) OR (return_date >= discharge_date))) NOT VALID;



--
-- Name: bl_freight_lines bl_freight_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bl_freight_lines
    ADD CONSTRAINT bl_freight_lines_pkey PRIMARY KEY (bl_id, seq);



--
-- Name: bl_receivables bl_receivables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bl_receivables
    ADD CONSTRAINT bl_receivables_pkey PRIMARY KEY (id);



--
-- Name: bl_receivables bl_receivables_source_bl_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bl_receivables
    ADD CONSTRAINT bl_receivables_source_bl_id_key UNIQUE (source, bl_id);



--
-- Name: bl_transshipments bl_transshipments_bl_id_omission_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bl_transshipments
    ADD CONSTRAINT bl_transshipments_bl_id_omission_id_key UNIQUE (bl_id, omission_id);



--
-- Name: bl_transshipments bl_transshipments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bl_transshipments
    ADD CONSTRAINT bl_transshipments_pkey PRIMARY KEY (id);



--
-- Name: bls bls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bls
    ADD CONSTRAINT bls_pkey PRIMARY KEY (id);



--
-- Name: carriers carriers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carriers
    ADD CONSTRAINT carriers_pkey PRIMARY KEY (id);



--
-- Name: charge_calculations charge_calculations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charge_calculations
    ADD CONSTRAINT charge_calculations_pkey PRIMARY KEY (id);



--
-- Name: charge_table_items charge_table_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charge_table_items
    ADD CONSTRAINT charge_table_items_pkey PRIMARY KEY (id);



--
-- Name: charge_tables charge_tables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charge_tables
    ADD CONSTRAINT charge_tables_pkey PRIMARY KEY (id);



--
-- Name: cod_adjustments cod_adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cod_adjustments
    ADD CONSTRAINT cod_adjustments_pkey PRIMARY KEY (id);



--
-- Name: customer_communication_attachments customer_communication_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_communication_attachments
    ADD CONSTRAINT customer_communication_attachments_pkey PRIMARY KEY (id);



--
-- Name: customer_communication_attachments customer_communication_attachments_storage_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_communication_attachments
    ADD CONSTRAINT customer_communication_attachments_storage_path_key UNIQUE (storage_path);



--
-- Name: customer_communication_attempts customer_communication_attempts_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_communication_attempts
    ADD CONSTRAINT customer_communication_attempts_idempotency_key_key UNIQUE (idempotency_key);



--
-- Name: customer_communication_attempts customer_communication_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_communication_attempts
    ADD CONSTRAINT customer_communication_attempts_pkey PRIMARY KEY (id);



--
-- Name: customer_communication_automation_claims customer_communication_automation_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_communication_automation_claims
    ADD CONSTRAINT customer_communication_automation_claims_pkey PRIMARY KEY (claim_key);



--
-- Name: customer_communication_bls customer_communication_bls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_communication_bls
    ADD CONSTRAINT customer_communication_bls_pkey PRIMARY KEY (communication_id, bl_id);



--
-- Name: customer_communication_kinds customer_communication_kinds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_communication_kinds
    ADD CONSTRAINT customer_communication_kinds_pkey PRIMARY KEY (kind, nature);



--
-- Name: customer_communication_saved_templates customer_communication_saved_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_communication_saved_templates
    ADD CONSTRAINT customer_communication_saved_templates_pkey PRIMARY KEY (id);



--
-- Name: customer_communication_suppressions customer_communication_suppressions_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_communication_suppressions
    ADD CONSTRAINT customer_communication_suppressions_email_key UNIQUE (email);



--
-- Name: customer_communication_suppressions customer_communication_suppressions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_communication_suppressions
    ADD CONSTRAINT customer_communication_suppressions_pkey PRIMARY KEY (id);



--
-- Name: customer_communication_templates customer_communication_templates_kind_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_communication_templates
    ADD CONSTRAINT customer_communication_templates_kind_unique UNIQUE (kind);



--
-- Name: customer_communication_templates customer_communication_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_communication_templates
    ADD CONSTRAINT customer_communication_templates_pkey PRIMARY KEY (id);



--
-- Name: customer_communications customer_communications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_communications
    ADD CONSTRAINT customer_communications_pkey PRIMARY KEY (id);



--
-- Name: customer_contact_preferences customer_contact_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_contact_preferences
    ADD CONSTRAINT customer_contact_preferences_pkey PRIMARY KEY (contact_id, nature);



--
-- Name: customer_contacts customer_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_contacts
    ADD CONSTRAINT customer_contacts_pkey PRIMARY KEY (id);



--
-- Name: customer_demurrage_agreements customer_demurrage_agreements_no_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_demurrage_agreements
    ADD CONSTRAINT customer_demurrage_agreements_no_overlap EXCLUDE USING gist (customer_id WITH =, daterange(valid_from, valid_to, '[]'::text) WITH &&) WHERE ((active = true));



--
-- Name: customer_demurrage_agreements customer_demurrage_agreements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_demurrage_agreements
    ADD CONSTRAINT customer_demurrage_agreements_pkey PRIMARY KEY (id);



--
-- Name: customer_portal_accounts customer_portal_accounts_customer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_portal_accounts
    ADD CONSTRAINT customer_portal_accounts_customer_id_key UNIQUE (customer_id);



--
-- Name: customer_portal_accounts customer_portal_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_portal_accounts
    ADD CONSTRAINT customer_portal_accounts_pkey PRIMARY KEY (id);



--
-- Name: customer_portal_sessions customer_portal_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_portal_sessions
    ADD CONSTRAINT customer_portal_sessions_pkey PRIMARY KEY (id);



--
-- Name: customer_portal_sessions customer_portal_sessions_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_portal_sessions
    ADD CONSTRAINT customer_portal_sessions_token_hash_key UNIQUE (token_hash);



--
-- Name: customer_rate_overrides customer_rate_overrides_no_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_rate_overrides
    ADD CONSTRAINT customer_rate_overrides_no_overlap EXCLUDE USING gist (customer_id WITH =, charge_item_id WITH =, daterange(valid_from, valid_to, '[]'::text) WITH &&);



--
-- Name: customer_rate_overrides customer_rate_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_rate_overrides
    ADD CONSTRAINT customer_rate_overrides_pkey PRIMARY KEY (id);



--
-- Name: customer_reconciliation_queue customer_reconciliation_queue_bl_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_reconciliation_queue
    ADD CONSTRAINT customer_reconciliation_queue_bl_id_key UNIQUE (bl_id);



--
-- Name: customer_reconciliation_queue customer_reconciliation_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_reconciliation_queue
    ADD CONSTRAINT customer_reconciliation_queue_pkey PRIMARY KEY (id);



--
-- Name: customers customers_cnpj_cpf_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_cnpj_cpf_key UNIQUE (cnpj_cpf);



--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);



--
-- Name: demurrage_dispute_attachments demurrage_dispute_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_dispute_attachments
    ADD CONSTRAINT demurrage_dispute_attachments_pkey PRIMARY KEY (id);



--
-- Name: demurrage_dispute_attachments demurrage_dispute_attachments_storage_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_dispute_attachments
    ADD CONSTRAINT demurrage_dispute_attachments_storage_path_key UNIQUE (storage_path);



--
-- Name: demurrage_dispute_messages demurrage_dispute_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_dispute_messages
    ADD CONSTRAINT demurrage_dispute_messages_pkey PRIMARY KEY (id);



--
-- Name: demurrage_disputes demurrage_disputes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_disputes
    ADD CONSTRAINT demurrage_disputes_pkey PRIMARY KEY (id);



--
-- Name: demurrage_dunning_claims demurrage_dunning_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_dunning_claims
    ADD CONSTRAINT demurrage_dunning_claims_pkey PRIMARY KEY (demurrage_invoice_id, attempt_discriminator);



--
-- Name: demurrage_invoice_history demurrage_invoice_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_invoice_history
    ADD CONSTRAINT demurrage_invoice_history_pkey PRIMARY KEY (id);



--
-- Name: demurrage_invoice_items demurrage_invoice_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_invoice_items
    ADD CONSTRAINT demurrage_invoice_items_pkey PRIMARY KEY (id);



--
-- Name: demurrage_invoice_items demurrage_invoice_items_return_after_discharge_chk; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.demurrage_invoice_items
    ADD CONSTRAINT demurrage_invoice_items_return_after_discharge_chk CHECK ((return_date >= discharge_date)) NOT VALID;



--
-- Name: demurrage_invoice_items demurrage_invoice_items_total_days_nonnegative_chk; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.demurrage_invoice_items
    ADD CONSTRAINT demurrage_invoice_items_total_days_nonnegative_chk CHECK ((total_days >= 0)) NOT VALID;



--
-- Name: demurrage_invoices demurrage_invoices_doc_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_invoices
    ADD CONSTRAINT demurrage_invoices_doc_number_key UNIQUE (doc_number);



--
-- Name: demurrage_invoices demurrage_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_invoices
    ADD CONSTRAINT demurrage_invoices_pkey PRIMARY KEY (id);



--
-- Name: demurrage_rates demurrage_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_rates
    ADD CONSTRAINT demurrage_rates_pkey PRIMARY KEY (id);



--
-- Name: depot_services depot_services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.depot_services
    ADD CONSTRAINT depot_services_pkey PRIMARY KEY (id);



--
-- Name: depots depots_id_port_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.depots
    ADD CONSTRAINT depots_id_port_id_key UNIQUE (id, port_id);



--
-- Name: depots depots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.depots
    ADD CONSTRAINT depots_pkey PRIMARY KEY (id);



--
-- Name: ended_vessels ended_vessels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ended_vessels
    ADD CONSTRAINT ended_vessels_pkey PRIMARY KEY (id);



--
-- Name: exchange_rate_reference exchange_rate_reference_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exchange_rate_reference
    ADD CONSTRAINT exchange_rate_reference_pkey PRIMARY KEY (id);



--
-- Name: granite_bl_charges granite_bl_charges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.granite_bl_charges
    ADD CONSTRAINT granite_bl_charges_pkey PRIMARY KEY (id);



--
-- Name: granite_bls granite_bls_manifest_id_bl_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.granite_bls
    ADD CONSTRAINT granite_bls_manifest_id_bl_number_key UNIQUE (manifest_id, bl_number);



--
-- Name: granite_bls granite_bls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.granite_bls
    ADD CONSTRAINT granite_bls_pkey PRIMARY KEY (id);



--
-- Name: granite_manifests granite_manifests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.granite_manifests
    ADD CONSTRAINT granite_manifests_pkey PRIMARY KEY (id);



--
-- Name: granite_rates granite_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.granite_rates
    ADD CONSTRAINT granite_rates_pkey PRIMARY KEY (id);



--
-- Name: import_batches import_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_batches
    ADD CONSTRAINT import_batches_pkey PRIMARY KEY (id);



--
-- Name: import_errors import_errors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_errors
    ADD CONSTRAINT import_errors_pkey PRIMARY KEY (id);



--
-- Name: internal_notifications internal_notifications_event_id_recipient_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.internal_notifications
    ADD CONSTRAINT internal_notifications_event_id_recipient_id_key UNIQUE (event_id, recipient_id);



--
-- Name: internal_notifications internal_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.internal_notifications
    ADD CONSTRAINT internal_notifications_pkey PRIMARY KEY (id);



--
-- Name: invoice_bls invoice_bls_invoice_id_bl_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_bls
    ADD CONSTRAINT invoice_bls_invoice_id_bl_id_key UNIQUE (invoice_id, bl_id);



--
-- Name: invoice_bls invoice_bls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_bls
    ADD CONSTRAINT invoice_bls_pkey PRIMARY KEY (id);



--
-- Name: invoice_counters invoice_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_counters
    ADD CONSTRAINT invoice_counters_pkey PRIMARY KEY (year);



--
-- Name: invoice_granite_bls invoice_granite_bls_invoice_id_granite_bl_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_granite_bls
    ADD CONSTRAINT invoice_granite_bls_invoice_id_granite_bl_id_key UNIQUE (invoice_id, granite_bl_id);



--
-- Name: invoice_granite_bls invoice_granite_bls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_granite_bls
    ADD CONSTRAINT invoice_granite_bls_pkey PRIMARY KEY (id);



--
-- Name: invoice_items invoice_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_pkey PRIMARY KEY (id);



--
-- Name: invoice_lifecycle_events invoice_lifecycle_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_lifecycle_events
    ADD CONSTRAINT invoice_lifecycle_events_pkey PRIMARY KEY (id);



--
-- Name: invoice_receivable_links invoice_receivable_links_invoice_id_receivable_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_receivable_links
    ADD CONSTRAINT invoice_receivable_links_invoice_id_receivable_id_key UNIQUE (invoice_id, receivable_id);



--
-- Name: invoice_receivable_links invoice_receivable_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_receivable_links
    ADD CONSTRAINT invoice_receivable_links_pkey PRIMARY KEY (id);



--
-- Name: invoice_refunds invoice_refunds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_refunds
    ADD CONSTRAINT invoice_refunds_pkey PRIMARY KEY (id);



--
-- Name: invoices invoices_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number);



--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);



--
-- Name: ledger_settlements ledger_settlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_settlements
    ADD CONSTRAINT ledger_settlements_pkey PRIMARY KEY (id);



--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);



--
-- Name: pix_reconciliation_exceptions pix_reconciliation_exceptions_import_key_line_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pix_reconciliation_exceptions
    ADD CONSTRAINT pix_reconciliation_exceptions_import_key_line_number_key UNIQUE (import_key, line_number);



--
-- Name: pix_reconciliation_exceptions pix_reconciliation_exceptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pix_reconciliation_exceptions
    ADD CONSTRAINT pix_reconciliation_exceptions_pkey PRIMARY KEY (id);



--
-- Name: portal_email_attempts portal_email_attempts_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_email_attempts
    ADD CONSTRAINT portal_email_attempts_idempotency_key_key UNIQUE (idempotency_key);



--
-- Name: portal_email_attempts portal_email_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_email_attempts
    ADD CONSTRAINT portal_email_attempts_pkey PRIMARY KEY (id);



--
-- Name: portal_email_events portal_email_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_email_events
    ADD CONSTRAINT portal_email_events_pkey PRIMARY KEY (id);



--
-- Name: portal_email_events portal_email_events_provider_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_email_events
    ADD CONSTRAINT portal_email_events_provider_event_id_key UNIQUE (provider_event_id);



--
-- Name: portal_inspection_events portal_inspection_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_inspection_events
    ADD CONSTRAINT portal_inspection_events_pkey PRIMARY KEY (id);



--
-- Name: portal_invites portal_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_invites
    ADD CONSTRAINT portal_invites_pkey PRIMARY KEY (id);



--
-- Name: portal_invites portal_invites_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_invites
    ADD CONSTRAINT portal_invites_token_hash_key UNIQUE (token_hash);



--
-- Name: portal_login_attempts portal_login_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_login_attempts
    ADD CONSTRAINT portal_login_attempts_pkey PRIMARY KEY (id);



--
-- Name: portal_login_resolution_attempts portal_login_resolution_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_login_resolution_attempts
    ADD CONSTRAINT portal_login_resolution_attempts_pkey PRIMARY KEY (id);



--
-- Name: portal_notifications portal_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_notifications
    ADD CONSTRAINT portal_notifications_pkey PRIMARY KEY (id);



--
-- Name: portal_provisioning_events portal_provisioning_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_provisioning_events
    ADD CONSTRAINT portal_provisioning_events_pkey PRIMARY KEY (id);



--
-- Name: portal_rate_limits portal_rate_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_rate_limits
    ADD CONSTRAINT portal_rate_limits_pkey PRIMARY KEY (id);



--
-- Name: portal_suppressed_emails portal_suppressed_emails_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_suppressed_emails
    ADD CONSTRAINT portal_suppressed_emails_email_key UNIQUE (email);



--
-- Name: portal_suppressed_emails portal_suppressed_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_suppressed_emails
    ADD CONSTRAINT portal_suppressed_emails_pkey PRIMARY KEY (id);



--
-- Name: ports ports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ports
    ADD CONSTRAINT ports_pkey PRIMARY KEY (id);



--
-- Name: pricing_rule_versions pricing_rule_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_rule_versions
    ADD CONSTRAINT pricing_rule_versions_pkey PRIMARY KEY (id);



--
-- Name: pricing_rule_versions pricing_rule_versions_version_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_rule_versions
    ADD CONSTRAINT pricing_rule_versions_version_key_key UNIQUE (version_key);



--
-- Name: provision_rate_limit_log provision_rate_limit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provision_rate_limit_log
    ADD CONSTRAINT provision_rate_limit_log_pkey PRIMARY KEY (id);



--
-- Name: user_profiles user_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (id);



--
-- Name: vazios_bookings vazios_bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vazios_bookings
    ADD CONSTRAINT vazios_bookings_pkey PRIMARY KEY (id);



--
-- Name: vazios_export_operations vazios_export_operations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vazios_export_operations
    ADD CONSTRAINT vazios_export_operations_pkey PRIMARY KEY (id);



--
-- Name: vazios_export_operations vazios_export_operations_voyage_id_embark_port_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vazios_export_operations
    ADD CONSTRAINT vazios_export_operations_voyage_id_embark_port_key UNIQUE (voyage_id, embark_port);



--
-- Name: vazios_export_service_lines vazios_export_service_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vazios_export_service_lines
    ADD CONSTRAINT vazios_export_service_lines_pkey PRIMARY KEY (id);



--
-- Name: vazios_importacao_containers vazios_importacao_containers_manifest_id_container_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vazios_importacao_containers
    ADD CONSTRAINT vazios_importacao_containers_manifest_id_container_number_key UNIQUE (manifest_id, container_number);



--
-- Name: vazios_importacao_containers vazios_importacao_containers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vazios_importacao_containers
    ADD CONSTRAINT vazios_importacao_containers_pkey PRIMARY KEY (id);



--
-- Name: vazios_importacao_manifests vazios_importacao_manifests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vazios_importacao_manifests
    ADD CONSTRAINT vazios_importacao_manifests_pkey PRIMARY KEY (id);



--
-- Name: vazios_manifests vazios_manifests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vazios_manifests
    ADD CONSTRAINT vazios_manifests_pkey PRIMARY KEY (id);



--
-- Name: vehicles vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_pkey PRIMARY KEY (id);



--
-- Name: vessel_schedules vessel_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vessel_schedules
    ADD CONSTRAINT vessel_schedules_pkey PRIMARY KEY (id);



--
-- Name: vessels vessels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vessels
    ADD CONSTRAINT vessels_pkey PRIMARY KEY (id);



--
-- Name: voyage_escala_operation_fronts voyage_escala_operation_fronts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voyage_escala_operation_fronts
    ADD CONSTRAINT voyage_escala_operation_fronts_pkey PRIMARY KEY (id);



--
-- Name: voyage_escala_revision_state voyage_escala_revision_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voyage_escala_revision_state
    ADD CONSTRAINT voyage_escala_revision_state_pkey PRIMARY KEY (voyage_id, port);



--
-- Name: voyage_escala_terminal_state voyage_escala_terminal_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voyage_escala_terminal_state
    ADD CONSTRAINT voyage_escala_terminal_state_pkey PRIMARY KEY (id);



--
-- Name: voyage_escala_terminal_state voyage_escala_terminal_state_voyage_id_port_terminal_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voyage_escala_terminal_state
    ADD CONSTRAINT voyage_escala_terminal_state_voyage_id_port_terminal_id_key UNIQUE (voyage_id, port, terminal_id);



--
-- Name: voyage_export_schedules voyage_export_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voyage_export_schedules
    ADD CONSTRAINT voyage_export_schedules_pkey PRIMARY KEY (id);



--
-- Name: voyage_export_schedules voyage_export_schedules_voyage_id_pol_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voyage_export_schedules
    ADD CONSTRAINT voyage_export_schedules_voyage_id_pol_key UNIQUE (voyage_id, pol);



--
-- Name: voyage_omissions voyage_omissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voyage_omissions
    ADD CONSTRAINT voyage_omissions_pkey PRIMARY KEY (id);



--
-- Name: voyage_omissions voyage_omissions_voyage_id_omitted_pod_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voyage_omissions
    ADD CONSTRAINT voyage_omissions_voyage_id_omitted_pod_key UNIQUE (voyage_id, omitted_pod);



--
-- Name: voyage_route_ce_master voyage_route_ce_master_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voyage_route_ce_master
    ADD CONSTRAINT voyage_route_ce_master_pkey PRIMARY KEY (id);



--
-- Name: voyage_route_ce_master voyage_route_ce_master_voyage_pol_pod_mode_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voyage_route_ce_master
    ADD CONSTRAINT voyage_route_ce_master_voyage_pol_pod_mode_uniq UNIQUE (voyage_id, pol, pod, cargo_mode);



--
-- Name: voyages voyages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voyages
    ADD CONSTRAINT voyages_pkey PRIMARY KEY (id);



--
-- Name: baplie_containers_container_number_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX baplie_containers_container_number_idx ON public.baplie_containers USING btree (voyage_id, container_number);



--
-- Name: baplie_containers_voyage_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX baplie_containers_voyage_id_idx ON public.baplie_containers USING btree (voyage_id);



--
-- Name: baplie_reconciliation_resolutions_voyage_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX baplie_reconciliation_resolutions_voyage_idx ON public.baplie_reconciliation_resolutions USING btree (voyage_id, bl_container_id);



--
-- Name: bl_transshipments_bl_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bl_transshipments_bl_idx ON public.bl_transshipments USING btree (bl_id);



--
-- Name: bl_transshipments_omission_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bl_transshipments_omission_idx ON public.bl_transshipments USING btree (omission_id);



--
-- Name: cod_adjustments_bl_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cod_adjustments_bl_idx ON public.cod_adjustments USING btree (bl_id);



--
-- Name: cod_adjustments_omission_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cod_adjustments_omission_idx ON public.cod_adjustments USING btree (omission_id);



--
-- Name: cod_adjustments_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cod_adjustments_pending_idx ON public.cod_adjustments USING btree (status, created_at DESC) WHERE (status = 'pending'::text);



--
-- Name: customer_communication_fixed_kind_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customer_communication_fixed_kind_unique ON public.customer_communication_kinds USING btree (kind) WHERE (kind <> 'livre'::text);



--
-- Name: customer_communications_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customer_communications_idempotency ON public.customer_communications USING btree (kind, customer_id, status, anchor_voyage_id, anchor_port, anchor_atracacao_id, anchor_invoice_id, dispatch_id, attempt_discriminator) NULLS NOT DISTINCT;



--
-- Name: depots_code_normalized_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX depots_code_normalized_key ON public.depots USING btree (upper(btrim(code)));



--
-- Name: idx_agency_departure_reports_terminal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agency_departure_reports_terminal ON public.agency_departure_reports USING btree (voyage_id, port, terminal_id);



--
-- Name: idx_alert_item_dismissals_current; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alert_item_dismissals_current ON public.alert_item_dismissals USING btree (alert_item_id, occurrence_id, review_at);



--
-- Name: idx_alert_item_events_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alert_item_events_item ON public.alert_item_events USING btree (alert_item_id, created_at DESC);



--
-- Name: idx_alert_items_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alert_items_active ON public.alert_items USING btree (alert_id, status);



--
-- Name: idx_alert_items_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alert_items_type ON public.alert_items USING btree (item_type, status);



--
-- Name: idx_alert_type_catalog_critical; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alert_type_catalog_critical ON public.alert_type_catalog USING btree (type) WHERE (active AND (severity = 'critical'::text));



--
-- Name: idx_alerts_assigned_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alerts_assigned_to ON public.alerts USING btree (assigned_to);



--
-- Name: idx_alerts_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alerts_status_created ON public.alerts USING btree (status, created_at DESC);



--
-- Name: idx_audit_logs_agency_report_reconciliation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_agency_report_reconciliation ON public.audit_logs USING btree (entity_type, entity_id, field_name, changed_at DESC);



--
-- Name: idx_audit_logs_changed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_changed_at ON public.audit_logs USING btree (changed_at DESC);



--
-- Name: idx_audit_logs_changed_by_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_changed_by_at ON public.audit_logs USING btree (changed_by, changed_at DESC);



--
-- Name: idx_audit_logs_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_entity ON public.audit_logs USING btree (entity_type, entity_id);



--
-- Name: idx_audit_logs_entity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_entity_id ON public.audit_logs USING btree (entity_id);



--
-- Name: idx_billing_run_logs_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_billing_run_logs_run_id ON public.billing_run_logs USING btree (billing_run_id, created_at DESC);



--
-- Name: idx_billing_runs_manifest_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_billing_runs_manifest_id ON public.billing_runs USING btree (manifest_id, created_at DESC);



--
-- Name: idx_bl_breakbulk_items_bl_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bl_breakbulk_items_bl_id ON public.bl_breakbulk_items USING btree (bl_id);



--
-- Name: idx_bl_containers_bl_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bl_containers_bl_id ON public.bl_containers USING btree (bl_id);



--
-- Name: idx_bl_containers_demurrage_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bl_containers_demurrage_status ON public.bl_containers USING btree (demurrage_status) WHERE (demurrage_status IS NOT NULL);



--
-- Name: idx_bl_containers_discharge_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bl_containers_discharge_date ON public.bl_containers USING btree (discharge_date) WHERE (discharge_date IS NOT NULL);



--
-- Name: idx_bl_containers_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bl_containers_number ON public.bl_containers USING btree (container_number);



--
-- Name: idx_bl_freight_lines_bl_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bl_freight_lines_bl_id ON public.bl_freight_lines USING btree (bl_id);



--
-- Name: idx_bl_receivables_bl; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bl_receivables_bl ON public.bl_receivables USING btree (bl_id);



--
-- Name: idx_bl_receivables_customer_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bl_receivables_customer_source ON public.bl_receivables USING btree (customer_id, source);



--
-- Name: idx_bl_receivables_customer_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bl_receivables_customer_status ON public.bl_receivables USING btree (customer_id, status);



--
-- Name: idx_bl_receivables_voyage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bl_receivables_voyage ON public.bl_receivables USING btree (voyage_id);



--
-- Name: idx_bls_ce_mercante; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bls_ce_mercante ON public.bls USING btree (ce_mercante);



--
-- Name: idx_bls_charge_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bls_charge_status ON public.bls USING btree (charge_status);



--
-- Name: idx_bls_customer_financial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bls_customer_financial ON public.bls USING btree (customer_id, financial_status);



--
-- Name: idx_bls_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bls_customer_id ON public.bls USING btree (customer_id);



--
-- Name: idx_bls_customer_reconciliation_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bls_customer_reconciliation_status ON public.bls USING btree (customer_reconciliation_status);



--
-- Name: idx_bls_financial_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bls_financial_status ON public.bls USING btree (financial_status);



--
-- Name: idx_bls_review_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bls_review_status ON public.bls USING btree (review_status);



--
-- Name: idx_bls_suggested_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bls_suggested_customer_id ON public.bls USING btree (suggested_customer_id);



--
-- Name: idx_bls_voyage_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bls_voyage_id ON public.bls USING btree (voyage_id);



--
-- Name: idx_charge_calculations_billing_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_charge_calculations_billing_run_id ON public.charge_calculations USING btree (billing_run_id, bl_id);



--
-- Name: idx_charge_calculations_bl_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_charge_calculations_bl_id ON public.charge_calculations USING btree (bl_id);



--
-- Name: idx_charge_calculations_manifest_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_charge_calculations_manifest_id ON public.charge_calculations USING btree (manifest_id, bl_id);



--
-- Name: idx_charge_table_items_table_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_charge_table_items_table_active ON public.charge_table_items USING btree (charge_table_id, active, manual_only);



--
-- Name: idx_customer_communication_attachments_communication; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_communication_attachments_communication ON public.customer_communication_attachments USING btree (communication_id, created_at);



--
-- Name: idx_customer_communication_attempts_communication; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_communication_attempts_communication ON public.customer_communication_attempts USING btree (communication_id, created_at DESC);



--
-- Name: idx_customer_communication_attempts_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_communication_attempts_provider ON public.customer_communication_attempts USING btree (provider_message_id) WHERE (provider_message_id IS NOT NULL);



--
-- Name: idx_customer_communication_automation_claims_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_communication_automation_claims_lookup ON public.customer_communication_automation_claims USING btree (claim_key, released_at, claimed_at DESC);



--
-- Name: idx_customer_communication_bls_bl; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_communication_bls_bl ON public.customer_communication_bls USING btree (bl_id);



--
-- Name: idx_customer_communications_anchor_atracacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_communications_anchor_atracacao ON public.customer_communications USING btree (anchor_atracacao_id);



--
-- Name: idx_customer_communications_anchor_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_communications_anchor_invoice ON public.customer_communications USING btree (anchor_invoice_id);



--
-- Name: idx_customer_communications_anchor_voyage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_communications_anchor_voyage ON public.customer_communications USING btree (anchor_voyage_id, anchor_port);



--
-- Name: idx_customer_communications_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_communications_customer ON public.customer_communications USING btree (customer_id, created_at DESC);



--
-- Name: idx_customer_communications_origin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_communications_origin ON public.customer_communications USING btree (origin, created_at DESC);



--
-- Name: idx_customer_demurrage_agreements_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_demurrage_agreements_customer_id ON public.customer_demurrage_agreements USING btree (customer_id);



--
-- Name: idx_customer_demurrage_agreements_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_demurrage_agreements_dates ON public.customer_demurrage_agreements USING btree (valid_from, valid_to);



--
-- Name: idx_customer_portal_sessions_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_portal_sessions_active ON public.customer_portal_sessions USING btree (customer_id, expires_at DESC) WHERE (revoked_at IS NULL);



--
-- Name: idx_customer_rate_overrides_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_rate_overrides_scope ON public.customer_rate_overrides USING btree (customer_id, charge_item_id, valid_from, valid_to);



--
-- Name: idx_customer_reconciliation_queue_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_reconciliation_queue_status ON public.customer_reconciliation_queue USING btree (status, created_at DESC);



--
-- Name: idx_customers_cnpj_cpf_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_cnpj_cpf_trgm ON public.customers USING gin (cnpj_cpf public.gin_trgm_ops);



--
-- Name: idx_customers_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_name_trgm ON public.customers USING gin (name public.gin_trgm_ops);



--
-- Name: idx_demurrage_disputes_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_demurrage_disputes_customer ON public.demurrage_disputes USING btree (customer_id, created_at DESC);



--
-- Name: idx_demurrage_dunning_claims_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_demurrage_dunning_claims_invoice ON public.demurrage_dunning_claims USING btree (demurrage_invoice_id, released_at, claimed_at DESC);



--
-- Name: idx_demurrage_inv_hist_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_demurrage_inv_hist_date ON public.demurrage_invoice_history USING btree (invoice_id, event_date DESC, id DESC);



--
-- Name: idx_demurrage_inv_hist_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_demurrage_inv_hist_invoice ON public.demurrage_invoice_history USING btree (invoice_id);



--
-- Name: idx_demurrage_invoice_items_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_demurrage_invoice_items_invoice ON public.demurrage_invoice_items USING btree (invoice_id);



--
-- Name: idx_demurrage_invoices_customer_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_demurrage_invoices_customer_status ON public.demurrage_invoices USING btree (customer_id, status);



--
-- Name: idx_depot_services_depot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_depot_services_depot ON public.depot_services USING btree (depot_id);



--
-- Name: idx_depots_port_id_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_depots_port_id_active ON public.depots USING btree (port_id, active);



--
-- Name: idx_dispute_attachments_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dispute_attachments_message ON public.demurrage_dispute_attachments USING btree (message_id);



--
-- Name: idx_dispute_messages_dispute; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dispute_messages_dispute ON public.demurrage_dispute_messages USING btree (dispute_id, created_at);



--
-- Name: idx_granite_bl_charges_bl_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_granite_bl_charges_bl_id ON public.granite_bl_charges USING btree (bl_id);



--
-- Name: idx_granite_bls_billing; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_granite_bls_billing ON public.granite_bls USING btree (charge_status, client_id);



--
-- Name: idx_granite_bls_ce_mercante; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_granite_bls_ce_mercante ON public.granite_bls USING btree (btrim(ce_mercante)) WHERE ((ce_mercante IS NOT NULL) AND (btrim(ce_mercante) <> ''::text));



--
-- Name: idx_granite_bls_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_granite_bls_client_id ON public.granite_bls USING btree (client_id);



--
-- Name: idx_granite_bls_manifest_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_granite_bls_manifest_id ON public.granite_bls USING btree (manifest_id);



--
-- Name: idx_granite_bls_suggested_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_granite_bls_suggested_client_id ON public.granite_bls USING btree (suggested_client_id);



--
-- Name: idx_granite_manifests_voyage_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_granite_manifests_voyage_id ON public.granite_manifests USING btree (voyage_id);



--
-- Name: idx_import_batches_cargo_mode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_import_batches_cargo_mode ON public.import_batches USING btree (cargo_mode);



--
-- Name: idx_import_batches_uploaded_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_import_batches_uploaded_at ON public.import_batches USING btree (uploaded_at DESC);



--
-- Name: idx_import_batches_voyage_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_import_batches_voyage_id ON public.import_batches USING btree (voyage_id);



--
-- Name: idx_import_errors_batch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_import_errors_batch_id ON public.import_errors USING btree (batch_id);



--
-- Name: idx_internal_notifications_recipient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_internal_notifications_recipient ON public.internal_notifications USING btree (recipient_id, read_at, created_at DESC);



--
-- Name: idx_invoice_bls_bl_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_bls_bl_id ON public.invoice_bls USING btree (bl_id);



--
-- Name: idx_invoice_bls_invoice_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_bls_invoice_id ON public.invoice_bls USING btree (invoice_id);



--
-- Name: idx_invoice_granite_bls_bl; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_granite_bls_bl ON public.invoice_granite_bls USING btree (granite_bl_id);



--
-- Name: idx_invoice_granite_bls_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_granite_bls_invoice ON public.invoice_granite_bls USING btree (invoice_id);



--
-- Name: idx_invoice_items_invoice_id_bl_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_items_invoice_id_bl_id ON public.invoice_items USING btree (invoice_id, bl_id);



--
-- Name: idx_invoice_lifecycle_events_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_lifecycle_events_invoice ON public.invoice_lifecycle_events USING btree (invoice_id, created_at DESC);



--
-- Name: idx_invoice_receivable_links_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_receivable_links_invoice ON public.invoice_receivable_links USING btree (invoice_id);



--
-- Name: idx_invoice_receivable_links_receivable_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_receivable_links_receivable_status ON public.invoice_receivable_links USING btree (receivable_id, status);



--
-- Name: idx_invoice_refunds_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_refunds_invoice ON public.invoice_refunds USING btree (invoice_id);



--
-- Name: idx_invoice_refunds_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_refunds_pending ON public.invoice_refunds USING btree (invoice_id) WHERE (status = 'pending'::text);



--
-- Name: idx_invoices_customer_issued; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_customer_issued ON public.invoices USING btree (customer_id, issued_at DESC);



--
-- Name: idx_invoices_pix_txid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_pix_txid ON public.invoices USING btree (pix_txid) WHERE (pix_txid IS NOT NULL);



--
-- Name: idx_ledger_settlements_one_live_receivable; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ledger_settlements_one_live_receivable ON public.ledger_settlements USING btree (receivable_id) WHERE (source = ANY (ARRAY['manual'::text, 'pix_extract'::text]));



--
-- Name: idx_ledger_settlements_pix_txid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ledger_settlements_pix_txid ON public.ledger_settlements USING btree (pix_txid) WHERE (pix_txid IS NOT NULL);



--
-- Name: idx_ledger_settlements_receivable; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ledger_settlements_receivable ON public.ledger_settlements USING btree (receivable_id);



--
-- Name: idx_ledger_settlements_unique_normalized_pix_txid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ledger_settlements_unique_normalized_pix_txid ON public.ledger_settlements USING btree (upper(regexp_replace(pix_txid, '[^A-Za-z0-9]'::text, ''::text, 'g'::text))) WHERE ((pix_txid IS NOT NULL) AND (source = 'pix_extract'::text));



--
-- Name: idx_payments_invoice_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_invoice_id ON public.payments USING btree (invoice_id);



--
-- Name: idx_pix_reconciliation_exceptions_resolved_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pix_reconciliation_exceptions_resolved_invoice ON public.pix_reconciliation_exceptions USING btree (resolved_invoice_id) WHERE (resolved_invoice_id IS NOT NULL);



--
-- Name: idx_pix_reconciliation_exceptions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pix_reconciliation_exceptions_status ON public.pix_reconciliation_exceptions USING btree (status, created_at DESC);



--
-- Name: idx_portal_accounts_auth_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_portal_accounts_auth_user_id ON public.customer_portal_accounts USING btree (auth_user_id) WHERE (auth_user_id IS NOT NULL);



--
-- Name: idx_portal_accounts_login_cnpj; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_portal_accounts_login_cnpj ON public.customer_portal_accounts USING btree (login_cnpj) WHERE (login_cnpj IS NOT NULL);



--
-- Name: idx_portal_accounts_recovery_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_accounts_recovery_email ON public.customer_portal_accounts USING btree (lower(recovery_email)) WHERE (recovery_email IS NOT NULL);



--
-- Name: idx_portal_accounts_situation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_accounts_situation ON public.customer_portal_accounts USING btree (account_situation, provisioning_decision);



--
-- Name: idx_portal_email_events_communication_attempt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_email_events_communication_attempt ON public.portal_email_events USING btree (communication_attempt_id) WHERE (communication_attempt_id IS NOT NULL);



--
-- Name: idx_portal_events_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_events_customer ON public.portal_provisioning_events USING btree (customer_id, created_at DESC);



--
-- Name: idx_portal_invites_account_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_invites_account_pending ON public.portal_invites USING btree (account_id, expires_at) WHERE (status = 'pendente'::text);



--
-- Name: idx_portal_login_attempts_cnpj_window; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_login_attempts_cnpj_window ON public.portal_login_attempts USING btree (cnpj_hash, attempted_at DESC);



--
-- Name: idx_portal_login_resolution_attempts_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_login_resolution_attempts_lookup ON public.portal_login_resolution_attempts USING btree (login_hash, attempted_at DESC);



--
-- Name: idx_portal_notifications_bl; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_notifications_bl ON public.portal_notifications USING btree (bl_id, created_at DESC);



--
-- Name: idx_portal_notifications_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_notifications_customer ON public.portal_notifications USING btree (customer_id, created_at DESC);



--
-- Name: idx_portal_rate_limits_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_rate_limits_lookup ON public.portal_rate_limits USING btree (customer_id, action_name, attempted_at DESC);



--
-- Name: idx_pricing_rule_versions_item_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pricing_rule_versions_item_customer ON public.pricing_rule_versions USING btree (charge_item_id, customer_id, reference_date);



--
-- Name: idx_provision_rate_limit_user_window; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provision_rate_limit_user_window ON public.provision_rate_limit_log USING btree (user_id, called_at DESC);



--
-- Name: idx_vazios_bookings_manifest_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vazios_bookings_manifest_id ON public.vazios_bookings USING btree (manifest_id);



--
-- Name: idx_vazios_bookings_operation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vazios_bookings_operation_id ON public.vazios_bookings USING btree (operation_id);



--
-- Name: idx_vazios_bookings_voyage_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vazios_bookings_voyage_id ON public.vazios_bookings USING btree (voyage_id);



--
-- Name: idx_vazios_export_service_lines_operation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vazios_export_service_lines_operation ON public.vazios_export_service_lines USING btree (operation_id);



--
-- Name: idx_vazios_export_service_lines_service; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vazios_export_service_lines_service ON public.vazios_export_service_lines USING btree (service_id);



--
-- Name: idx_vazios_imp_containers_manifest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vazios_imp_containers_manifest ON public.vazios_importacao_containers USING btree (manifest_id);



--
-- Name: idx_vazios_imp_manifests; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vazios_imp_manifests ON public.vazios_importacao_manifests USING btree (imported_at DESC);



--
-- Name: idx_vazios_imp_manifests_voyage_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vazios_imp_manifests_voyage_id ON public.vazios_importacao_manifests USING btree (voyage_id);



--
-- Name: idx_vazios_manifests_voyage_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vazios_manifests_voyage_id ON public.vazios_manifests USING btree (voyage_id);



--
-- Name: idx_vehicles_bl_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicles_bl_id ON public.vehicles USING btree (bl_id);



--
-- Name: idx_vehicles_chassis; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicles_chassis ON public.vehicles USING btree (chassis);



--
-- Name: idx_vehicles_container_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicles_container_id ON public.vehicles USING btree (container_id);



--
-- Name: idx_vehicles_voyage_chassis_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_vehicles_voyage_chassis_unique ON public.vehicles USING btree (voyage_id, chassis);



--
-- Name: idx_vehicles_voyage_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicles_voyage_created ON public.vehicles USING btree (voyage_id, created_at DESC);



--
-- Name: idx_vehicles_voyage_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicles_voyage_id ON public.vehicles USING btree (voyage_id);



--
-- Name: idx_voyage_escala_operation_fronts_terminal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_voyage_escala_operation_fronts_terminal ON public.voyage_escala_operation_fronts USING btree (terminal_id);



--
-- Name: idx_voyage_escala_revision_state_port; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_voyage_escala_revision_state_port ON public.voyage_escala_revision_state USING btree (port_id);



--
-- Name: idx_voyage_escala_terminal_state_scale; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_voyage_escala_terminal_state_scale ON public.voyage_escala_terminal_state USING btree (voyage_id, port);



--
-- Name: idx_voyage_escala_terminal_state_terminal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_voyage_escala_terminal_state_terminal ON public.voyage_escala_terminal_state USING btree (terminal_id);



--
-- Name: idx_voyages_status_etd; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_voyages_status_etd ON public.voyages USING btree (status, etd DESC);



--
-- Name: idx_voyages_vessel_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_voyages_vessel_id ON public.voyages USING btree (vessel_id);



--
-- Name: invoice_refunds_cod_adjustment_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX invoice_refunds_cod_adjustment_key ON public.invoice_refunds USING btree (cod_adjustment_id) WHERE (cod_adjustment_id IS NOT NULL);



--
-- Name: portal_inspection_events_customer_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portal_inspection_events_customer_created_idx ON public.portal_inspection_events USING btree (customer_id, created_at DESC);



--
-- Name: uq_agency_departure_reports_legacy; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_agency_departure_reports_legacy ON public.agency_departure_reports USING btree (voyage_id, port) WHERE (terminal_id IS NULL);



--
-- Name: uq_agency_departure_reports_terminal; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_agency_departure_reports_terminal ON public.agency_departure_reports USING btree (voyage_id, port, terminal_id) WHERE (terminal_id IS NOT NULL);



--
-- Name: uq_alert_items_type_department; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_alert_items_type_department ON public.alert_items USING btree (alert_id, item_type, department) NULLS NOT DISTINCT;



--
-- Name: uq_alerts_foundation_active_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_alerts_foundation_active_entity ON public.alerts USING btree (entity_type, entity_id) WHERE ((type = 'aggregate'::text) AND (status <> 'closed'::text));



--
-- Name: uq_alerts_portal_aberto_por_entidade; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_alerts_portal_aberto_por_entidade ON public.alerts USING btree (type, entity_type, entity_id) WHERE ((status <> 'closed'::text) AND (type = ANY (ARRAY['portal_abuso_login'::text, 'portal_email_suprimido'::text])));



--
-- Name: INDEX uq_alerts_portal_aberto_por_entidade; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.uq_alerts_portal_aberto_por_entidade IS 'Um alerta não fechado por (tipo, entidade) nos tipos abertos por openAlertOnce. O helper consulta antes como caminho rápido; a garantia é esta.';



--
-- Name: uq_charge_calculations_bl_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_charge_calculations_bl_key ON public.charge_calculations USING btree (bl_id, calculation_key);



--
-- Name: uq_charge_table_items_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_charge_table_items_scope ON public.charge_table_items USING btree (charge_table_id, name, category, application_basis, cargo_profile, manual_only, currency);



--
-- Name: uq_charge_tables_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_charge_tables_scope ON public.charge_tables USING btree (cargo_mode, pod, valid_from, name);



--
-- Name: uq_demurrage_dispute_open_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_demurrage_dispute_open_invoice ON public.demurrage_disputes USING btree (demurrage_invoice_id) WHERE (state = 'aberta'::text);



--
-- Name: uq_demurrage_invoices_active_bl; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_demurrage_invoices_active_bl ON public.demurrage_invoices USING btree (bl_id) WHERE (status = ANY (ARRAY['issued'::text, 'paid'::text]));



--
-- Name: uq_depot_services_catalog_entry; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_depot_services_catalog_entry ON public.depot_services USING btree (depot_id, lower(name), COALESCE(container_type, ''::text), COALESCE((route_destino_id)::text, ''::text), COALESCE(condition, ''::text));



--
-- Name: uq_import_batches_voyage_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_import_batches_voyage_hash ON public.import_batches USING btree (voyage_id, cargo_mode, file_hash) WHERE (file_hash IS NOT NULL);



--
-- Name: uq_vazios_bookings_operation_container; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_vazios_bookings_operation_container ON public.vazios_bookings USING btree (operation_id, container_number);



--
-- Name: uq_vazios_bookings_voyage_container; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_vazios_bookings_voyage_container ON public.vazios_bookings USING btree (voyage_id, container_number);



--
-- Name: uq_vazios_storage_line_operation_local_condition; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_vazios_storage_line_operation_local_condition ON public.vazios_export_service_lines USING btree (operation_id, local_id, condition) WHERE (condition IS NOT NULL);



--
-- Name: uq_voyage_escala_operation_front; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_voyage_escala_operation_front ON public.voyage_escala_operation_fronts USING btree (voyage_id, port, sentido, modalidade);



--
-- Name: uq_voyage_escala_terminal_state_tbc; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_voyage_escala_terminal_state_tbc ON public.voyage_escala_terminal_state USING btree (voyage_id, port) WHERE (terminal_id IS NULL);



--
-- Name: INDEX uq_voyage_escala_terminal_state_tbc; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.uq_voyage_escala_terminal_state_tbc IS 'Uma unica Atracacao TBC por escala; UNIQUE comum nao restringe NULL.';



--
-- Name: voyage_export_schedules_voyage_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX voyage_export_schedules_voyage_id_idx ON public.voyage_export_schedules USING btree (voyage_id);



--
-- Name: voyage_omissions_voyage_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX voyage_omissions_voyage_idx ON public.voyage_omissions USING btree (voyage_id);



--
-- Name: voyage_route_ce_master_voyage_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX voyage_route_ce_master_voyage_idx ON public.voyage_route_ce_master USING btree (voyage_id);



--
-- Name: voyages_show_on_portal_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX voyages_show_on_portal_active_idx ON public.voyages USING btree (show_on_portal) WHERE (show_on_portal AND (status = 'active'::text));



--
-- Name: agency_departure_report_department_signoffs agency_departure_report_department_signoffs_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_departure_report_department_signoffs
    ADD CONSTRAINT agency_departure_report_department_signoffs_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.agency_departure_reports(id) ON DELETE CASCADE;



--
-- Name: agency_departure_report_occurrences agency_departure_report_occurrences_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_departure_report_occurrences
    ADD CONSTRAINT agency_departure_report_occurrences_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.agency_departure_reports(id) ON DELETE CASCADE;



--
-- Name: agency_departure_report_signoffs agency_departure_report_signoffs_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_departure_report_signoffs
    ADD CONSTRAINT agency_departure_report_signoffs_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.agency_departure_reports(id) ON DELETE CASCADE;



--
-- Name: agency_departure_reports agency_departure_reports_terminal_port_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_departure_reports
    ADD CONSTRAINT agency_departure_reports_terminal_port_fk FOREIGN KEY (terminal_id, terminal_port_id) REFERENCES public.depots(id, port_id) ON DELETE RESTRICT;



--
-- Name: agency_departure_reports agency_departure_reports_voyage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agency_departure_reports
    ADD CONSTRAINT agency_departure_reports_voyage_id_fkey FOREIGN KEY (voyage_id) REFERENCES public.voyages(id) ON DELETE CASCADE;



--
-- Name: alert_item_dismissals alert_item_dismissals_alert_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_item_dismissals
    ADD CONSTRAINT alert_item_dismissals_alert_item_id_fkey FOREIGN KEY (alert_item_id) REFERENCES public.alert_items(id) ON DELETE CASCADE;



--
-- Name: alert_item_dismissals alert_item_dismissals_dismissed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_item_dismissals
    ADD CONSTRAINT alert_item_dismissals_dismissed_by_fkey FOREIGN KEY (dismissed_by) REFERENCES auth.users(id);



--
-- Name: alert_item_events alert_item_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_item_events
    ADD CONSTRAINT alert_item_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id);



--
-- Name: alert_item_events alert_item_events_alert_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_item_events
    ADD CONSTRAINT alert_item_events_alert_item_id_fkey FOREIGN KEY (alert_item_id) REFERENCES public.alert_items(id) ON DELETE CASCADE;



--
-- Name: alert_items alert_items_alert_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_items
    ADD CONSTRAINT alert_items_alert_id_fkey FOREIGN KEY (alert_id) REFERENCES public.alerts(id) ON DELETE CASCADE;



--
-- Name: alert_items alert_items_item_type_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_items
    ADD CONSTRAINT alert_items_item_type_fkey FOREIGN KEY (item_type) REFERENCES public.alert_type_catalog(type);



--
-- Name: alert_notification_failures alert_notification_failures_alert_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_notification_failures
    ADD CONSTRAINT alert_notification_failures_alert_id_fkey FOREIGN KEY (alert_id) REFERENCES public.alerts(id) ON DELETE SET NULL;



--
-- Name: alert_notification_failures alert_notification_failures_alert_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_notification_failures
    ADD CONSTRAINT alert_notification_failures_alert_item_id_fkey FOREIGN KEY (alert_item_id) REFERENCES public.alert_items(id) ON DELETE SET NULL;



--
-- Name: alert_notification_failures alert_notification_failures_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_notification_failures
    ADD CONSTRAINT alert_notification_failures_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.alert_item_events(id) ON DELETE SET NULL;



--
-- Name: alerts alerts_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id);



--
-- Name: audit_logs audit_logs_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES auth.users(id);



--
-- Name: baplie_containers baplie_containers_imported_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.baplie_containers
    ADD CONSTRAINT baplie_containers_imported_by_fkey FOREIGN KEY (imported_by) REFERENCES auth.users(id);



--
-- Name: baplie_containers baplie_containers_voyage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.baplie_containers
    ADD CONSTRAINT baplie_containers_voyage_id_fkey FOREIGN KEY (voyage_id) REFERENCES public.voyages(id) ON DELETE CASCADE;



--
-- Name: baplie_reconciliation_resolutions baplie_reconciliation_resolutions_bl_container_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.baplie_reconciliation_resolutions
    ADD CONSTRAINT baplie_reconciliation_resolutions_bl_container_id_fkey FOREIGN KEY (bl_container_id) REFERENCES public.bl_containers(id) ON DELETE CASCADE;



--
-- Name: baplie_reconciliation_resolutions baplie_reconciliation_resolutions_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.baplie_reconciliation_resolutions
    ADD CONSTRAINT baplie_reconciliation_resolutions_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES auth.users(id);



--
-- Name: baplie_reconciliation_resolutions baplie_reconciliation_resolutions_voyage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.baplie_reconciliation_resolutions
    ADD CONSTRAINT baplie_reconciliation_resolutions_voyage_id_fkey FOREIGN KEY (voyage_id) REFERENCES public.voyages(id) ON DELETE CASCADE;



--
-- Name: billing_batches billing_batches_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_batches
    ADD CONSTRAINT billing_batches_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;



--
-- Name: billing_batches billing_batches_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_batches
    ADD CONSTRAINT billing_batches_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;



--
-- Name: billing_batches billing_batches_portal_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_batches
    ADD CONSTRAINT billing_batches_portal_account_id_fkey FOREIGN KEY (portal_account_id) REFERENCES public.customer_portal_accounts(id) ON DELETE SET NULL;



--
-- Name: billing_batches billing_batches_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_batches
    ADD CONSTRAINT billing_batches_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE SET NULL;



--
-- Name: billing_run_logs billing_run_logs_billing_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_run_logs
    ADD CONSTRAINT billing_run_logs_billing_run_id_fkey FOREIGN KEY (billing_run_id) REFERENCES public.billing_runs(id) ON DELETE CASCADE;



--
-- Name: billing_run_logs billing_run_logs_bl_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_run_logs
    ADD CONSTRAINT billing_run_logs_bl_id_fkey FOREIGN KEY (bl_id) REFERENCES public.bls(id) ON DELETE CASCADE;



--
-- Name: billing_run_logs billing_run_logs_manifest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_run_logs
    ADD CONSTRAINT billing_run_logs_manifest_id_fkey FOREIGN KEY (manifest_id) REFERENCES public.import_batches(id) ON DELETE CASCADE;



--
-- Name: billing_runs billing_runs_manifest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_runs
    ADD CONSTRAINT billing_runs_manifest_id_fkey FOREIGN KEY (manifest_id) REFERENCES public.import_batches(id) ON DELETE CASCADE;



--
-- Name: billing_runs billing_runs_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_runs
    ADD CONSTRAINT billing_runs_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE SET NULL;



--
-- Name: bl_breakbulk_items bl_breakbulk_items_bl_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bl_breakbulk_items
    ADD CONSTRAINT bl_breakbulk_items_bl_id_fkey FOREIGN KEY (bl_id) REFERENCES public.bls(id) ON DELETE CASCADE;



--
-- Name: bl_containers bl_containers_bl_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bl_containers
    ADD CONSTRAINT bl_containers_bl_id_fkey FOREIGN KEY (bl_id) REFERENCES public.bls(id) ON DELETE CASCADE;



--
-- Name: bl_freight_lines bl_freight_lines_bl_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bl_freight_lines
    ADD CONSTRAINT bl_freight_lines_bl_id_fkey FOREIGN KEY (bl_id) REFERENCES public.bls(id) ON DELETE CASCADE;



--
-- Name: bl_receivables bl_receivables_bl_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bl_receivables
    ADD CONSTRAINT bl_receivables_bl_id_fkey FOREIGN KEY (bl_id) REFERENCES public.bls(id) ON DELETE RESTRICT;



--
-- Name: bl_receivables bl_receivables_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bl_receivables
    ADD CONSTRAINT bl_receivables_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;



--
-- Name: bl_receivables bl_receivables_voyage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bl_receivables
    ADD CONSTRAINT bl_receivables_voyage_id_fkey FOREIGN KEY (voyage_id) REFERENCES public.voyages(id);



--
-- Name: bl_transshipments bl_transshipments_bl_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bl_transshipments
    ADD CONSTRAINT bl_transshipments_bl_id_fkey FOREIGN KEY (bl_id) REFERENCES public.bls(id) ON DELETE CASCADE;



--
-- Name: bl_transshipments bl_transshipments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bl_transshipments
    ADD CONSTRAINT bl_transshipments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);



--
-- Name: bl_transshipments bl_transshipments_omission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bl_transshipments
    ADD CONSTRAINT bl_transshipments_omission_id_fkey FOREIGN KEY (omission_id) REFERENCES public.voyage_omissions(id) ON DELETE CASCADE;



--
-- Name: bls bls_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bls
    ADD CONSTRAINT bls_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.import_batches(id);



--
-- Name: bls bls_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bls
    ADD CONSTRAINT bls_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);



--
-- Name: bls bls_last_billing_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bls
    ADD CONSTRAINT bls_last_billing_run_id_fkey FOREIGN KEY (last_billing_run_id) REFERENCES public.billing_runs(id) ON DELETE SET NULL;



--
-- Name: bls bls_suggested_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bls
    ADD CONSTRAINT bls_suggested_customer_id_fkey FOREIGN KEY (suggested_customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;



--
-- Name: bls bls_voyage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bls
    ADD CONSTRAINT bls_voyage_id_fkey FOREIGN KEY (voyage_id) REFERENCES public.voyages(id);



--
-- Name: charge_calculations charge_calculations_billing_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charge_calculations
    ADD CONSTRAINT charge_calculations_billing_run_id_fkey FOREIGN KEY (billing_run_id) REFERENCES public.billing_runs(id) ON DELETE SET NULL;



--
-- Name: charge_calculations charge_calculations_bl_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charge_calculations
    ADD CONSTRAINT charge_calculations_bl_id_fkey FOREIGN KEY (bl_id) REFERENCES public.bls(id) ON DELETE CASCADE;



--
-- Name: charge_calculations charge_calculations_charge_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charge_calculations
    ADD CONSTRAINT charge_calculations_charge_item_id_fkey FOREIGN KEY (charge_item_id) REFERENCES public.charge_table_items(id);



--
-- Name: charge_calculations charge_calculations_charge_table_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charge_calculations
    ADD CONSTRAINT charge_calculations_charge_table_id_fkey FOREIGN KEY (charge_table_id) REFERENCES public.charge_tables(id);



--
-- Name: charge_calculations charge_calculations_container_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charge_calculations
    ADD CONSTRAINT charge_calculations_container_id_fkey FOREIGN KEY (container_id) REFERENCES public.bl_containers(id);



--
-- Name: charge_calculations charge_calculations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charge_calculations
    ADD CONSTRAINT charge_calculations_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);



--
-- Name: charge_calculations charge_calculations_manifest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charge_calculations
    ADD CONSTRAINT charge_calculations_manifest_id_fkey FOREIGN KEY (manifest_id) REFERENCES public.import_batches(id) ON DELETE SET NULL;



--
-- Name: charge_calculations charge_calculations_pricing_rule_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charge_calculations
    ADD CONSTRAINT charge_calculations_pricing_rule_version_id_fkey FOREIGN KEY (pricing_rule_version_id) REFERENCES public.pricing_rule_versions(id) ON DELETE SET NULL;



--
-- Name: charge_calculations charge_calculations_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charge_calculations
    ADD CONSTRAINT charge_calculations_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id);



--
-- Name: charge_table_items charge_table_items_charge_table_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charge_table_items
    ADD CONSTRAINT charge_table_items_charge_table_id_fkey FOREIGN KEY (charge_table_id) REFERENCES public.charge_tables(id);



--
-- Name: charge_tables charge_tables_carrier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charge_tables
    ADD CONSTRAINT charge_tables_carrier_id_fkey FOREIGN KEY (carrier_id) REFERENCES public.carriers(id);



--
-- Name: cod_adjustments cod_adjustments_bl_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cod_adjustments
    ADD CONSTRAINT cod_adjustments_bl_id_fkey FOREIGN KEY (bl_id) REFERENCES public.bls(id) ON DELETE RESTRICT;



--
-- Name: cod_adjustments cod_adjustments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cod_adjustments
    ADD CONSTRAINT cod_adjustments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;



--
-- Name: cod_adjustments cod_adjustments_omission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cod_adjustments
    ADD CONSTRAINT cod_adjustments_omission_id_fkey FOREIGN KEY (omission_id) REFERENCES public.voyage_omissions(id) ON DELETE RESTRICT;



--
-- Name: customer_communication_attachments customer_communication_attachments_communication_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_communication_attachments
    ADD CONSTRAINT customer_communication_attachments_communication_id_fkey FOREIGN KEY (communication_id) REFERENCES public.customer_communications(id) ON DELETE CASCADE;



--
-- Name: customer_communication_attachments customer_communication_attachments_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_communication_attachments
    ADD CONSTRAINT customer_communication_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;



--
-- Name: customer_communication_attempts customer_communication_attempts_communication_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_communication_attempts
    ADD CONSTRAINT customer_communication_attempts_communication_id_fkey FOREIGN KEY (communication_id) REFERENCES public.customer_communications(id) ON DELETE CASCADE;



--
-- Name: customer_communication_bls customer_communication_bls_bl_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_communication_bls
    ADD CONSTRAINT customer_communication_bls_bl_id_fkey FOREIGN KEY (bl_id) REFERENCES public.bls(id) ON DELETE RESTRICT;



--
-- Name: customer_communication_bls customer_communication_bls_communication_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_communication_bls
    ADD CONSTRAINT customer_communication_bls_communication_id_fkey FOREIGN KEY (communication_id) REFERENCES public.customer_communications(id) ON DELETE CASCADE;



--
-- Name: customer_communication_saved_templates customer_communication_saved_templates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_communication_saved_templates
    ADD CONSTRAINT customer_communication_saved_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;



--
-- Name: customer_communications customer_communications_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_communications
    ADD CONSTRAINT customer_communications_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;



--
-- Name: customer_communications customer_communications_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_communications
    ADD CONSTRAINT customer_communications_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;



--
-- Name: customer_communications customer_communications_kind_nature_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_communications
    ADD CONSTRAINT customer_communications_kind_nature_fkey FOREIGN KEY (kind, nature) REFERENCES public.customer_communication_kinds(kind, nature) ON DELETE RESTRICT;



--
-- Name: customer_contact_preferences customer_contact_preferences_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_contact_preferences
    ADD CONSTRAINT customer_contact_preferences_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.customer_contacts(id) ON DELETE CASCADE;



--
-- Name: customer_contacts customer_contacts_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_contacts
    ADD CONSTRAINT customer_contacts_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);



--
-- Name: customer_demurrage_agreements customer_demurrage_agreements_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_demurrage_agreements
    ADD CONSTRAINT customer_demurrage_agreements_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;



--
-- Name: customer_portal_accounts customer_portal_accounts_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_portal_accounts
    ADD CONSTRAINT customer_portal_accounts_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;



--
-- Name: customer_portal_accounts customer_portal_accounts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_portal_accounts
    ADD CONSTRAINT customer_portal_accounts_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;



--
-- Name: customer_portal_accounts customer_portal_accounts_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_portal_accounts
    ADD CONSTRAINT customer_portal_accounts_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;



--
-- Name: customer_portal_sessions customer_portal_sessions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_portal_sessions
    ADD CONSTRAINT customer_portal_sessions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.customer_portal_accounts(id) ON DELETE CASCADE;



--
-- Name: customer_portal_sessions customer_portal_sessions_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_portal_sessions
    ADD CONSTRAINT customer_portal_sessions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;



--
-- Name: customer_rate_overrides customer_rate_overrides_charge_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_rate_overrides
    ADD CONSTRAINT customer_rate_overrides_charge_item_id_fkey FOREIGN KEY (charge_item_id) REFERENCES public.charge_table_items(id);



--
-- Name: customer_rate_overrides customer_rate_overrides_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_rate_overrides
    ADD CONSTRAINT customer_rate_overrides_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);



--
-- Name: customer_reconciliation_queue customer_reconciliation_queue_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_reconciliation_queue
    ADD CONSTRAINT customer_reconciliation_queue_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL;



--
-- Name: customer_reconciliation_queue customer_reconciliation_queue_bl_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_reconciliation_queue
    ADD CONSTRAINT customer_reconciliation_queue_bl_id_fkey FOREIGN KEY (bl_id) REFERENCES public.bls(id) ON DELETE CASCADE;



--
-- Name: customer_reconciliation_queue customer_reconciliation_queue_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_reconciliation_queue
    ADD CONSTRAINT customer_reconciliation_queue_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;



--
-- Name: customer_reconciliation_queue customer_reconciliation_queue_manifest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_reconciliation_queue
    ADD CONSTRAINT customer_reconciliation_queue_manifest_id_fkey FOREIGN KEY (manifest_id) REFERENCES public.import_batches(id) ON DELETE CASCADE;



--
-- Name: customer_reconciliation_queue customer_reconciliation_queue_rejected_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_reconciliation_queue
    ADD CONSTRAINT customer_reconciliation_queue_rejected_by_fkey FOREIGN KEY (rejected_by) REFERENCES auth.users(id) ON DELETE SET NULL;



--
-- Name: demurrage_dispute_attachments demurrage_dispute_attachments_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_dispute_attachments
    ADD CONSTRAINT demurrage_dispute_attachments_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;



--
-- Name: demurrage_dispute_attachments demurrage_dispute_attachments_dispute_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_dispute_attachments
    ADD CONSTRAINT demurrage_dispute_attachments_dispute_id_fkey FOREIGN KEY (dispute_id) REFERENCES public.demurrage_disputes(id) ON DELETE RESTRICT;



--
-- Name: demurrage_dispute_attachments demurrage_dispute_attachments_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_dispute_attachments
    ADD CONSTRAINT demurrage_dispute_attachments_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.demurrage_dispute_messages(id) ON DELETE RESTRICT;



--
-- Name: demurrage_dispute_attachments demurrage_dispute_attachments_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_dispute_attachments
    ADD CONSTRAINT demurrage_dispute_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;



--
-- Name: demurrage_dispute_messages demurrage_dispute_messages_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_dispute_messages
    ADD CONSTRAINT demurrage_dispute_messages_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE SET NULL;



--
-- Name: demurrage_dispute_messages demurrage_dispute_messages_dispute_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_dispute_messages
    ADD CONSTRAINT demurrage_dispute_messages_dispute_id_fkey FOREIGN KEY (dispute_id) REFERENCES public.demurrage_disputes(id) ON DELETE RESTRICT;



--
-- Name: demurrage_disputes demurrage_disputes_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_disputes
    ADD CONSTRAINT demurrage_disputes_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;



--
-- Name: demurrage_disputes demurrage_disputes_demurrage_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_disputes
    ADD CONSTRAINT demurrage_disputes_demurrage_invoice_id_fkey FOREIGN KEY (demurrage_invoice_id) REFERENCES public.demurrage_invoices(id) ON DELETE RESTRICT;



--
-- Name: demurrage_dunning_claims demurrage_dunning_claims_demurrage_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_dunning_claims
    ADD CONSTRAINT demurrage_dunning_claims_demurrage_invoice_id_fkey FOREIGN KEY (demurrage_invoice_id) REFERENCES public.demurrage_invoices(id) ON DELETE CASCADE;



--
-- Name: demurrage_invoice_history demurrage_invoice_history_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_invoice_history
    ADD CONSTRAINT demurrage_invoice_history_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.demurrage_invoices(id) ON DELETE CASCADE;



--
-- Name: demurrage_invoice_items demurrage_invoice_items_container_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_invoice_items
    ADD CONSTRAINT demurrage_invoice_items_container_id_fkey FOREIGN KEY (container_id) REFERENCES public.bl_containers(id);



--
-- Name: demurrage_invoice_items demurrage_invoice_items_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_invoice_items
    ADD CONSTRAINT demurrage_invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.demurrage_invoices(id) ON DELETE CASCADE;



--
-- Name: demurrage_invoices demurrage_invoices_bl_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_invoices
    ADD CONSTRAINT demurrage_invoices_bl_id_fkey FOREIGN KEY (bl_id) REFERENCES public.bls(id);



--
-- Name: demurrage_invoices demurrage_invoices_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demurrage_invoices
    ADD CONSTRAINT demurrage_invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);



--
-- Name: depot_services depot_services_depot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.depot_services
    ADD CONSTRAINT depot_services_depot_id_fkey FOREIGN KEY (depot_id) REFERENCES public.depots(id) ON DELETE CASCADE;



--
-- Name: depot_services depot_services_route_destino_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.depot_services
    ADD CONSTRAINT depot_services_route_destino_id_fkey FOREIGN KEY (route_destino_id) REFERENCES public.depots(id) ON DELETE RESTRICT;



--
-- Name: depots depots_port_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.depots
    ADD CONSTRAINT depots_port_id_fkey FOREIGN KEY (port_id) REFERENCES public.ports(id) ON DELETE RESTRICT;



--
-- Name: granite_bl_charges granite_bl_charges_bl_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.granite_bl_charges
    ADD CONSTRAINT granite_bl_charges_bl_id_fkey FOREIGN KEY (bl_id) REFERENCES public.granite_bls(id) ON DELETE CASCADE;



--
-- Name: granite_bl_charges granite_bl_charges_rate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.granite_bl_charges
    ADD CONSTRAINT granite_bl_charges_rate_id_fkey FOREIGN KEY (rate_id) REFERENCES public.granite_rates(id) ON DELETE SET NULL;



--
-- Name: granite_bls granite_bls_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.granite_bls
    ADD CONSTRAINT granite_bls_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.customers(id) ON DELETE SET NULL;



--
-- Name: granite_bls granite_bls_manifest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.granite_bls
    ADD CONSTRAINT granite_bls_manifest_id_fkey FOREIGN KEY (manifest_id) REFERENCES public.granite_manifests(id) ON DELETE CASCADE;



--
-- Name: granite_bls granite_bls_suggested_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.granite_bls
    ADD CONSTRAINT granite_bls_suggested_client_id_fkey FOREIGN KEY (suggested_client_id) REFERENCES public.customers(id) ON DELETE SET NULL;



--
-- Name: granite_manifests granite_manifests_imported_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.granite_manifests
    ADD CONSTRAINT granite_manifests_imported_by_fkey FOREIGN KEY (imported_by) REFERENCES auth.users(id) ON DELETE SET NULL;



--
-- Name: granite_manifests granite_manifests_voyage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.granite_manifests
    ADD CONSTRAINT granite_manifests_voyage_id_fkey FOREIGN KEY (voyage_id) REFERENCES public.voyages(id) ON DELETE SET NULL;



--
-- Name: import_batches import_batches_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_batches
    ADD CONSTRAINT import_batches_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id);



--
-- Name: import_batches import_batches_voyage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_batches
    ADD CONSTRAINT import_batches_voyage_id_fkey FOREIGN KEY (voyage_id) REFERENCES public.voyages(id);



--
-- Name: import_errors import_errors_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_errors
    ADD CONSTRAINT import_errors_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.import_batches(id);



--
-- Name: internal_notifications internal_notifications_alert_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.internal_notifications
    ADD CONSTRAINT internal_notifications_alert_id_fkey FOREIGN KEY (alert_id) REFERENCES public.alerts(id) ON DELETE CASCADE;



--
-- Name: internal_notifications internal_notifications_alert_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.internal_notifications
    ADD CONSTRAINT internal_notifications_alert_item_id_fkey FOREIGN KEY (alert_item_id) REFERENCES public.alert_items(id) ON DELETE CASCADE;



--
-- Name: internal_notifications internal_notifications_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.internal_notifications
    ADD CONSTRAINT internal_notifications_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.alert_item_events(id) ON DELETE CASCADE;



--
-- Name: internal_notifications internal_notifications_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.internal_notifications
    ADD CONSTRAINT internal_notifications_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES auth.users(id) ON DELETE CASCADE;



--
-- Name: invoice_bls invoice_bls_bl_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_bls
    ADD CONSTRAINT invoice_bls_bl_id_fkey FOREIGN KEY (bl_id) REFERENCES public.bls(id) ON DELETE RESTRICT;



--
-- Name: invoice_bls invoice_bls_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_bls
    ADD CONSTRAINT invoice_bls_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;



--
-- Name: invoice_granite_bls invoice_granite_bls_granite_bl_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_granite_bls
    ADD CONSTRAINT invoice_granite_bls_granite_bl_id_fkey FOREIGN KEY (granite_bl_id) REFERENCES public.granite_bls(id) ON DELETE RESTRICT;



--
-- Name: invoice_granite_bls invoice_granite_bls_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_granite_bls
    ADD CONSTRAINT invoice_granite_bls_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;



--
-- Name: invoice_items invoice_items_billing_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_billing_run_id_fkey FOREIGN KEY (billing_run_id) REFERENCES public.billing_runs(id) ON DELETE SET NULL;



--
-- Name: invoice_items invoice_items_charge_calculation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_charge_calculation_id_fkey FOREIGN KEY (charge_calculation_id) REFERENCES public.charge_calculations(id);



--
-- Name: invoice_items invoice_items_charge_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_charge_item_id_fkey FOREIGN KEY (charge_item_id) REFERENCES public.charge_table_items(id) ON DELETE SET NULL;



--
-- Name: invoice_items invoice_items_charge_table_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_charge_table_id_fkey FOREIGN KEY (charge_table_id) REFERENCES public.charge_tables(id) ON DELETE SET NULL;



--
-- Name: invoice_items invoice_items_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;



--
-- Name: invoice_items invoice_items_manifest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_manifest_id_fkey FOREIGN KEY (manifest_id) REFERENCES public.import_batches(id) ON DELETE SET NULL;



--
-- Name: invoice_items invoice_items_pricing_rule_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_pricing_rule_version_id_fkey FOREIGN KEY (pricing_rule_version_id) REFERENCES public.pricing_rule_versions(id) ON DELETE SET NULL;



--
-- Name: invoice_lifecycle_events invoice_lifecycle_events_actor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_lifecycle_events
    ADD CONSTRAINT invoice_lifecycle_events_actor_fkey FOREIGN KEY (actor) REFERENCES auth.users(id);



--
-- Name: invoice_lifecycle_events invoice_lifecycle_events_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_lifecycle_events
    ADD CONSTRAINT invoice_lifecycle_events_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;



--
-- Name: invoice_lifecycle_events invoice_lifecycle_events_receivable_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_lifecycle_events
    ADD CONSTRAINT invoice_lifecycle_events_receivable_id_fkey FOREIGN KEY (receivable_id) REFERENCES public.bl_receivables(id);



--
-- Name: invoice_lifecycle_events invoice_lifecycle_events_related_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_lifecycle_events
    ADD CONSTRAINT invoice_lifecycle_events_related_invoice_id_fkey FOREIGN KEY (related_invoice_id) REFERENCES public.invoices(id);



--
-- Name: invoice_receivable_links invoice_receivable_links_bl_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_receivable_links
    ADD CONSTRAINT invoice_receivable_links_bl_id_fkey FOREIGN KEY (bl_id) REFERENCES public.bls(id) ON DELETE RESTRICT;



--
-- Name: invoice_receivable_links invoice_receivable_links_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_receivable_links
    ADD CONSTRAINT invoice_receivable_links_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;



--
-- Name: invoice_receivable_links invoice_receivable_links_receivable_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_receivable_links
    ADD CONSTRAINT invoice_receivable_links_receivable_id_fkey FOREIGN KEY (receivable_id) REFERENCES public.bl_receivables(id) ON DELETE RESTRICT;



--
-- Name: invoice_refunds invoice_refunds_cod_adjustment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_refunds
    ADD CONSTRAINT invoice_refunds_cod_adjustment_id_fkey FOREIGN KEY (cod_adjustment_id) REFERENCES public.cod_adjustments(id) ON DELETE RESTRICT;



--
-- Name: invoice_refunds invoice_refunds_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_refunds
    ADD CONSTRAINT invoice_refunds_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;



--
-- Name: invoice_refunds invoice_refunds_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_refunds
    ADD CONSTRAINT invoice_refunds_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE CASCADE;



--
-- Name: invoice_refunds invoice_refunds_registered_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_refunds
    ADD CONSTRAINT invoice_refunds_registered_by_fkey FOREIGN KEY (registered_by) REFERENCES auth.users(id);



--
-- Name: invoices invoices_bl_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_bl_id_fkey FOREIGN KEY (bl_id) REFERENCES public.bls(id);



--
-- Name: invoices invoices_cancelled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES auth.users(id);



--
-- Name: invoices invoices_covered_by_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_covered_by_invoice_id_fkey FOREIGN KEY (covered_by_invoice_id) REFERENCES public.invoices(id);



--
-- Name: invoices invoices_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);



--
-- Name: invoices invoices_issued_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES auth.users(id);



--
-- Name: invoices invoices_replaced_by_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_replaced_by_invoice_id_fkey FOREIGN KEY (replaced_by_invoice_id) REFERENCES public.invoices(id);



--
-- Name: ledger_settlements ledger_settlements_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_settlements
    ADD CONSTRAINT ledger_settlements_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;



--
-- Name: ledger_settlements ledger_settlements_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_settlements
    ADD CONSTRAINT ledger_settlements_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE SET NULL;



--
-- Name: ledger_settlements ledger_settlements_receivable_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_settlements
    ADD CONSTRAINT ledger_settlements_receivable_id_fkey FOREIGN KEY (receivable_id) REFERENCES public.bl_receivables(id) ON DELETE RESTRICT;



--
-- Name: payments payments_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id);



--
-- Name: payments payments_registered_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_registered_by_fkey FOREIGN KEY (registered_by) REFERENCES auth.users(id);



--
-- Name: pix_reconciliation_exceptions pix_reconciliation_exceptions_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pix_reconciliation_exceptions
    ADD CONSTRAINT pix_reconciliation_exceptions_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE SET NULL;



--
-- Name: portal_email_attempts portal_email_attempts_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_email_attempts
    ADD CONSTRAINT portal_email_attempts_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.customer_portal_accounts(id) ON DELETE SET NULL;



--
-- Name: portal_email_attempts portal_email_attempts_invite_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_email_attempts
    ADD CONSTRAINT portal_email_attempts_invite_id_fkey FOREIGN KEY (invite_id) REFERENCES public.portal_invites(id) ON DELETE SET NULL;



--
-- Name: portal_email_events portal_email_events_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_email_events
    ADD CONSTRAINT portal_email_events_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES public.portal_email_attempts(id) ON DELETE SET NULL;



--
-- Name: portal_inspection_events portal_inspection_events_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_inspection_events
    ADD CONSTRAINT portal_inspection_events_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);



--
-- Name: portal_inspection_events portal_inspection_events_inspector_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_inspection_events
    ADD CONSTRAINT portal_inspection_events_inspector_id_fkey FOREIGN KEY (inspector_id) REFERENCES auth.users(id);



--
-- Name: portal_invites portal_invites_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_invites
    ADD CONSTRAINT portal_invites_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.customer_portal_accounts(id) ON DELETE CASCADE;



--
-- Name: portal_invites portal_invites_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_invites
    ADD CONSTRAINT portal_invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;



--
-- Name: portal_notifications portal_notifications_bl_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_notifications
    ADD CONSTRAINT portal_notifications_bl_id_fkey FOREIGN KEY (bl_id) REFERENCES public.bls(id) ON DELETE SET NULL;



--
-- Name: portal_notifications portal_notifications_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_notifications
    ADD CONSTRAINT portal_notifications_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;



--
-- Name: portal_provisioning_events portal_provisioning_events_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_provisioning_events
    ADD CONSTRAINT portal_provisioning_events_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.customer_portal_accounts(id) ON DELETE SET NULL;



--
-- Name: portal_provisioning_events portal_provisioning_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_provisioning_events
    ADD CONSTRAINT portal_provisioning_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;



--
-- Name: portal_provisioning_events portal_provisioning_events_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_provisioning_events
    ADD CONSTRAINT portal_provisioning_events_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;



--
-- Name: portal_provisioning_events portal_provisioning_events_invite_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_provisioning_events
    ADD CONSTRAINT portal_provisioning_events_invite_id_fkey FOREIGN KEY (invite_id) REFERENCES public.portal_invites(id) ON DELETE SET NULL;



--
-- Name: portal_rate_limits portal_rate_limits_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_rate_limits
    ADD CONSTRAINT portal_rate_limits_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;



--
-- Name: pricing_rule_versions pricing_rule_versions_charge_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_rule_versions
    ADD CONSTRAINT pricing_rule_versions_charge_item_id_fkey FOREIGN KEY (charge_item_id) REFERENCES public.charge_table_items(id) ON DELETE SET NULL;



--
-- Name: pricing_rule_versions pricing_rule_versions_charge_table_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_rule_versions
    ADD CONSTRAINT pricing_rule_versions_charge_table_id_fkey FOREIGN KEY (charge_table_id) REFERENCES public.charge_tables(id) ON DELETE SET NULL;



--
-- Name: pricing_rule_versions pricing_rule_versions_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_rule_versions
    ADD CONSTRAINT pricing_rule_versions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;



--
-- Name: pricing_rule_versions pricing_rule_versions_customer_rate_override_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_rule_versions
    ADD CONSTRAINT pricing_rule_versions_customer_rate_override_id_fkey FOREIGN KEY (customer_rate_override_id) REFERENCES public.customer_rate_overrides(id) ON DELETE SET NULL;



--
-- Name: user_profiles user_profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;



--
-- Name: vazios_bookings vazios_bookings_local_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vazios_bookings
    ADD CONSTRAINT vazios_bookings_local_id_fkey FOREIGN KEY (local_id) REFERENCES public.depots(id) ON DELETE RESTRICT;



--
-- Name: vazios_bookings vazios_bookings_manifest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vazios_bookings
    ADD CONSTRAINT vazios_bookings_manifest_id_fkey FOREIGN KEY (manifest_id) REFERENCES public.vazios_manifests(id) ON DELETE CASCADE;



--
-- Name: vazios_bookings vazios_bookings_operation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vazios_bookings
    ADD CONSTRAINT vazios_bookings_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES public.vazios_export_operations(id) ON DELETE CASCADE;



--
-- Name: vazios_bookings vazios_bookings_voyage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vazios_bookings
    ADD CONSTRAINT vazios_bookings_voyage_id_fkey FOREIGN KEY (voyage_id) REFERENCES public.voyages(id) ON DELETE CASCADE;



--
-- Name: vazios_export_operations vazios_export_operations_voyage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vazios_export_operations
    ADD CONSTRAINT vazios_export_operations_voyage_id_fkey FOREIGN KEY (voyage_id) REFERENCES public.voyages(id) ON DELETE CASCADE;



--
-- Name: vazios_export_service_lines vazios_export_service_lines_destino_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vazios_export_service_lines
    ADD CONSTRAINT vazios_export_service_lines_destino_id_fkey FOREIGN KEY (destino_id) REFERENCES public.depots(id) ON DELETE RESTRICT;



--
-- Name: vazios_export_service_lines vazios_export_service_lines_local_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vazios_export_service_lines
    ADD CONSTRAINT vazios_export_service_lines_local_id_fkey FOREIGN KEY (local_id) REFERENCES public.depots(id) ON DELETE RESTRICT;



--
-- Name: vazios_export_service_lines vazios_export_service_lines_operation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vazios_export_service_lines
    ADD CONSTRAINT vazios_export_service_lines_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES public.vazios_export_operations(id) ON DELETE CASCADE;



--
-- Name: vazios_export_service_lines vazios_export_service_lines_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vazios_export_service_lines
    ADD CONSTRAINT vazios_export_service_lines_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.depot_services(id) ON DELETE RESTRICT;



--
-- Name: vazios_importacao_containers vazios_importacao_containers_manifest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vazios_importacao_containers
    ADD CONSTRAINT vazios_importacao_containers_manifest_id_fkey FOREIGN KEY (manifest_id) REFERENCES public.vazios_importacao_manifests(id) ON DELETE CASCADE;



--
-- Name: vazios_importacao_manifests vazios_importacao_manifests_imported_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vazios_importacao_manifests
    ADD CONSTRAINT vazios_importacao_manifests_imported_by_fkey FOREIGN KEY (imported_by) REFERENCES auth.users(id) ON DELETE SET NULL;



--
-- Name: vazios_importacao_manifests vazios_importacao_manifests_voyage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vazios_importacao_manifests
    ADD CONSTRAINT vazios_importacao_manifests_voyage_id_fkey FOREIGN KEY (voyage_id) REFERENCES public.voyages(id) ON DELETE SET NULL;



--
-- Name: vazios_manifests vazios_manifests_imported_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vazios_manifests
    ADD CONSTRAINT vazios_manifests_imported_by_fkey FOREIGN KEY (imported_by) REFERENCES auth.users(id) ON DELETE SET NULL;



--
-- Name: vazios_manifests vazios_manifests_voyage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vazios_manifests
    ADD CONSTRAINT vazios_manifests_voyage_id_fkey FOREIGN KEY (voyage_id) REFERENCES public.voyages(id) ON DELETE SET NULL;



--
-- Name: vehicles vehicles_bl_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_bl_id_fkey FOREIGN KEY (bl_id) REFERENCES public.bls(id) ON DELETE CASCADE;



--
-- Name: vehicles vehicles_container_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_container_id_fkey FOREIGN KEY (container_id) REFERENCES public.bl_containers(id) ON DELETE RESTRICT;



--
-- Name: vehicles vehicles_voyage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_voyage_id_fkey FOREIGN KEY (voyage_id) REFERENCES public.voyages(id) ON DELETE CASCADE;



--
-- Name: vessels vessels_carrier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vessels
    ADD CONSTRAINT vessels_carrier_id_fkey FOREIGN KEY (carrier_id) REFERENCES public.carriers(id);



--
-- Name: voyage_escala_operation_fronts voyage_escala_operation_fronts_last_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voyage_escala_operation_fronts
    ADD CONSTRAINT voyage_escala_operation_fronts_last_changed_by_fkey FOREIGN KEY (last_changed_by) REFERENCES auth.users(id) ON DELETE SET NULL;



--
-- Name: voyage_escala_operation_fronts voyage_escala_operation_fronts_port_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voyage_escala_operation_fronts
    ADD CONSTRAINT voyage_escala_operation_fronts_port_id_fkey FOREIGN KEY (port_id) REFERENCES public.ports(id) ON DELETE RESTRICT;



--
-- Name: voyage_escala_operation_fronts voyage_escala_operation_fronts_terminal_id_port_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voyage_escala_operation_fronts
    ADD CONSTRAINT voyage_escala_operation_fronts_terminal_id_port_id_fkey FOREIGN KEY (terminal_id, port_id) REFERENCES public.depots(id, port_id) ON DELETE RESTRICT;



--
-- Name: voyage_escala_operation_fronts voyage_escala_operation_fronts_voyage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voyage_escala_operation_fronts
    ADD CONSTRAINT voyage_escala_operation_fronts_voyage_id_fkey FOREIGN KEY (voyage_id) REFERENCES public.voyages(id) ON DELETE CASCADE;



--
-- Name: voyage_escala_revision_state voyage_escala_revision_state_port_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voyage_escala_revision_state
    ADD CONSTRAINT voyage_escala_revision_state_port_id_fkey FOREIGN KEY (port_id) REFERENCES public.ports(id) ON DELETE RESTRICT;



--
-- Name: voyage_escala_revision_state voyage_escala_revision_state_voyage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voyage_escala_revision_state
    ADD CONSTRAINT voyage_escala_revision_state_voyage_id_fkey FOREIGN KEY (voyage_id) REFERENCES public.voyages(id) ON DELETE CASCADE;



--
-- Name: voyage_escala_terminal_state voyage_escala_terminal_state_port_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voyage_escala_terminal_state
    ADD CONSTRAINT voyage_escala_terminal_state_port_id_fkey FOREIGN KEY (port_id) REFERENCES public.ports(id) ON DELETE RESTRICT;



--
-- Name: voyage_escala_terminal_state voyage_escala_terminal_state_terminal_id_port_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voyage_escala_terminal_state
    ADD CONSTRAINT voyage_escala_terminal_state_terminal_id_port_id_fkey FOREIGN KEY (terminal_id, port_id) REFERENCES public.depots(id, port_id) ON DELETE RESTRICT;



--
-- Name: voyage_escala_terminal_state voyage_escala_terminal_state_voyage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voyage_escala_terminal_state
    ADD CONSTRAINT voyage_escala_terminal_state_voyage_id_fkey FOREIGN KEY (voyage_id) REFERENCES public.voyages(id) ON DELETE CASCADE;



--
-- Name: voyage_export_schedules voyage_export_schedules_voyage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voyage_export_schedules
    ADD CONSTRAINT voyage_export_schedules_voyage_id_fkey FOREIGN KEY (voyage_id) REFERENCES public.voyages(id) ON DELETE CASCADE;



--
-- Name: voyage_omissions voyage_omissions_omitted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voyage_omissions
    ADD CONSTRAINT voyage_omissions_omitted_by_fkey FOREIGN KEY (omitted_by) REFERENCES auth.users(id);



--
-- Name: voyage_omissions voyage_omissions_reverted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voyage_omissions
    ADD CONSTRAINT voyage_omissions_reverted_by_fkey FOREIGN KEY (reverted_by) REFERENCES auth.users(id) ON DELETE SET NULL;



--
-- Name: voyage_omissions voyage_omissions_voyage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voyage_omissions
    ADD CONSTRAINT voyage_omissions_voyage_id_fkey FOREIGN KEY (voyage_id) REFERENCES public.voyages(id) ON DELETE CASCADE;



--
-- Name: voyage_route_ce_master voyage_route_ce_master_voyage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voyage_route_ce_master
    ADD CONSTRAINT voyage_route_ce_master_voyage_id_fkey FOREIGN KEY (voyage_id) REFERENCES public.voyages(id) ON DELETE CASCADE;



--
-- Name: voyages voyages_pod_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voyages
    ADD CONSTRAINT voyages_pod_id_fkey FOREIGN KEY (pod_id) REFERENCES public.ports(id);



--
-- Name: voyages voyages_pol_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voyages
    ADD CONSTRAINT voyages_pol_id_fkey FOREIGN KEY (pol_id) REFERENCES public.ports(id);



--
-- Name: voyages voyages_vessel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voyages
    ADD CONSTRAINT voyages_vessel_id_fkey FOREIGN KEY (vessel_id) REFERENCES public.vessels(id);




--
-- Seed canônico de Portos Brasileiros (ADR 0016 / Migration 307)
--
WITH seed(name, locode) AS (
  VALUES
    ('Vitória', 'BRVIX'),
    ('Salvador', 'BRSSA'),
    ('Pecém', 'BRPEC'),
    ('Suape', 'BRSUA'),
    ('Santos', 'BRSSZ'),
    ('Itaguaí', 'BRIGI'),
    ('Navegantes', 'BRNVT'),
    ('Paranaguá', 'BRPNG'),
    ('Rio Grande', 'BRRIG'),
    ('Rio de Janeiro', 'BRRIO'),
    ('Itajaí', 'BRITJ'),
    ('Maceió', 'BRMCZ'),
    ('Fortaleza', 'BRFOR'),
    ('Belém', 'BRBEL'),
    ('Recife', 'BRREC'),
    ('Natal', 'BRNAT'),
    ('São Luís', 'BRSLZ'),
    ('Manaus', 'BRMAO'),
    ('São Francisco do Sul', 'BRSFS'),
    ('Ilhéus', 'BRIOS')
)
INSERT INTO public.ports (name, locode, country)
SELECT seed.name, seed.locode, 'Brasil'
FROM seed
WHERE NOT EXISTS (
  SELECT 1
  FROM public.ports AS existing
  WHERE upper(btrim(existing.locode)) = seed.locode
);
