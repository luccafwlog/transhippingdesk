import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Upload, Plus, Trash2, Pencil } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Card, InlineError, PageHeader } from "../components/ui/Card";
import { Field, Input, Select } from "../components/ui/Input";
import { VoyageCombobox } from "../components/shared/VoyageCombobox";
import { useAuth } from "../hooks/useAuth";
import { useToast } from "../components/ui/Toast";
import {
  getVaziosExportOperation,
  upsertServiceLine,
  upsertVaziosExportOperation,
  deleteServiceLine,
  listVaziosBookingsForOperation,
  createManualVaziosBooking,
  updateManualVaziosBooking,
  deleteManualVaziosBooking,
} from "../services/vaziosExportOperations";
import {
  importVaziosManifest,
  parseVaziosManifestFile,
} from "../services/vaziosImport";
import {
  listDepotServices,
  listDepots,
  valorSugerido,
} from "../services/depots";
import { supabase } from "../services/supabase";
import {
  quantidadeEfetiva,
  totalEmbarque,
  veto,
} from "../services/vaziosCusto";
import type { VaziosExportServiceLine } from "../types/database";
import { formatBRL, formatDate } from "../lib/utils";
import { invalidateAgencyReportForVoyage } from "../services/agencyReportInvalidation";

type Tab = "unidades" | "servicos";

export function EmbarqueVazios() {
  const queryClient = useQueryClient();
  const { user, can } = useAuth();
  const { showToast } = useToast();
  const canEdit = can("vazios_edit");
  const [voyageId, setVoyageId] = useState<number | null>(null);
  const [port, setPort] = useState("");
  const [selectedOperation, setSelectedOperation] = useState<{
    id: string;
    voyage_id: number;
    embark_port: string;
  } | null>(null);
  const [tab, setTab] = useState<Tab>("unidades");
  const [file, setFile] = useState<File | null>(null);
  const [line, setLine] = useState({
    serviceId: "",
    localId: "",
    destinoId: "",
    containerType: "",
    condition: "",
    quantidade: 0,
    percentual: 100,
    valor: 0,
    valorSugerido: null as number | null,
    quantidadeManual: false,
  });
  const [unit, setUnit] = useState({
    id: "",
    containerNumber: "",
    containerType: "",
    localId: "",
    condition: "vazio" as "vazio" | "material",
    handInDate: "",
    handOutDate: "",
    movementDate: "",
  });
  const operations = useQuery({
    queryKey: ["vazios-export-operations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vazios_export_operations")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const units = useQuery({
    queryKey: ["embarque-vazios-units", selectedOperation?.id],
    queryFn: () => listVaziosBookingsForOperation(selectedOperation!.id),
    enabled: Boolean(selectedOperation),
  });
  const operation = useQuery({
    queryKey: ["embarque-vazios-operation", selectedOperation?.id],
    queryFn: () =>
      getVaziosExportOperation(
        selectedOperation!.voyage_id,
        selectedOperation!.embark_port,
      ),
    enabled: Boolean(selectedOperation),
  });
  const depots = useQuery({ queryKey: ["depots"], queryFn: listDepots });
  const services = useQuery({
    queryKey: ["depot-services", line.localId],
    queryFn: () => listDepotServices(line.localId),
    enabled: Boolean(line.localId),
  });
  const depotRows = Array.isArray(depots.data) ? depots.data : [];
  const serviceRows = Array.isArray(services.data) ? services.data : [];
  const operationRows = Array.isArray(operations.data) ? operations.data : [];
  const local = depotRows.find((item) => item.id === line.localId);
  const selectedService = serviceRows.find(
    (item) => item.id === line.serviceId,
  );
  const shipmentTotal = operation.data
    ? totalEmbarque({
        unidades: units.data?.rows ?? [],
        linhas: (operation.data.linhas ?? []).map(
          (item: VaziosExportServiceLine & { service: unknown }) => ({
            ...item,
            natureza:
              (item.service as { natureza?: string } | null)?.natureza ??
              "geral",
            local_id: item.local_id,
            quantidade: Number(item.quantidade),
            valor_unitario: Number(item.valor_unitario),
          }),
        ),
        depots: depotRows,
      })
    : 0;

  async function refreshOperationData() {
    await Promise.all([
      units.refetch(),
      operation.refetch(),
      selectedOperation ? invalidateAgencyReportForVoyage(queryClient, selectedOperation.voyage_id) : Promise.resolve(),
    ]);
  }
  async function notify(action: () => Promise<void>, success: string) {
    try {
      await action();
      showToast(success, "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Falha na operação.",
        "error",
      );
    }
  }
  async function createOperation() {
    if (!voyageId || !port.trim()) return;
    await notify(async () => {
      const created = await upsertVaziosExportOperation({
        voyageId,
        embarkPort: port.trim().toUpperCase(),
      });
      setSelectedOperation({
        id: created.id,
        voyage_id: voyageId,
        embark_port: port.trim().toUpperCase(),
      });
      await operations.refetch();
    }, "Embarque criado.");
  }
  async function importUnits() {
    if (!file || !selectedOperation || !user?.id) return;
    await notify(async () => {
      const parsed = await parseVaziosManifestFile(file);
      await importVaziosManifest({
        filename: file.name,
        voyageId: selectedOperation.voyage_id,
        port: selectedOperation.embark_port,
        uploadedBy: user.id,
        manifest: parsed,
      });
      setFile(null);
      await refreshOperationData();
    }, "Lista de unidades substituída.");
  }
  function clearUnit() {
    setUnit({
      id: "",
      containerNumber: "",
      containerType: "",
      localId: "",
      condition: "vazio",
      handInDate: "",
      handOutDate: "",
      movementDate: "",
    });
  }
  async function saveUnit() {
    if (!selectedOperation || !unit.localId) return;
    await notify(
      async () => {
        const payload = {
          containerNumber: unit.containerNumber,
          containerType: unit.containerType || null,
          localId: unit.localId,
          condition: unit.condition,
          handInDate: unit.handInDate || null,
          handOutDate: unit.handOutDate || null,
          movementDate: unit.movementDate || null,
        };
        if (unit.id) await updateManualVaziosBooking(unit.id, payload);
        else
          await createManualVaziosBooking({
            operationId: selectedOperation.id,
            voyageId: selectedOperation.voyage_id,
            uploadedBy: user?.id,
            ...payload,
          });
        clearUnit();
        await refreshOperationData();
      },
      unit.id ? "Unidade atualizada." : "Unidade incluída.",
    );
  }
  async function saveLine() {
    if (!selectedOperation || !selectedService || !local) return;
    await notify(async () => {
      const draft = {
        natureza: selectedService.natureza,
        local_id: local.id,
        destino_id: line.destinoId || null,
        condition: line.condition || null,
        quantidade: line.quantidade,
        percentual:
          selectedService.natureza === "armazenagem" ? null : line.percentual,
        valor_unitario: line.valor,
        quantidade_manual:
          selectedService.natureza === "armazenagem" && line.quantidadeManual,
      };
      const issue = veto(draft, {
        depots: depotRows,
        lines: (operation.data?.linhas ?? []).map((item) => ({
          ...item,
          natureza:
            (item.service as { natureza?: string } | null)?.natureza ?? "geral",
          quantidade: Number(item.quantidade),
          valor_unitario: Number(item.valor_unitario),
        })),
      });
      if (issue) throw new Error(issue);
      await upsertServiceLine({
        operation_id: selectedOperation.id,
        service_id: selectedService.id,
        local_id: local.id,
        destino_id: draft.destino_id,
        container_type:
          selectedService.natureza === "armazenagem"
            ? null
            : line.containerType || null,
        condition: draft.condition,
        quantidade: line.quantidade,
        percentual: draft.percentual,
        valor_unitario: line.valor,
        valor_sugerido: line.valorSugerido,
        quantidade_manual: draft.quantidade_manual,
      });
      await refreshOperationData();
    }, "Linha de serviço lançada.");
  }
  function chooseService(serviceId: string) {
    const service = serviceRows.find((item) => item.id === serviceId);
    const suggestion =
      service && local
        ? valorSugerido({
            local,
            servico: service,
            tipo: line.containerType,
            rota: line.destinoId,
            condicao: line.condition,
            catalogo: serviceRows,
          })
        : null;
    setLine((current) => ({
      ...current,
      serviceId,
      valor: suggestion ?? 0,
      valorSugerido: suggestion,
      quantidadeManual: service?.natureza !== "armazenagem",
    }));
  }
  return (
    <div className="grid gap-5">
      <PageHeader
        title="Embarque de Vazios"
        description="Um embarque por escala: unidades importadas como fato e serviços lançados manualmente."
        action={
          <Link className="app-table__action" to="/embarquevazios/depots">
            Cadastro de Terminais
          </Link>
        }
      />
      <Card className="grid gap-3">
        <h2 className="app-panel__title">Novo Embarque de Vazios</h2>
        <div className="grid gap-3 md:grid-cols-[1fr_12rem_auto]">
          <VoyageCombobox
            required
            selectedVoyageId={voyageId}
            onSelect={setVoyageId}
          />
          <Field label="Porto de embarque">
            <Input
              value={port}
              onChange={(event) => setPort(event.target.value)}
              placeholder="BRVIX"
            />
          </Field>
          <Button
            className="self-end"
            disabled={!canEdit || !voyageId || !port.trim()}
            onClick={() => void createOperation()}
          >
            <Plus size={16} /> Criar
          </Button>
        </div>
      </Card>
      <Card className="grid gap-3">
        <h2 className="app-panel__title">Embarques por escala</h2>
        {operations.error ? (
          <InlineError message="Erro ao carregar embarques." />
        ) : null}
        <div className="grid gap-2 md:grid-cols-3">
          {operationRows.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedOperation(item)}
              className={`rounded-lg border p-3 text-left ${selectedOperation?.id === item.id ? "border-[var(--app-blue-btn)]" : "border-[var(--app-border)]"}`}
            >
              <span className="font-semibold">Viagem {item.voyage_id}</span>
              <span className="block text-sm text-[var(--app-muted)]">
                {item.embark_port}
              </span>
            </button>
          ))}
        </div>
      </Card>
      {selectedOperation ? (
        <div className="grid gap-5">
          <div className="flex gap-2 border-b border-[var(--app-border)]">
            <Button
              variant={tab === "unidades" ? "primary" : "ghost"}
              onClick={() => setTab("unidades")}
            >
              Unidades Embarcadas
            </Button>
            <Button
              variant={tab === "servicos" ? "primary" : "ghost"}
              onClick={() => setTab("servicos")}
            >
              Serviços · {formatBRL(shipmentTotal)}
            </Button>
          </div>
          {tab === "unidades" ? (
            <Card className="grid gap-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="app-panel__title">
                    Lista de Unidades Embarcadas
                  </h2>
                  <p className="text-sm text-[var(--app-muted)]">
                    Reimportar substitui toda a lista da escala e pode alterar a
                    armazenagem.
                  </p>
                </div>
                <span className="flex gap-2">
                  <Input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(event) =>
                      setFile(event.target.files?.[0] ?? null)
                    }
                  />
                  <Button
                    disabled={!file || !canEdit}
                    onClick={() => void importUnits()}
                  >
                    <Upload size={16} /> Importar
                  </Button>
                </span>
              </div>
              <div className="grid gap-2 md:grid-cols-4">
                <Field label="Container">
                  <Input
                    value={unit.containerNumber}
                    onChange={(event) =>
                      setUnit((current) => ({
                        ...current,
                        containerNumber: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Tipo">
                  <Input
                    value={unit.containerType}
                    onChange={(event) =>
                      setUnit((current) => ({
                        ...current,
                        containerType: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Local">
                  <Select
                    value={unit.localId}
                    onChange={(event) =>
                      setUnit((current) => ({
                        ...current,
                        localId: event.target.value,
                      }))
                    }
                  >
                    <option value="">Selecione</option>
                    {depotRows.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.code} · {item.name ?? item.tipo}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Condição">
                  <Select
                    value={unit.condition}
                    onChange={(event) =>
                      setUnit((current) => ({
                        ...current,
                        condition: event.target.value as "vazio" | "material",
                      }))
                    }
                  >
                    <option value="vazio">Vazio</option>
                    <option value="material">Material</option>
                  </Select>
                </Field>
                <Field label="Entrada">
                  <Input
                    type="date"
                    value={unit.handInDate}
                    onChange={(event) =>
                      setUnit((current) => ({
                        ...current,
                        handInDate: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Saída">
                  <Input
                    type="date"
                    value={unit.handOutDate}
                    onChange={(event) =>
                      setUnit((current) => ({
                        ...current,
                        handOutDate: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Embarque">
                  <Input
                    type="date"
                    value={unit.movementDate}
                    onChange={(event) =>
                      setUnit((current) => ({
                        ...current,
                        movementDate: event.target.value,
                      }))
                    }
                  />
                </Field>
                <div className="flex items-end gap-2">
                  <Button
                    disabled={
                      !canEdit || !unit.containerNumber || !unit.localId
                    }
                    onClick={() => void saveUnit()}
                  >
                    <Plus size={16} /> {unit.id ? "Salvar" : "Adicionar"}
                  </Button>
                  {unit.id ? (
                    <Button variant="ghost" onClick={clearUnit}>
                      Cancelar
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="app-table-scroll">
                <table className="app-table min-w-[760px] text-left text-sm">
                  <thead>
                    <tr>
                      <th>Container</th>
                      <th>Tipo</th>
                      <th>Local</th>
                      <th>Condição</th>
                      <th>Entrada</th>
                      <th>Saída</th>
                      <th>Embarque</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {(units.data?.rows ?? []).map((item) => (
                      <tr key={item.id}>
                        <td>{item.container_number}</td>
                        <td>{item.container_type ?? "—"}</td>
                        <td>
                          {depotRows.find((depot) => depot.id === item.local_id)
                            ?.code ?? item.local_id}
                        </td>
                        <td>{item.condition}</td>
                        <td>{formatDate(item.hand_in_date)}</td>
                        <td>{formatDate(item.hand_out_date)}</td>
                        <td>{formatDate(item.movement_date)}</td>
                        <td className="flex gap-1">
                          <Button
                            variant="ghost"
                            disabled={!canEdit}
                            onClick={() =>
                              setUnit({
                                id: item.id,
                                containerNumber: item.container_number,
                                containerType: item.container_type ?? "",
                                localId: item.local_id,
                                condition: item.condition as
                                  "vazio" | "material",
                                handInDate: item.hand_in_date ?? "",
                                handOutDate: item.hand_out_date ?? "",
                                movementDate: item.movement_date ?? "",
                              })
                            }
                          >
                            <Pencil size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={!canEdit}
                            onClick={() =>
                              void notify(async () => {
                                await deleteManualVaziosBooking(item.id);
                                clearUnit();
                                await refreshOperationData();
                              }, "Unidade excluída.")
                            }
                          >
                            <Trash2 size={14} />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            <Card className="grid gap-3">
              <h2 className="app-panel__title">Linhas de Serviço</h2>
              <div className="grid gap-3 md:grid-cols-4">
                <Field label="Local">
                  <Select
                    value={line.localId}
                    onChange={(event) =>
                      setLine((current) => ({
                        ...current,
                        localId: event.target.value,
                        serviceId: "",
                      }))
                    }
                  >
                    <option value="">Selecione</option>
                    {depotRows.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.code} · {item.tipo}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Serviço">
                  <Select
                    value={line.serviceId}
                    onChange={(event) => chooseService(event.target.value)}
                    disabled={!line.localId}
                  >
                    <option value="">Selecione</option>
                    {serviceRows.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {item.natureza}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Destino da rota">
                  <Select
                    value={line.destinoId}
                    onChange={(event) =>
                      setLine((current) => ({
                        ...current,
                        destinoId: event.target.value,
                      }))
                    }
                    disabled={selectedService?.natureza !== "transporte"}
                  >
                    <option value="">Selecione</option>
                    {depotRows.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.code} · {item.name ?? item.tipo}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Condição">
                  <Select
                    value={line.condition}
                    onChange={(event) =>
                      setLine((current) => ({
                        ...current,
                        condition: event.target.value,
                      }))
                    }
                  >
                    <option value="">—</option>
                    <option value="vazio">Vazio</option>
                    <option value="material">Material</option>
                  </Select>
                </Field>
                <Field label="Quantidade">
                  <Input
                    type="number"
                    min={0}
                    value={line.quantidade}
                    disabled={
                      selectedService?.natureza === "armazenagem" &&
                      !line.quantidadeManual
                    }
                    onChange={(event) =>
                      setLine((current) => ({
                        ...current,
                        quantidade: Number(event.target.value),
                      }))
                    }
                  />
                  {selectedService?.natureza === "armazenagem" ? (
                    <>
                      <label className="mt-1 flex gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={line.quantidadeManual}
                          onChange={(event) =>
                            setLine((current) => ({
                              ...current,
                              quantidadeManual: event.target.checked,
                            }))
                          }
                        />{" "}
                        Sobrescrever cálculo
                      </label>
                      <p className="mt-1 text-xs text-[var(--app-muted)]">
                        Calculada:{" "}
                        {quantidadeEfetiva(
                          {
                            natureza: "armazenagem",
                            local_id: local?.id ?? "",
                            condition: line.condition || null,
                            quantidade: line.quantidade,
                            valor_unitario: line.valor,
                            quantidade_manual: false,
                          },
                          units.data?.rows ?? [],
                          depotRows,
                        )}
                      </p>
                    </>
                  ) : null}
                </Field>
                <Field label="Percentual">
                  <Select
                    value={line.percentual}
                    onChange={(event) =>
                      setLine((current) => ({
                        ...current,
                        percentual: Number(event.target.value),
                      }))
                    }
                    disabled={selectedService?.natureza === "armazenagem"}
                  >
                    <option value={50}>50%</option>
                    <option value={100}>100%</option>
                  </Select>
                </Field>
                <Field label="Valor unitário">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.valor}
                    onChange={(event) =>
                      setLine((current) => ({
                        ...current,
                        valor: Number(event.target.value),
                      }))
                    }
                  />
                </Field>
                <div className="self-end">
                  <Button
                    disabled={!canEdit || !line.serviceId || !line.localId}
                    onClick={() => void saveLine()}
                  >
                    <Plus size={16} /> Lançar linha
                  </Button>
                  {line.valorSugerido != null ? (
                    <p className="mt-1 text-xs text-[var(--app-muted)]">
                      Sugerido: {formatBRL(line.valorSugerido)}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="app-table-scroll">
                <table className="app-table min-w-[900px] text-left text-sm">
                  <thead>
                    <tr>
                      <th>Serviço</th>
                      <th>Local</th>
                      <th>Rota</th>
                      <th>Tipo</th>
                      <th>Quantidade</th>
                      <th>%</th>
                      <th>Unitário</th>
                      <th>Total</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {(operation.data?.linhas ?? []).map((item) => {
                      const natureza =
                        (item.service as { natureza?: string } | null)
                          ?.natureza ?? "geral";
                      const calculated = quantidadeEfetiva(
                        {
                          ...item,
                          natureza,
                          quantidade: Number(item.quantidade),
                          valor_unitario: Number(item.valor_unitario),
                        },
                        units.data?.rows ?? [],
                        depotRows,
                      );
                      return (
                        <tr key={item.id}>
                          <td>
                            {(item.service as { name?: string } | null)?.name ??
                              item.service_id}
                          </td>
                          <td>{item.local_id}</td>
                          <td>{item.destino_id ?? "—"}</td>
                          <td>{item.container_type ?? "—"}</td>
                          <td>
                            {calculated}
                            {item.quantidade_manual &&
                            natureza === "armazenagem" ? (
                              <span className="block text-xs text-[var(--app-muted)]">
                                Calculada:{" "}
                                {quantidadeEfetiva(
                                  {
                                    ...item,
                                    natureza,
                                    quantidade: Number(item.quantidade),
                                    valor_unitario: Number(item.valor_unitario),
                                    quantidade_manual: false,
                                  },
                                  units.data?.rows ?? [],
                                  depotRows,
                                )}
                              </span>
                            ) : null}
                          </td>
                          <td>{item.percentual ?? "—"}</td>
                          <td>{formatBRL(Number(item.valor_unitario))}</td>
                          <td>
                            {formatBRL(
                              calculated *
                                Number(item.valor_unitario) *
                                (item.percentual == null
                                  ? 1
                                  : Number(item.percentual) / 100),
                            )}
                          </td>
                          <td>
                            <Button
                              variant="ghost"
                              onClick={() =>
                                void notify(async () => {
                                  await deleteServiceLine(item.id);
                                  await refreshOperationData();
                                }, "Linha excluída.")
                              }
                            >
                              <Trash2 size={14} />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      ) : null}
    </div>
  );
}
