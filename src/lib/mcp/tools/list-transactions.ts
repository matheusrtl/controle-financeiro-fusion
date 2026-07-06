import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase-client";

export default defineTool({
  name: "list_transactions",
  title: "List transactions",
  description: "List payment transactions from the active report with optional filters. Returns up to 100 rows.",
  inputSchema: {
    status: z.enum(["pago", "aberto", "vencido"]).optional().describe("Filter by payment status."),
    fornecedor: z.string().optional().describe("Filter by supplier name (ILIKE)."),
    documento: z.string().optional().describe("Filter by document number (ILIKE)."),
    from: z.string().optional().describe("ISO date lower bound on vencimento."),
    to: z.string().optional().describe("ISO date upper bound on vencimento."),
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
    if (input.status) q = q.eq("status", input.status);
    if (input.fornecedor) q = q.ilike("fornecedor", `%${input.fornecedor}%`);
    if (input.documento) q = q.ilike("documento", `%${input.documento}%`);
    if (input.from) q = q.gte("vencimento", input.from);
    if (input.to) q = q.lte("vencimento", input.to);
    q = q.order("vencimento", { ascending: true }).range(0, limit - 1);

    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { rows: data ?? [], count: data?.length ?? 0 },
    };
  },
});
