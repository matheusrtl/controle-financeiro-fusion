import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase-client";

function todayISO() { return new Date().toISOString().slice(0, 10); }
function effVenc(r: any): string | null {
  return r.sugestao_vencimento ?? r.vencimento;
}

export default defineTool({
  name: "list_transactions",
  title: "List transactions",
  description: "List expense transactions from the active report. Filters use the effective due date (sugestao_vencimento when set, otherwise vencimento). Returns up to 100 rows.",
  inputSchema: {
    status: z.enum(["pago", "aberto", "vencido"]).optional().describe("Filter by payment status."),
    fornecedor: z.string().optional().describe("Filter by supplier name (ILIKE)."),
    documento: z.string().optional().describe("Filter by document number (ILIKE)."),
    from: z.string().optional().describe("ISO date lower bound on effective due date."),
    to: z.string().optional().describe("ISO date upper bound on effective due date."),
    limit: z.number().int().min(1).max(100).optional().describe("Max rows to return (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data: rep } = await supabase.from("reports").select("id").eq("status", "active").maybeSingle();
    if (!rep) return { content: [{ type: "text", text: "No active report found." }] };

    const limit = input.limit ?? 50;
    let q = supabase.from("transactions").select("*").eq("report_id", rep.id);
    if (input.fornecedor) q = q.ilike("fornecedor", `%${input.fornecedor}%`);
    if (input.documento) q = q.ilike("documento", `%${input.documento}%`);
    q = q.limit(5000);

    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const today = todayISO();
    const rows = (data ?? [])
      .filter((r: any) => {
        const v = effVenc(r);
        // status efetivo
        let st: "pago" | "aberto" | "vencido";
        if (r.pagamento) st = "pago";
        else if (v && v < today) st = "vencido";
        else st = "aberto";
        if (input.status && st !== input.status) return false;
        if (input.from && (v ?? "") < input.from) return false;
        if (input.to && (v ?? "") > input.to) return false;
        return true;
      })
      .sort((a: any, b: any) => (effVenc(a) ?? "").localeCompare(effVenc(b) ?? ""))
      .slice(0, limit)
      .map((r: any) => ({ ...r, vencimento_efetivo: effVenc(r) }));

    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
      structuredContent: { rows, count: rows.length },
    };
  },
});
