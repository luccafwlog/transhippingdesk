// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createManualVaziosBooking: vi.fn(() => Promise.resolve()),
  invalidateQueries: vi.fn(() => Promise.resolve()),
  refetch: vi.fn(() => Promise.resolve()),
  showToast: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = queryKey[0];
    const data = key === "vazios-export-operations"
      ? [{ id: "operation-1", voyage_id: 179, embark_port: "BRVIX" }]
      : key === "embarque-vazios-units"
        ? { rows: [], count: 0 }
        : key === "embarque-vazios-operation"
          ? { linhas: [] }
          : key === "depots"
            ? [
                { id: "depot-1", code: "VBR", name: "Depot Vitória", tipo: "depot" },
                { id: "terminal-1", code: "TVV", name: "Terminal Vitória", tipo: "terminal_portuario" },
              ]
            : key === "depot-services"
              ? [{ id: "transport-1", name: "Transporte", natureza: "transporte" }]
              : [];
    return { data, isLoading: false, error: null, refetch: mocks.refetch };
  },
}));

vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" }, can: () => true }),
}));
vi.mock("../../components/ui/Toast", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../../components/shared/VoyageCombobox", () => ({ VoyageCombobox: () => <div /> }));
vi.mock("../../services/supabase", () => ({ supabase: {} }));
vi.mock("../../services/depots", () => ({ listDepots: vi.fn(), listDepotServices: vi.fn(), valorSugerido: vi.fn(() => 0) }));
vi.mock("../../services/vaziosImport", () => ({ importVaziosManifest: vi.fn(), parseVaziosManifestFile: vi.fn() }));
vi.mock("../../services/vaziosExportOperations", () => ({
  createManualVaziosBooking: mocks.createManualVaziosBooking,
  deleteManualVaziosBooking: vi.fn(),
  deleteServiceLine: vi.fn(),
  getVaziosExportOperation: vi.fn(),
  listVaziosBookingsForOperation: vi.fn(),
  updateManualVaziosBooking: vi.fn(),
  upsertServiceLine: vi.fn(),
  upsertVaziosExportOperation: vi.fn(),
}));

import { EmbarqueVazios } from "../EmbarqueVazios";

afterEach(cleanup);

describe("EmbarqueVazios", () => {
  it("inclui uma Unidade Embarcada e invalida o ADR da escala selecionada", async () => {
    render(<MemoryRouter><EmbarqueVazios /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: /Viagem 179/i }));
    fireEvent.change(screen.getByLabelText("Container"), { target: { value: "MSCU1234567" } });
    fireEvent.change(screen.getByLabelText("Local"), { target: { value: "depot-1" } });
    fireEvent.change(screen.getByLabelText("Entrada"), { target: { value: "2026-07-02" } });
    fireEvent.change(screen.getByLabelText("Saída"), { target: { value: "2026-07-03" } });
    fireEvent.click(screen.getByRole("button", { name: /Adicionar/i }));

    await waitFor(() => expect(mocks.createManualVaziosBooking).toHaveBeenCalledWith(expect.objectContaining({
      operationId: "operation-1",
      voyageId: 179,
      localId: "depot-1",
      containerNumber: "MSCU1234567",
    })));
    await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["agency-report", 179] }));
  });

  it("exibe a mensagem da RPC quando a inclusao da Unidade Embarcada falha", async () => {
    mocks.createManualVaziosBooking.mockRejectedValueOnce({
      code: "42501",
      message: "Usuario sem permissao para criar unidade embarcada.",
    });
    render(<MemoryRouter><EmbarqueVazios /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: /Viagem 179/i }));
    fireEvent.change(screen.getByLabelText("Container"), { target: { value: "MSCU1234567" } });
    fireEvent.change(screen.getByLabelText("Local"), { target: { value: "depot-1" } });
    fireEvent.change(screen.getByLabelText("Entrada"), { target: { value: "2026-07-02" } });
    fireEvent.change(screen.getByLabelText("Saída"), { target: { value: "2026-07-03" } });
    fireEvent.click(screen.getByRole("button", { name: /Adicionar/i }));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith(
      "Usuario sem permissao para criar unidade embarcada.",
      "error",
    ));
  });

  it("oferece somente locais cadastrados como origem e destino de transporte", () => {
    render(<MemoryRouter><EmbarqueVazios /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: /Viagem 179/i }));
    fireEvent.click(screen.getByRole("button", { name: /Serviços/i }));
    fireEvent.change(screen.getByLabelText("Local"), { target: { value: "depot-1" } });
    fireEvent.change(screen.getByLabelText("Serviço"), { target: { value: "transport-1" } });

    const destination = screen.getByLabelText("Destino da rota") as HTMLSelectElement;
    expect(destination.disabled).toBe(false);
    expect([...destination.options].map((option) => option.text)).toEqual(expect.arrayContaining([
      "VBR · Depot Vitória",
      "TVV · Terminal Vitória",
    ]));
  });
});
