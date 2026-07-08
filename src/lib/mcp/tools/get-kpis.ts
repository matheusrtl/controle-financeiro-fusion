import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase-client";

function todayISO() { return new Date().toISOString().slice(0, 10); }
function addDays(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function effVenc(r: any): string | null {
  return r.sugestao_vencimento ?? r.vencimento;
}

export default defineTool({
  name: "get_kpis",
  title: "Get expense KPIs",
  description: "Return expense KPIs for the active report: totals to pay, paid in period, overdue counts. Expense-only system (no receivables).",
  inputSchema: {
    from: z.string().optional().describe("ISO date (YYYY-MM-DD) lower bound on effective due date."),
    to: z.string().optional().describe("ISO date (YYYY-MM-DD) upper bound on effective due date."),
    fornecedor: z.string().optional().describe("Filter by supplier name (ILIKE)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data: rep } = await supabase.from("reports").select("id").eq("status", "active").maybeSingle();
    if (!rep) return { content: [{ type: "text", text: "No active report found." }] };

    let q = supabase.from("transactions").select("*").eq("report_id", rep.id);
    if (input.fornecedor) q = q.ilike("fornecedor", `%${input.fornecedor}%`);

    const rows: any[] = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) return { content: [{ type: "text", text: error.message }], isError: true };
      if (!data || data.length === 0) break;
      rows.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }

    const today = todayISO();
    const in7 = addDays(today, 7);
    const in30 = addDays(today, 30);

    // Filtra por vencimento efetivo em memória
    const filtered = rows.filter((r) => {
      const v = effVenc(r);
      if (input.from && (v ?? "") < input.from) return false;
      if (input.to && (v ?? "") > input.to) return false;
      return true;
    });

    const open = filtered.filter((r) => !r.pagamento);
    const overdue = open.filter((r) => {
      const v = effVenc(r);
      return v && v < today;
    });
    const paidInPeriod = filtered.filter((r) => {
      if (!r.pagamento) return false;
      if (input.from && r.pagamento < input.from) return false;
      if (input.to && r.pagamento > input.to) return false;
      return true;
    });
    const sumOpen = (a: any[]) => a.reduce((s, r) => s + Number(r.valor_aberto ?? 0), 0);
    const sumPaid = (a: any[]) => a.reduce((s, r) => s + Number(r.valor_pago ?? 0), 0);

    const kpis = {
      pagar: {
        total: sumOpen(open),
        d7: sumOpen(open.filter((r) => {
          const v = effVenc(r);
          return v && v >= today && v <= in7;
        })),
        d30: sumOpen(open.filter((r) => {
          const v = effVenc(r);
          return v && v >= today && v <= in30;
        })),
      },
      pago_no_periodo: sumPaid(paidInPeriod),
      vencidos: { count: overdue.length, total: sumOpen(overdue) },
      total_rows: filtered.length,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(kpis, null, 2) }],
      structuredContent: kpis,
    };
  },
});
