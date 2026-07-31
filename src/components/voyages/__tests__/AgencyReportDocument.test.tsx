// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { AgencyReportDocument } from "../AgencyReportDocument";

it("imprime o snapshot fechado nos blocos e matrizes do modelo real", () => {
  render(
    <AgencyReportDocument
      snapshot={{
        header: {
          carrierName: "Armador teste",
          voyageLabel: "NAVIO TESTE / 01E",
          port: "BRVIX",
          terminal: "TVV",
          schedule: {
            ata: "2026-07-19",
            atb: "2026-07-19",
            atd: "2026-07-20",
            rtw: 2,
          },
        },
        sections: {
          cargaSolta: {
            bls: 2,
            machines: 3,
            packages: 12,
            weightTon: 6,
            cbm: 20,
          },
          granito: { bls: 2, blocks: 14, weightTon: 35.5 },
          cargaDescarregada: {
            rows: { "40HC": { carga_geral: 3, imo: 1 } },
            totals: { carga_geral: 3, imo: 1 },
          },
          vaziosDescarregados: {
            rows: { "20DC": { vazio_cama: 2 } },
            totals: { vazio_cama: 2 },
          },
          veiculos: [{ brand: "BYD", blCount: 2, vinCount: 3 }],
          vehicleLocations: { BYD: ["Pátio Alfa"] },
          vaziosEmbarcados: {
            rows: { "40HC": { carga_geral: 4 } },
            totals: { carga_geral: 4 },
          },
          directEmbarkCount: 1,
          depots: ["VBR"],
          operation: {},
          signoffs: [
            { section: "operacao_patio", observation: "Storage conferido com o depot." },
          ],
          costs: {
            total: 250,
            serviceLines: [
              {
                id: "line-1",
                service: { name: "Bundle Composition" },
                local: { name: "VBR" },
                destino: null,
                local_id: "d1",
                service_id: "s1",
                quantidade: 2,
                percentual: 100,
                valor_unitario: 125,
              },
            ],
          },
          vaziosUnidades: [
            {
              id: "unit-1",
              container_number: "ABCD1234567",
              container_type: "40HC",
              local_id: "d1",
              local: { name: "VBR" },
              condition: "vazio",
              hand_in_date: "2026-07-01",
              hand_out_date: "2026-07-05",
            },
          ],
          storage: { containers: 4, days: 8 },
        },
        occurrences: [
          {
            id: "occ-1",
            body: "Atracação concluída.",
            department: "operacoes",
            created_at: "2026-07-20",
          },
        ],
      }}
    />,
  );

  for (const heading of [
    "Carga solta",
    "Granito",
    "Matriz de descarga",
    "Vazios descarregados",
    "Container com veículo",
    "Embarque de vazios",
    "Linhas de serviço do embarque",
    "Anexo — unidades que geraram armazenagem",
    "Storage",
    "Observações por seção",
  ])
    expect(screen.getByRole("heading", { name: heading })).toBeTruthy();

  expect(
    screen.getByRole("table", { name: "Matriz de descarga" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("table", { name: "Vazios descarregados" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("table", { name: "Embarque de vazios" }),
  ).toBeTruthy();
  expect(screen.getByText("Pátio Alfa")).toBeTruthy();
  expect(
    screen.getByRole("table", { name: "Operação de vazios" }).textContent,
  ).toContain("Embarque direto1");
  expect(
    screen.getByRole("table", { name: "Operação de vazios" }).textContent,
  ).toContain("Embarque direto1");
  expect(screen.getByText("35,5 ton")).toBeTruthy();
  expect(screen.getByText("ATB")).toBeTruthy();
  expect(
    screen.getByRole("table", { name: "Unidades que geraram armazenagem" })
      .textContent,
  ).toContain("VBR");
  expect(screen.getByText("Restow")).toBeTruthy();
  expect(screen.getByText("Storage conferido com o depot.")).toBeTruthy();
  expect(screen.queryByText("OS")).toBeNull();
  expect(screen.queryByRole("heading", { name: "Overtime" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Ocorrências" })).toBeNull();
});

// O snapshot gravado por VoyageAgencyReportTab põe os sign-offs na chave de
// topo, não dentro de `sections`: é dessa forma que a Observação precisa sair
// impressa.
it("imprime a Observação da seção com os sign-offs na chave de topo do snapshot", () => {
  render(
    <AgencyReportDocument
      snapshot={{
        header: { carrierName: "Armador teste", voyageLabel: "NAVIO TESTE / 01E", port: "BRVIX" },
        sections: {},
        occurrences: [],
        signoffs: [
          { section: "datas", state: "confirmed", observation: "Atracação com 4h de espera." },
          { section: "veiculos", state: "nothing_to_declare", observation: null },
        ],
      }}
    />,
  );

  expect(screen.getByText("Atracação com 4h de espera.")).toBeTruthy();
});
