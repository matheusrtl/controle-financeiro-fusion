import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase-client";

function todayISO() { return new Date().toISOString().slice(0, 10); }
function addDays(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default defineTool({
  name: "get_kpis",
  title: "Get cash-flow KPIs",
  description: "Return cash-flow KPIs for the active report: totals to pay, totals received, balance, overdue counts.",
  inputSchema: {
    from: z.string().optional().describe("ISO date (YYYY-MM-DD) lower bound on vencimento."),
    to: z.string().optional().describe("ISO date (YYYY-MM-DD) upper bound on vencimento."),
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
    if (input.from) q = q.gte("vencimento", input.from);
    if (input.to) q = q.lte("vencimento", input.to);

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
    const open = rows.filter((r) => r.status !== "pago");
    const paid = rows.filter((r) => r.status === "pago");
    const overdue = rows.filter((r) => r.status === "vencido");
    const sumOpen = (a: any[]) => a.reduce((s, r) => s + Number(r.valor_aberto ?? 0), 0);
    const sumPaid = (a: any[]) => a.reduce((s, r) => s + Number(r.valor_pago ?? 0), 0);

    const kpis = {
      pagar: {
        total: sumOpen(open),
        d7: sumOpen(open.filter((r) => r.vencimento && r.vencimento >= today && r.vencimento <= in7)),
        d30: sumOpen(open.filter((r) => r.vencimento && r.vencimento >= today && r.vencimento <= in30)),
      },
      receber: { total: sumPaid(paid) },
      saldo: sumPaid(paid) - sumOpen(open),
      vencidos: { count: overdue.length, total: sumOpen(overdue) },
      total_rows: rows.length,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(kpis, null, 2) }],
      structuredContent: kpis,
    };
  },
});
