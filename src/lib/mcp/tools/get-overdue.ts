import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase-client";

export default defineTool({
  name: "get_overdue",
  title: "Get overdue transactions",
  description: "Return overdue (vencido) transactions from the active report, sorted by due date ascending.",
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
    const { data, error } = await supabase
      .from("transactions")
      .select("id, documento, fornecedor, vencimento, valor_aberto, centro_custo, conta")
      .eq("report_id", rep.id)
      .eq("status", "vencido")
      .order("vencimento", { ascending: true })
      .range(0, limit - 1);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const total = (data ?? []).reduce((s, r) => s + Number(r.valor_aberto ?? 0), 0);
    return {
      content: [{ type: "text", text: JSON.stringify({ total_overdue: total, rows: data }, null, 2) }],
      structuredContent: { total_overdue: total, rows: data ?? [] },
    };
  },
});
