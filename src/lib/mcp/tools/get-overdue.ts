import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase-client";

function todayISO() { return new Date().toISOString().slice(0, 10); }
function effVenc(r: any): string | null {
  return r.sugestao_vencimento ?? r.vencimento;
}

export default defineTool({
  name: "get_overdue",
  title: "Get overdue transactions",
  description: "Return overdue transactions from the active report (effective due date < today and unpaid), sorted by effective due date ascending.",
  inputSchema: {
    limit: z.number().int().min(1).max(100).optional().describe("Max rows to return (default 25)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data: rep } = await supabase.from("reports").select("id").eq("status", "active").maybeSingle();
    if (!rep) return { content: [{ type: "text", text: "No active report found." }] };

    const limit = input.limit ?? 25;
    // Carrega candidatos em aberto e filtra por vencimento efetivo em memória
    const { data, error } = await supabase
      .from("transactions")
      .select("id, documento, fornecedor, vencimento, sugestao_vencimento, pagamento, valor_aberto, centro_custo, conta")
      .eq("report_id", rep.id)
      .is("pagamento", null)
      .limit(5000);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const today = todayISO();
    const overdue = (data ?? [])
      .filter((r: any) => {
        const v = effVenc(r);
        return v && v < today;
      })
      .sort((a: any, b: any) => (effVenc(a) ?? "").localeCompare(effVenc(b) ?? ""))
      .slice(0, limit)
      .map((r: any) => ({ ...r, vencimento_efetivo: effVenc(r) }));

    const total = overdue.reduce((s, r) => s + Number(r.valor_aberto ?? 0), 0);
    return {
      content: [{ type: "text", text: JSON.stringify({ total_overdue: total, rows: overdue }, null, 2) }],
      structuredContent: { total_overdue: total, rows: overdue },
    };
  },
});
