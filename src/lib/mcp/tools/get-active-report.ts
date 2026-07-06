import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase-client";

export default defineTool({
  name: "get_active_report",
  title: "Get active report",
  description: "Return metadata for the currently active payments report (name, upload date, row count).",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("reports")
      .select("id, filename, uploaded_at, row_count, period_start, period_end, status")
      .eq("status", "active")
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) return { content: [{ type: "text", text: "No active report found." }] };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { report: data },
    };
  },
});
