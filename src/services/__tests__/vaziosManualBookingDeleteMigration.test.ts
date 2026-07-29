import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("migration 246 - exclusao manual atomica", () => {
  it("remove a unidade e o manifesto manual vazio na mesma RPC", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/246_exclusao_manual_vazios_atomica.sql"),
      "utf8",
    );
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.delete_manual_vazios_booking");
    expect(sql).toContain("DELETE FROM public.vazios_bookings WHERE id = p_booking_id");
    expect(sql).toContain("DELETE FROM public.vazios_manifests");
    expect(sql).toContain("NOT EXISTS");
  });
});
