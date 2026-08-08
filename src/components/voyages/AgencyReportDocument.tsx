import { formatBRL, formatDate } from "../../lib/utils";
import {
  InvoiceDocFooter,
  InvoiceDocHeader,
  InvoiceDocTitle,
} from "../shared/InvoiceDocumentKit";
import {
  AGENCY_REPORT_DEPARTMENT_LABELS,
  agencyReportSectionLabel,
  MATRIX_CATEGORY_LABELS,
  signoffLabels,
  type AgencyReportSection,
  type SignoffState,
} from "../../services/agencyDepartureReport";
import type { AgencyReportDepartmentKey } from "../../types/database";

type Matrix = {
  rows?: Record<string, Record<string, number>>;
  totals?: Record<string, number>;
};
type Snapshot = {
  header?: {
    carrierName?: string;
    voyageLabel?: string;
    port?: string | null;
    terminal?: string | null;
    schedule?: {
      ata?: string | null;
      atb?: string | null;
      atd?: string | null;
      rtw?: number | null;
    } | null;
    /**
     * Marcos do Prazo de Conclusão do ADR (ADR 0039), congelados no
     * fechamento — dados de uso interno (relatório de SLA, Task 5), nunca
     * impressos. Ausentes em snapshot anterior à Task 4: o impresso não os lê
     * para renderizar nada, então a ausência não quebra o documento.
     */
    unifiedAtd?: string | null;
    atdRegisteredAt?: string | null;
    atdSource?: "pod" | "pol" | null;
    deadlineDate?: string | null;
  };
  sections?: Record<string, unknown>;
  /** Resoluções de seção do ADR fechado; a Observação de cada seção vive aqui. */
  signoffs?: unknown;
  /** Assinaturas departamentais (Task 5); ausente em snapshot legado — impresso sem quebrar. */
  departmentSignoffs?: unknown;
  occurrences?: Array<{
    id?: string;
    body?: string;
    department?: string;
    created_at?: string;
  }>;
};

type Metric = [string, string | number | null | undefined];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asMatrix(value: unknown): Matrix {
  const record = asRecord(value);
  return {
    rows: asRecord(record.rows) as Record<string, Record<string, number>>,
    totals: asRecord(record.totals) as Record<string, number>,
  };
}

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function count(value: unknown) {
  return number(value).toLocaleString("pt-BR");
}

// Task 8 do ADR 2026-07-31: o total da linha vem pronto de totalLinha
// (agencyDepartureReport.ts), a mesma função que compõe "Total da operação" —
// acaba a divergência de linhas legadas de armazenagem com percentual não
// nulo. Snapshots fechados ANTES desta task não carregam o campo `total`;
// para esses, cai de volta na fórmula antiga (registro histórico, sem
// recálculo em cima de dados já congelados).
function serviceLineTotal(service: Record<string, unknown>) {
  if (service.total !== undefined && service.total !== null) return number(service.total);
  return (
    number(service.quantidade) *
    number(service.valor_unitario) *
    (service.percentual == null ? 1 : number(service.percentual) / 100)
  );
}

function ton(value: unknown) {
  return `${count(value)} ton`;
}

function Empty() {
  return <p>—</p>;
}

function MetricsTable({
  label,
  metrics,
}: {
  label: string;
  metrics: Metric[];
}) {
  return (
    <table className="agency-report-document__table" aria-label={label}>
      <tbody>
        {metrics.map(([name, value]) => (
          <tr key={name}>
            <th scope="row">{name}</th>
            <td>
              {value === null || value === undefined || value === ""
                ? "—"
                : value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type MatrixCombo = { type: string; category: string; quantity: number };

// "Listagem do operado": uma linha por combinação (tipo, categoria) que de
// fato ocorreu, com o total no topo — substitui a antiga MatrixTable (grade
// com célula zerada para toda combinação possível, coluna Total por linha e
// rodapé de totais). Task 5 do ADR 2026-07-31, espelhando OperatedListing da
// aba (VoyageAgencyReportTab.tsx).
function matrixCombos(matrix: Matrix): MatrixCombo[] {
  const rows = matrix.rows ?? {};
  return Object.entries(rows)
    .flatMap(([type, categories]) =>
      Object.entries(categories).map(([category, quantity]) => ({
        type,
        category,
        quantity: number(quantity),
      })),
    )
    .sort(
      (a, b) => a.type.localeCompare(b.type) || a.category.localeCompare(b.category),
    );
}

function OperatedListingTable({
  label,
  combos,
}: {
  label: string;
  combos: MatrixCombo[];
}) {
  if (!combos.length) return null;
  const total = combos.reduce((sum, combo) => sum + combo.quantity, 0);

  return (
    <table className="agency-report-document__table" aria-label={label}>
      <thead>
        <tr>
          <th scope="col">Tipo</th>
          <th scope="col">Natureza</th>
          <th scope="col">Quantidade</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">Total</th>
          <td>—</td>
          <td>{count(total)}</td>
        </tr>
        {combos.map((combo) => (
          <tr key={`${combo.type}:${combo.category}`}>
            <th scope="row">{combo.type}</th>
            <td>{MATRIX_CATEGORY_LABELS[combo.category] ?? combo.category.replaceAll("_", " ")}</td>
            <td>{count(combo.quantity)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type EmptyEmbarkRowLike = {
  type: string;
  condition: string;
  localLabel: string;
  quantity: number;
};

// `vaziosEmbarcados` deixou de ser {rows,totals} (Task 4): agora é uma
// listagem plana (tipo, condição, local) — precisa do próprio parser, o
// `asMatrix` não serve mais para esta chave.
function asEmptyEmbarkRows(value: unknown): EmptyEmbarkRowLike[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = asRecord(item);
    return {
      type: String(record.type ?? "—"),
      condition: String(record.condition ?? "—"),
      localLabel: String(record.localLabel ?? "—"),
      quantity: number(record.quantity),
    };
  });
}

function EmptyEmbarkTable({
  label,
  rows,
}: {
  label: string;
  rows: EmptyEmbarkRowLike[];
}) {
  if (!rows.length) return null;
  const total = rows.reduce((sum, row) => sum + row.quantity, 0);

  return (
    <table className="agency-report-document__table" aria-label={label}>
      <thead>
        <tr>
          <th scope="col">Tipo</th>
          <th scope="col">Condição</th>
          <th scope="col">Local</th>
          <th scope="col">Quantidade</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">Total</th>
          <td>—</td>
          <td>—</td>
          <td>{count(total)}</td>
        </tr>
        {rows.map((row, index) => (
          <tr key={`${row.type}:${row.condition}:${row.localLabel}:${index}`}>
            <th scope="row">{row.type}</th>
            <td>{row.condition}</td>
            <td>{row.localLabel}</td>
            <td>{count(row.quantity)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type SignoffRow = Record<string, unknown>;

// Estado + autor + data da resolução de uma seção — mesma ideia de
// sectionAttribution (VoyageAgencyReportTab.tsx), só que aqui o snapshot já
// fechado é a única fonte (sem query viva de sign-offs).
function resolutionFor(
  section: AgencyReportSection,
  signoffs: SignoffRow[],
  actorNames: Record<string, string>,
): { label: string; attribution: string | null } {
  const row = signoffs.find((signoff) => signoff.section === section);
  const state = (row?.state as SignoffState) ?? "pending";
  const label = signoffLabels[state] ?? signoffLabels.pending;
  const signedAt = row?.signed_at as string | null | undefined;
  const signedBy = row?.signed_by as string | null | undefined;
  if (!signedAt || state === "pending") return { label, attribution: null };
  const name = (signedBy && actorNames[signedBy]) || null;
  return { label, attribution: `${name ?? "—"} em ${formatDate(signedAt)}` };
}

function ResolutionLine({
  section,
  signoffs,
  actorNames,
}: {
  section: AgencyReportSection;
  signoffs: SignoffRow[];
  actorNames: Record<string, string>;
}) {
  const { label, attribution } = resolutionFor(section, signoffs, actorNames);
  return (
    <p className="agency-report-document__resolution">
      <strong>{label}</strong>
      {attribution ? ` — ${attribution}` : ""}
    </p>
  );
}

// Bloco sem dado não é impresso (hasData === false omite `children`); a
// seção em si é sempre impressa, com a resolução (estado, autor, data) da
// Task 5 do ADR 2026-07-31.
function Section({
  title,
  section,
  hasData = true,
  showResolution = true,
  signoffs,
  actorNames,
  children,
}: {
  title: string;
  section?: AgencyReportSection;
  hasData?: boolean;
  // Uma seção do ciclo (ex.: 'operacao_patio') vira várias seções impressas
  // (Operação de vazios, Linhas de serviço, Anexo, Storage) — sem isto, a
  // mesma resolução (estado + assinante + data) se repetiria em cada uma.
  // false = a resolução já apareceu num bloco anterior com a mesma `section`.
  showResolution?: boolean;
  signoffs?: SignoffRow[];
  actorNames?: Record<string, string>;
  children?: React.ReactNode;
}) {
  return (
    <section className="agency-report-document__section">
      <h2>{title}</h2>
      {hasData ? children : null}
      {section && showResolution ? (
        <ResolutionLine
          section={section}
          signoffs={signoffs ?? []}
          actorNames={actorNames ?? {}}
        />
      ) : null}
    </section>
  );
}

type DepartmentReopeningLike = {
  changed_at: string | null;
  changed_by: string | null;
  justification: string | null;
};

// Reaberturas congeladas no fechamento (ADR 0039, Task 4): ausentes em
// snapshot anterior à Task 4 — `[]` degrada para "sem reabertura", não quebra.
function asReopenings(value: unknown): DepartmentReopeningLike[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = asRecord(item);
    return {
      changed_at: (record.changed_at as string | null | undefined) ?? null,
      changed_by: (record.changed_by as string | null | undefined) ?? null,
      justification: (record.justification as string | null | undefined) ?? null,
    };
  });
}

function asDepartmentSignoffRows(value: unknown) {
  if (!Array.isArray(value)) return null;
  return value.map((item) => {
    const record = asRecord(item);
    return {
      department: String(record.department ?? ""),
      signed_by: (record.signed_by as string | null | undefined) ?? null,
      signed_at: (record.signed_at as string | null | undefined) ?? null,
      reopenings: asReopenings(record.reopenings),
    };
  });
}

const DEPARTMENTS: AgencyReportDepartmentKey[] = [
  "operacoes",
  "documentacao",
  "equipamentos",
];

// Fecho com os três sign-offs departamentais (Task 5, bullet 3/4). Ausente
// quando o snapshot é legado (sem a chave `departmentSignoffs`) — não
// inventa "0/3" nem linhas vazias para um dado que nunca existiu.
function DepartmentSignoffsSection({
  rows,
  actorNames,
}: {
  rows: Array<{
    department: string;
    signed_by: string | null;
    signed_at: string | null;
    reopenings: DepartmentReopeningLike[];
  }>;
  actorNames: Record<string, string>;
}) {
  const byDepartment = new Map(rows.map((row) => [row.department, row]));
  // Alguma reabertura registrada em algum departamento? Só então a coluna
  // extra é impressa — snapshot sem reabertura nenhuma mantém a tabela
  // enxuta, igual ao comportamento anterior à Task 4.
  const hasAnyReopening = rows.some((row) => row.reopenings.length > 0);

  return (
    <section className="agency-report-document__section">
      <h2>Assinaturas departamentais</h2>
      <table
        className="agency-report-document__table"
        aria-label="Assinaturas departamentais"
      >
        <thead>
          <tr>
            <th scope="col">Departamento</th>
            <th scope="col">Assinante</th>
            <th scope="col">Data</th>
            {hasAnyReopening ? <th scope="col">Reaberturas</th> : null}
          </tr>
        </thead>
        <tbody>
          {DEPARTMENTS.map((department) => {
            const row = byDepartment.get(department);
            const name = (row?.signed_by && actorNames[row.signed_by]) || null;
            const reopenings = row?.reopenings ?? [];
            return (
              <tr key={department}>
                <th scope="row">{AGENCY_REPORT_DEPARTMENT_LABELS[department]}</th>
                <td>{row?.signed_at ? (name ?? "—") : "Não assinado"}</td>
                <td>{row?.signed_at ? formatDate(row.signed_at) : "—"}</td>
                {hasAnyReopening ? (
                  <td>
                    {reopenings.length ? (
                      <ul className="agency-report-document__reopenings">
                        {reopenings.map((reopening, index) => {
                          const reopenName =
                            (reopening.changed_by && actorNames[reopening.changed_by]) ||
                            reopening.changed_by ||
                            "—";
                          return (
                            <li key={index}>
                              {formatDate(reopening.changed_at)} — {reopenName}
                              {reopening.justification ? `: ${reopening.justification}` : ""}
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      "—"
                    )}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export function AgencyReportDocument({
  snapshot,
  actorNames = {},
}: {
  snapshot: Snapshot;
  actorNames?: Record<string, string>;
}) {
  const header = snapshot.header ?? {};
  const schedule = header.schedule ?? {};
  const sections = snapshot.sections ?? {};
  const cargaSolta = asRecord(sections.cargaSolta);
  // Task 1 (ADR 2026-07-31): carga solta em transbordo, separada da de destino
  // final. Ausente em snapshot legado (pré-fix) — asRecord(undefined) já
  // degrada para {}, e number()/count() tratam campos ausentes como zero.
  const cargaSoltaTransshipment = asRecord(cargaSolta.transshipment);
  const granite = Array.isArray(sections.granito)
    ? {
        bls: sections.granito.length,
        blocks: sections.granito.reduce(
          (total, item) => total + number(asRecord(item).blocks_qty),
          0,
        ),
        weightTon: sections.granito.reduce(
          (total, item) => total + number(asRecord(item).real_weight_kg) / 1000,
          0,
        ),
      }
    : asRecord(sections.granito);
  const vehicles = Array.isArray(sections.veiculos)
    ? sections.veiculos.map(asRecord)
    : [];
  const vehicleLocations = asRecord(sections.vehicleLocations);
  // Os sign-offs são chave de topo do snapshot (VoyageAgencyReportTab); a
  // leitura de `sections.signoffs` fica como fallback de snapshots antigos.
  const signoffs: SignoffRow[] = (
    Array.isArray(snapshot.signoffs)
      ? snapshot.signoffs
      : Array.isArray(sections.signoffs)
        ? sections.signoffs
        : []
  ).map(asRecord) as SignoffRow[];
  const observations = signoffs.filter(
    (signoff) => typeof signoff.observation === "string" && signoff.observation.trim(),
  );
  const depots = Array.isArray(sections.depots) ? sections.depots : [];
  const vaziosUnidades = Array.isArray(sections.vaziosUnidades)
    ? sections.vaziosUnidades.map(asRecord)
    : [];
  const vaziosUnidadesComPeriodo = vaziosUnidades.filter(
    (unit) => unit.hand_in_date && unit.hand_out_date,
  );
  const costs = asRecord(sections.costs);
  const serviceLines = Array.isArray(costs.serviceLines)
    ? costs.serviceLines.map(asRecord)
    : [];
  const discargaCombos = matrixCombos(asMatrix(sections.cargaDescarregada));
  const vaziosDescarregadosCombos = matrixCombos(asMatrix(sections.vaziosDescarregados));
  const vaziosEmbarcadosRows = asEmptyEmbarkRows(sections.vaziosEmbarcados);
  const storage = asRecord(sections.storage);
  const departmentSignoffs = asDepartmentSignoffRows(snapshot.departmentSignoffs);
  // Snapshot fechado ANTES da fusão (ADR 0036) carrega uma resolução própria de
  // 'operacao_patio'. Ela não é reescrita — o impresso a mostra como registro
  // histórico, em vez de atribuir a assinatura das unidades a quem assinou o
  // pátio (ou o contrário).
  const legacyPatioSignoff = signoffs.find(
    (signoff) => signoff.section === "operacao_patio",
  );

  // Várias seções impressas compartilham a mesma `section` do ciclo (ex.:
  // 'vazios_embarcados' aparece em cinco blocos) — a resolução só é impressa
  // uma vez, no primeiro bloco daquela seção (ver Section, showResolution).
  const printedResolutions = new Set<AgencyReportSection>();
  const section = (key: AgencyReportSection) => {
    const showResolution = !printedResolutions.has(key);
    printedResolutions.add(key);
    return { section: key, signoffs, actorNames, showResolution };
  };

  return (
    <article
      className="agency-report-print-content"
      aria-label="Agency Departure Report fechado"
    >
      <InvoiceDocHeader
        logoSrc="/branding/tr-logo.png"
        docNumber={`ADR · ${header.port ?? "—"}`}
      />
      <InvoiceDocTitle uppercase>Agency Departure Report</InvoiceDocTitle>
      <dl className="agency-report-document__facts">
        <div>
          <dt>Armador</dt>
          <dd>{header.carrierName ?? "—"}</dd>
        </div>
        <div>
          <dt>Navio / viagem</dt>
          <dd>{header.voyageLabel ?? "—"}</dd>
        </div>
        <div>
          <dt>Porto</dt>
          <dd>{header.port ?? "—"}</dd>
        </div>
        <div>
          <dt>Terminal</dt>
          <dd>{header.terminal ?? "—"}</dd>
        </div>
        <div>
          <dt>ATA</dt>
          <dd>{formatDate(schedule.ata)}</dd>
        </div>
        <div>
          <dt>ATB</dt>
          <dd>{formatDate(schedule.atb)}</dd>
        </div>
        <div>
          <dt>ATD</dt>
          <dd>{formatDate(schedule.atd)}</dd>
        </div>
        <div>
          <dt>Restow</dt>
          <dd>{count(schedule.rtw)}</dd>
        </div>
      </dl>

      <Section title="Escala" {...section("datas")} hasData={false} />
      <Section
        title="Carga solta"
        {...section("carga_descarregada")}
        hasData={Boolean(number(cargaSolta.bls)) || Boolean(number(cargaSoltaTransshipment.bls))}
      >
        {number(cargaSolta.bls) ? (
          <MetricsTable
            label="Carga solta"
            metrics={[
              ["B/Ls", count(cargaSolta.bls)],
              ["Máquinas", count(cargaSolta.machines)],
              ["Packages", count(cargaSolta.packages)],
              ["Peso", ton(cargaSolta.weightTon)],
              ["CBM", count(cargaSolta.cbm)],
            ]}
          />
        ) : null}
        {number(cargaSoltaTransshipment.bls) ? (
          <MetricsTable
            label="Carga solta em transbordo"
            metrics={[
              ["B/Ls em transbordo", count(cargaSoltaTransshipment.bls)],
              ["Máquinas em transbordo", count(cargaSoltaTransshipment.machines)],
              ["Packages em transbordo", count(cargaSoltaTransshipment.packages)],
              ["Peso em transbordo", ton(cargaSoltaTransshipment.weightTon)],
              ["CBM em transbordo", count(cargaSoltaTransshipment.cbm)],
            ]}
          />
        ) : null}
      </Section>
      <Section title="Granito" {...section("carga_carregada")} hasData={Boolean(number(granite.bls))}>
        <MetricsTable
          label="Granito"
          metrics={[
            ["B/Ls", count(granite.bls)],
            ["Blocos", count(granite.blocks)],
            ["Peso", ton(granite.weightTon)],
          ]}
        />
      </Section>
      <Section title="Matriz de descarga" {...section("carga_descarregada")} hasData={discargaCombos.length > 0}>
        <OperatedListingTable label="Matriz de descarga" combos={discargaCombos} />
      </Section>
      <Section title="Vazios descarregados" {...section("vazios_descarregados")} hasData={vaziosDescarregadosCombos.length > 0}>
        <OperatedListingTable label="Vazios descarregados" combos={vaziosDescarregadosCombos} />
      </Section>
      <Section title="Container com veículo" {...section("veiculos")} hasData={vehicles.length > 0}>
        <table
          className="agency-report-document__table"
          aria-label="Container com veículo"
        >
          <thead>
            <tr>
              <th scope="col">Marca</th>
              <th scope="col">B/Ls</th>
              <th scope="col">VINs</th>
              <th scope="col">VINs em transbordo</th>
              <th scope="col">Local de desova</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map((vehicle, index) => {
              const brand = String(vehicle.brand ?? "Marca não informada");
              const locations = Array.isArray(vehicleLocations[brand])
                ? vehicleLocations[brand].join(", ")
                : "—";
              return (
                <tr key={`${brand}-${index}`}>
                  <th scope="row">{brand}</th>
                  <td>{count(vehicle.blCount)}</td>
                  <td>{count(vehicle.vinCount)}</td>
                  <td>{number(vehicle.transshipmentVinCount) ? count(vehicle.transshipmentVinCount) : "—"}</td>
                  <td>{locations || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>
      <Section title="Embarque de vazios" {...section("vazios_embarcados")} hasData={vaziosEmbarcadosRows.length > 0}>
        <EmptyEmbarkTable label="Embarque de vazios" rows={vaziosEmbarcadosRows} />
      </Section>
      <Section
        title="Operação de vazios"
        {...section("vazios_embarcados")}
        hasData={Boolean(number(sections.directEmbarkCount)) || depots.length > 0}
      >
        <MetricsTable
          label="Operação de vazios"
          metrics={[
            ["Embarque direto", count(sections.directEmbarkCount)],
            ["Depots", depots.join(", ") || "—"],
          ]}
        />
      </Section>
      <Section title="Linhas de serviço do embarque" {...section("vazios_embarcados")} hasData={serviceLines.length > 0}>
        <table
          className="agency-report-document__table"
          aria-label="Linhas de serviço"
        >
          <thead>
            <tr>
              <th>Serviço</th>
              <th>Local</th>
              <th>Rota</th>
              <th>Tipo</th>
              <th>Quantidade</th>
              <th>Unitário</th>
              <th>Total</th>
              <th>Observação</th>
            </tr>
          </thead>
          <tbody>
            {serviceLines.map((service, index) => (
              <tr key={String(service.id ?? index)}>
                <th>
                  {String(
                    asRecord(service.service).name ??
                      service.service_id ??
                      "—",
                  )}
                </th>
                <td>
                  {String(
                    asRecord(service.local).name ?? service.local_id ?? "—",
                  )}
                </td>
                <td>
                  {String(
                    asRecord(service.destino).name ??
                      service.destino_id ??
                      "—",
                  )}
                </td>
                <td>{String(service.container_type ?? "—")}</td>
                <td>{count(service.quantidade)}</td>
                <td>{formatBRL(number(service.valor_unitario))}</td>
                <td>{formatBRL(serviceLineTotal(service))}</td>
                <td>{String(service.observation ?? "—")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section
        title="Anexo — unidades que geraram armazenagem"
        {...section("vazios_embarcados")}
        hasData={vaziosUnidadesComPeriodo.length > 0}
      >
        <table
          className="agency-report-document__table"
          aria-label="Unidades que geraram armazenagem"
        >
          <thead>
            <tr>
              <th>Container</th>
              <th>Tipo</th>
              <th>Local</th>
              <th>Condição</th>
              <th>Entrada</th>
              <th>Saída</th>
            </tr>
          </thead>
          <tbody>
            {vaziosUnidadesComPeriodo.map((unit, index) => (
              <tr key={String(unit.id ?? index)}>
                <th>{String(unit.container_number ?? "—")}</th>
                <td>{String(unit.container_type ?? "—")}</td>
                <td>{String(asRecord(unit.local).name ?? asRecord(unit.local).code ?? unit.local_id ?? "—")}</td>
                <td>{String(unit.condition ?? "—")}</td>
                <td>{formatDate(unit.hand_in_date as string | null)}</td>
                <td>{formatDate(unit.hand_out_date as string | null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section
        title="Storage"
        {...section("vazios_embarcados")}
        hasData={Boolean(number(storage.containers)) || Boolean(number(storage.days))}
      >
        <MetricsTable
          label="Storage"
          metrics={[
            ["Containers", count(storage.containers)],
            ["Dias", count(storage.days)],
          ]}
        />
      </Section>
      {legacyPatioSignoff ? (
        <Section title="Operação de pátio — resolução registrada no fechamento">
          <ResolutionLine
            section={"operacao_patio" as AgencyReportSection}
            signoffs={signoffs}
            actorNames={actorNames}
          />
        </Section>
      ) : null}
      <Section title="Observações por seção">
        {observations.length ? (
          <ul>
            {observations.map((signoff, index) => (
              <li key={String(signoff.id ?? signoff.section ?? index)}>
                <strong>
                  {agencyReportSectionLabel(String(signoff.section ?? "")) || "Seção"}:{" "}
                </strong>
                {String(signoff.observation)}
              </li>
            ))}
          </ul>
        ) : (
          <Empty />
        )}
      </Section>
      {departmentSignoffs ? (
        <DepartmentSignoffsSection rows={departmentSignoffs} actorNames={actorNames} />
      ) : null}
      <InvoiceDocFooter />
    </article>
  );
}
