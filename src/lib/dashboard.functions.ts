import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const FiltersSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  fornecedor: z.string().optional(),
  centro_custo: z.string().optional(),
  conta: z.string().optional(),
  status: z.enum(["pago", "aberto", "vencido"]).optional(),
  documento: z.string().optional(),
  valorMin: z.number().optional(),
  valorMax: z.number().optional(),
}).partial().default({});

type Filters = z.infer<typeof FiltersSchema>;

type TxRow = {
  id: number; documento: string | null; fornecedor: string | null;
  emissao: string | null; vencimento: string | null; pagamento: string | null;
  valor: number; multa: number; juros: number; desconto: number;
  valor_pago: number; valor_aberto: number; valor_total: number;
  centro_custo: string | null; conta: string | null; status: string;
  obs_parcela: string | null; obs_lancamento: string | null;
};

async function loadActiveTransactions(supabase: any, filters: Filters): Promise<TxRow[]> {
  const { data: rep } = await supabase.from("reports").select("id").eq("status", "active").maybeSingle();
  if (!rep) return [];
  let q = supabase.from("transactions").select("*").eq("report_id", rep.id);
  if (filters.fornecedor) q = q.ilike("fornecedor", `%${filters.fornecedor}%`);
  if (filters.centro_custo) q = q.eq("centro_custo", filters.centro_custo);
  if (filters.conta) q = q.eq("conta", filters.conta);
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.documento) q = q.ilike("documento", `%${filters.documento}%`);
  if (filters.from) q = q.gte("vencimento", filters.from);
  if (filters.to) q = q.lte("vencimento", filters.to);
  if (filters.valorMin != null) q = q.gte("valor", filters.valorMin);
  if (filters.valorMax != null) q = q.lte("valor", filters.valorMax);
  // For 100k rows, paginate in chunks
  const all: TxRow[] = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...(data as TxRow[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  // Ignora linhas sem fornecedor (linha de totalização de planilhas antigas)
  const cleaned = all.filter((r) => r.fornecedor && String(r.fornecedor).trim().length > 0);
  const today = todayISO();
  // Recalcula status conforme regra de negócio atual (pagamento = pago)
  for (const r of cleaned) {
    if (r.pagamento) r.status = "pago";
    else if (r.vencimento && r.vencimento < today) r.status = "vencido";
    else r.status = "aberto";
  }
  return cleaned;
}


function todayISO() { return new Date().toISOString().slice(0, 10); }
function addDays(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// KPIs
export const getKpis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => FiltersSchema.parse(raw ?? {}))
  .handler(async ({ data, context }) => {
    const rows = await loadActiveTransactions(context.supabase, data);
    const today = todayISO();
    const tomorrow = addDays(today, 1);
    const in7 = addDays(today, 7);
    const in30 = addDays(today, 30);

    const receber = rows.filter((r) => r.status !== "pago" && r.pagamento == null && r.valor_aberto > 0 && r.valor >= 0 && r.valor_total > 0);
    // Note: without account-type column, treat all open items as "pagar" per Fusion spec (accounts payable).
    // The spec's rules say Receber = Valor Pago, Pagar = Valor em Aberto. We'll follow that literal interpretation.

    const sumOpen = (arr: TxRow[]) => arr.reduce((s, r) => s + Number(r.valor_aberto), 0);
    const sumPaid = (arr: TxRow[]) => arr.reduce((s, r) => s + Number(r.valor_pago), 0);

    // Regra: pago se possui Data de Pagamento; caso contrário em aberto.
    // Dentro dos em aberto: vencido se vencimento < hoje; caso contrário a vencer.
    const paidRows = rows.filter((r) => !!r.pagamento);
    const openRows = rows.filter((r) => !r.pagamento);
    const vencidos = openRows.filter((r) => r.vencimento && r.vencimento < today);
    const aVencer = openRows.filter((r) => !r.vencimento || r.vencimento >= today);

    const pagarHoje = openRows.filter((r) => r.vencimento === today);
    const pagarAmanha = openRows.filter((r) => r.vencimento === tomorrow);
    const pagar7 = openRows.filter((r) => r.vencimento && r.vencimento >= today && r.vencimento <= in7);
    const pagar30 = openRows.filter((r) => r.vencimento && r.vencimento >= today && r.vencimento <= in30);

    return {
      receber: {
        total: sumPaid(paidRows),
        hoje: sumPaid(rows.filter((r) => r.pagamento === today)),
        amanha: sumPaid(rows.filter((r) => r.pagamento === tomorrow)),
        d7: sumPaid(rows.filter((r) => r.pagamento && r.pagamento >= today && r.pagamento <= in7)),
        d30: sumPaid(rows.filter((r) => r.pagamento && r.pagamento >= today && r.pagamento <= in30)),
      },
      pagar: {
        total: sumOpen(openRows),
        hoje: sumOpen(pagarHoje),
        amanha: sumOpen(pagarAmanha),
        d7: sumOpen(pagar7),
        d30: sumOpen(pagar30),
      },
      saldo: sumPaid(paidRows) - sumOpen(openRows),
      emAberto: sumOpen(openRows),
      aVencer: { count: aVencer.length, total: sumOpen(aVencer) },
      pago: sumPaid(paidRows),
      vencidos: { count: vencidos.length, total: sumOpen(vencidos) },
    };

  });

// Cashflow series
export const getCashflowSeries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({
    granularity: z.enum(["day", "week", "month", "year"]).default("month"),
    filters: FiltersSchema,
    openingBalance: z.number().optional(),
    openingDate: z.string().optional(),
  }).parse(raw ?? {}))
  .handler(async ({ data, context }) => {
    const rows = await loadActiveTransactions(context.supabase, data.filters);
    const bucketOf = (iso: string): string => {
      const d = new Date(iso + "T00:00:00Z");
      if (data.granularity === "day") return iso;
      if (data.granularity === "month") return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      if (data.granularity === "year") return String(d.getUTCFullYear());
      // week
      const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const w = Math.ceil((((d.getTime() - first.getTime()) / 86400000) + first.getUTCDay() + 1) / 7);
      return `${d.getUTCFullYear()}-W${String(w).padStart(2, "0")}`;
    };

    const buckets = new Map<string, { bucket: string; receber: number; pagar: number; qtd: number }>();
    for (const r of rows) {
      const anchor = r.pagamento ?? r.vencimento;
      if (!anchor) continue;
      if (data.openingDate && anchor < data.openingDate) continue;
      const b = bucketOf(anchor);
      const cur = buckets.get(b) ?? { bucket: b, receber: 0, pagar: 0, qtd: 0 };
      cur.receber += Number(r.valor_pago);
      cur.pagar += Number(r.valor_aberto);
      cur.qtd += 1;
      buckets.set(b, cur);
    }
    const arr = [...buckets.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
    let saldo = Number(data.openingBalance ?? 0);
    return arr.map((b) => {
      saldo += b.receber - b.pagar;
      return { ...b, diferenca: b.receber - b.pagar, saldo };
    });
  });


// Alerts
export const getAlerts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => FiltersSchema.parse(raw ?? {}))
  .handler(async ({ data, context }) => {
    const rows = await loadActiveTransactions(context.supabase, data);
    const today = todayISO();
    const tomorrow = addDays(today, 1);
    const daysAgo = (iso: string) => Math.floor((new Date(today).getTime() - new Date(iso).getTime()) / 86400000);
    const vencidos = rows.filter((r) => r.status === "vencido")
      .sort((a, b) => (a.vencimento ?? "").localeCompare(b.vencimento ?? ""));
    const hoje = rows.filter((r) => r.status !== "pago" && r.vencimento === today);
    const amanha = rows.filter((r) => r.status !== "pago" && r.vencimento === tomorrow);
    const topPagar = [...rows.filter((r) => r.status !== "pago")]
      .sort((a, b) => Number(b.valor_aberto) - Number(a.valor_aberto)).slice(0, 10);
    const topReceber = [...rows.filter((r) => r.status === "pago")]
      .sort((a, b) => Number(b.valor_pago) - Number(a.valor_pago)).slice(0, 10);

    return {
      vencidos: vencidos.slice(0, 15).map((r) => ({
        id: r.id, documento: r.documento, fornecedor: r.fornecedor,
        vencimento: r.vencimento, valor_aberto: Number(r.valor_aberto),
        atraso: r.vencimento ? daysAgo(r.vencimento) : 0,
      })),
      hoje: hoje.map((r) => ({ id: r.id, documento: r.documento, fornecedor: r.fornecedor, valor_aberto: Number(r.valor_aberto) })),
      amanha: amanha.map((r) => ({ id: r.id, documento: r.documento, fornecedor: r.fornecedor, valor_aberto: Number(r.valor_aberto) })),
      topPagar: topPagar.map((r) => ({ id: r.id, fornecedor: r.fornecedor, valor: Number(r.valor_aberto), vencimento: r.vencimento })),
      topReceber: topReceber.map((r) => ({ id: r.id, fornecedor: r.fornecedor, valor: Number(r.valor_pago), pagamento: r.pagamento })),
      diasAtraso: vencidos.reduce((s, r) => s + (r.vencimento ? daysAgo(r.vencimento) : 0), 0),
      valorAtraso: vencidos.reduce((s, r) => s + Number(r.valor_aberto), 0),
    };
  });

// Breakdown for pies and top-N
export const getBreakdown = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({
    dimension: z.enum(["centro_custo", "conta", "fornecedor"]),
    filters: FiltersSchema,
    limit: z.number().optional(),
  }).parse(raw ?? {}))
  .handler(async ({ data, context }) => {
    const rows = await loadActiveTransactions(context.supabase, data.filters);
    const map = new Map<string, { key: string; total: number; count: number }>();
    for (const r of rows) {
      const key = (r as any)[data.dimension] ?? "(Sem informação)";
      const cur = map.get(key) ?? { key, total: 0, count: 0 };
      cur.total += Number(r.valor_aberto) + Number(r.valor_pago);
      cur.count += 1;
      map.set(key, cur);
    }
    const arr = [...map.values()].sort((a, b) => b.total - a.total);
    return data.limit ? arr.slice(0, data.limit) : arr;
  });

// Heatmap
export const getHeatmap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => FiltersSchema.parse(raw ?? {}))
  .handler(async ({ data, context }) => {
    const rows = await loadActiveTransactions(context.supabase, data);
    const map = new Map<string, number>();
    for (const r of rows) {
      const d = r.pagamento ?? r.vencimento;
      if (!d) continue;
      map.set(d, (map.get(d) ?? 0) + Number(r.valor_aberto) + Number(r.valor_pago));
    }
    return [...map.entries()].map(([date, total]) => ({ date, total }));
  });

// Transactions list (paginated) + facets
export const listTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({
    filters: FiltersSchema,
    page: z.number().default(0),
    pageSize: z.number().default(50),
    sort: z.object({ column: z.string(), asc: z.boolean() }).optional(),
  }).parse(raw ?? {}))
  .handler(async ({ data, context }) => {
    const { data: rep } = await context.supabase.from("reports").select("id").eq("status", "active").maybeSingle();
    if (!rep) return { rows: [], total: 0 };
    let q = context.supabase.from("transactions").select("*", { count: "exact" }).eq("report_id", rep.id);
    const f = data.filters;
    if (f.fornecedor) q = q.ilike("fornecedor", `%${f.fornecedor}%`);
    if (f.centro_custo) q = q.eq("centro_custo", f.centro_custo);
    if (f.conta) q = q.eq("conta", f.conta);
    if (f.status) q = q.eq("status", f.status);
    if (f.documento) q = q.ilike("documento", `%${f.documento}%`);
    if (f.from) q = q.gte("vencimento", f.from);
    if (f.to) q = q.lte("vencimento", f.to);
    if (f.valorMin != null) q = q.gte("valor", f.valorMin);
    if (f.valorMax != null) q = q.lte("valor", f.valorMax);
    if (data.sort) q = q.order(data.sort.column, { ascending: data.sort.asc });
    else q = q.order("vencimento", { ascending: true });
    const start = data.page * data.pageSize;
    q = q.range(start, start + data.pageSize - 1);
    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0 };
  });

export const getFacets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: rep } = await context.supabase.from("reports").select("id").eq("status", "active").maybeSingle();
    if (!rep) return { fornecedores: [], centros: [], contas: [] };
    const { data: rows } = await context.supabase
      .from("transactions")
      .select("fornecedor, centro_custo, conta")
      .eq("report_id", rep.id)
      .limit(50000);
    const uniq = (arr: (string | null)[]) => [...new Set(arr.filter(Boolean) as string[])].sort();
    return {
      fornecedores: uniq((rows ?? []).map((r) => r.fornecedor)),
      centros: uniq((rows ?? []).map((r) => r.centro_custo)),
      contas: uniq((rows ?? []).map((r) => r.conta)),
    };
  });
