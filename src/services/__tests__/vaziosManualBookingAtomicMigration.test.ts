import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("migration 244 - criacao manual atomica", () => {
  it("persiste o manifesto e a unidade na mesma funcao transacional", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/244_criacao_manual_vazios_atomica.sql"),
      "utf8",
    );
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.create_manual_vazios_booking");
    expect(sql).toContain("INSERT INTO public.vazios_manifests");
    expect(sql).toContain("INSERT INTO public.vazios_bookings");
    expect(sql).toContain("SECURITY DEFINER");
  });
});
