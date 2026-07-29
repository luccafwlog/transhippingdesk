import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("migration 245 - validacao manual de vazios", () => {
  it("mantem a regra de datas de depot do contrato original", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/242_validate_manual_vazios_bookings.sql"),
      "utf8",
    );
    expect(sql).toContain("NEW.hand_out_date < NEW.hand_in_date");
    expect(sql).toContain("v_local_tipo = 'depot'");
  });

  it("usa erro de validacao para regras de negocio exibiveis", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/245_validacao_manual_vazios_exibivel.sql"),
      "utf8",
    );
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.validate_vazios_booking_operation");
    expect(sql).toContain("Depot exige entrada e saida validas.");
    expect(sql).toContain("USING ERRCODE = '22023'");
  });
});
