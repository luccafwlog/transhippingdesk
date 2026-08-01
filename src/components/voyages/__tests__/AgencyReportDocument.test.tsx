// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { AgencyReportDocument } from "../AgencyReportDocument";
import { formatBRL } from "../../../lib/utils";

afterEach(cleanup);

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
          vaziosEmbarcados: [
            { type: "40HC", condition: "EMPTY", localLabel: "VBR", quantity: 4 },
          ],
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

// Task 8 do ADR 2026-07-31: o total impresso da linha vem de `total`
// (calculado por totalLinha em agencyDepartureReport.ts), não mais de uma
// fórmula reimplementada que aplicava o percentual legado mesmo em
// armazenagem. Um snapshot pós-Task 8 já traz o campo pronto.
it("imprime o total pronto (`total`) da linha de serviço, ignorando o percentual legado de uma linha de armazenagem", () => {
  render(
    <AgencyReportDocument
      snapshot={{
        header: { carrierName: "Armador teste", voyageLabel: "NAVIO TESTE / 01E", port: "BRVIX" },
        sections: {
          costs: {
            total: 1000,
            serviceLines: [
              {
                id: "line-1",
                service: { name: "Armazenagem" },
                local: { name: "VBR" },
                destino: null,
                local_id: "d1",
                service_id: "s1",
                quantidade: 10,
                percentual: 50,
                valor_unitario: 100,
                total: 1000,
              },
            ],
          },
        },
        occurrences: [],
      }}
    />,
  );

  const table = screen.getByRole("table", { name: "Linhas de serviço" });
  expect(table.textContent).toContain(formatBRL(1000));
  expect(table.textContent).not.toContain(formatBRL(500));
});

// Snapshot fechado ANTES da Task 8: sem o campo `total`, cai na fórmula
// antiga (registro histórico, sem recálculo sobre dado já congelado).
it("cai na fórmula antiga quando o snapshot fechado é anterior à Task 8 (sem o campo `total`)", () => {
  render(
    <AgencyReportDocument
      snapshot={{
        header: { carrierName: "Armador teste", voyageLabel: "NAVIO TESTE / 01E", port: "BRVIX" },
        sections: {
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
        },
        occurrences: [],
      }}
    />,
  );

  const table = screen.getByRole("table", { name: "Linhas de serviço" });
  expect(table.textContent).toContain(formatBRL(250));
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

// Task 5 do ADR 2026-07-31: cada seção impressa mostra estado + autor + data
// da resolução; um bloco sem dado (aqui, Vazios descarregados) não é
// impresso, mas a seção continua saindo com a resolução; o documento fecha
// com os três sign-offs departamentais.
it("imprime resolução de seção com autor e data, omite bloco sem dado e fecha com os três sign-offs departamentais", () => {
  const { container } = render(
    <AgencyReportDocument
      actorNames={{ "user-doc": "Ana Documentação", "user-ops": "Beto Operações", "user-eqp": "Carla Equipamentos" }}
      snapshot={{
        header: { carrierName: "Armador teste", voyageLabel: "NAVIO TESTE / 01E", port: "BRVIX" },
        sections: {
          cargaDescarregada: {
            rows: { "40HC": { carga_geral: 3 } },
            totals: { carga_geral: 3 },
          },
          // Vazios descarregados sem nenhum item: o bloco não deve sair
          // impresso, só a resolução da seção.
          vaziosDescarregados: { rows: {}, totals: {} },
        },
        occurrences: [],
        signoffs: [
          { section: "carga_descarregada", state: "confirmed", signed_by: "user-doc", signed_at: "2026-07-20" },
          { section: "vazios_descarregados", state: "nothing_to_declare", signed_by: "user-doc", signed_at: "2026-07-20" },
        ],
        departmentSignoffs: [
          { department: "documentacao", signed_by: "user-doc", signed_at: "2026-07-20" },
          { department: "operacoes", signed_by: "user-ops", signed_at: "2026-07-21" },
          { department: "equipamentos", signed_by: "user-eqp", signed_at: "2026-07-21" },
        ],
      }}
    />,
  );

  expect(
    screen.getByRole("table", { name: "Matriz de descarga" }).textContent,
  ).toContain("40HC");
  expect(screen.queryByRole("table", { name: "Vazios descarregados" })).toBeNull();
  const resolutions = [...container.querySelectorAll(".agency-report-document__resolution")].map(
    (node) => node.textContent,
  );
  expect(resolutions.filter((text) => text?.match(/Confirmado — Ana Documentação em/)).length).toBeGreaterThan(0);
  expect(resolutions.some((text) => text?.match(/Nada a declarar — Ana Documentação em/))).toBe(true);

  const signoffTable = screen.getByRole("table", { name: "Assinaturas departamentais" });
  expect(signoffTable.textContent).toContain("Ana Documentação");
  expect(signoffTable.textContent).toContain("Beto Operações");
  expect(signoffTable.textContent).toContain("Carla Equipamentos");
});

// Snapshot legado (anterior à Task 5) nunca gravou `departmentSignoffs`: o
// impresso precisa sair sem lançar e sem inventar um bloco de assinaturas.
it("imprime snapshot legado sem departmentSignoffs sem lançar e sem bloco de assinaturas", () => {
  expect(() =>
    render(
      <AgencyReportDocument
        snapshot={{
          header: { carrierName: "Armador teste", voyageLabel: "NAVIO TESTE / 01E", port: "BRVIX" },
          sections: {},
          occurrences: [],
          signoffs: [],
        }}
      />,
    ),
  ).not.toThrow();

  expect(screen.queryByRole("table", { name: "Assinaturas departamentais" })).toBeNull();
});

// Task 1 do ADR 2026-07-31: carga solta em transbordo, separada da própria da
// escala; precisa aparecer no impresso, não só na aba.
it("imprime a carga solta em transbordo separada da própria da escala", () => {
  render(
    <AgencyReportDocument
      snapshot={{
        header: { carrierName: "Armador teste", voyageLabel: "NAVIO TESTE / 01E", port: "BRVIX" },
        sections: {
          cargaSolta: {
            bls: 0,
            machines: 0,
            packages: 0,
            weightTon: 0,
            cbm: 0,
            transshipment: { bls: 2, machines: 3, packages: 10, weightTon: 15, cbm: 25 },
          },
        },
        occurrences: [],
        signoffs: [],
      }}
    />,
  );

  expect(screen.getByRole("heading", { name: "Carga solta" })).toBeTruthy();
  expect(
    screen.getByRole("table", { name: "Carga solta em transbordo" }).textContent,
  ).toContain("B/Ls em transbordo2");
});

// Snapshot legado (anterior a este fix) nunca gravou `cargaSolta.transshipment`:
// o impresso precisa sair sem lançar e sem bloco de transbordo.
it("imprime snapshot legado sem cargaSolta.transshipment sem lançar", () => {
  expect(() =>
    render(
      <AgencyReportDocument
        snapshot={{
          header: { carrierName: "Armador teste", voyageLabel: "NAVIO TESTE / 01E", port: "BRVIX" },
          sections: { cargaSolta: { bls: 1, machines: 0, packages: 0, weightTon: 1, cbm: 1 } },
          occurrences: [],
          signoffs: [],
        }}
      />,
    ),
  ).not.toThrow();

  expect(screen.queryByRole("table", { name: "Carga solta em transbordo" })).toBeNull();
});
