import { auth, defineMcp } from "@lovable.dev/mcp-js";
import getActiveReport from "./tools/get-active-report";
import getKpis from "./tools/get-kpis";
import listTransactions from "./tools/list-transactions";
import getOverdue from "./tools/get-overdue";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "fusion-logistica-mcp",
  title: "Fusion Logística — Fluxo de Caixa",
  version: "0.1.0",
  instructions:
    "Read-only access to the Fusion Logística cash-flow dataset. Use get_active_report to identify the current report, get_kpis for headline totals, get_overdue for late payments, and list_transactions to inspect individual rows.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [getActiveReport, getKpis, getOverdue, listTransactions],
});
