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
  sugestao_vencimento: string | null;
  valor: number; multa: number; juros: number; desconto: number;
  valor_pago: number; valor_aberto: number; valor_total: number;
  centro_custo: string | null; conta: string | null; status: string;
  obs_parcela: string | null; obs_lancamento: string | null;
};

// Data efetiva de vencimento (Sugestão sobrescreve o Vencimento original)
function effVenc(r: Pick<TxRow, "vencimento" | "sugestao_vencimento">): string | null {
  return r.sugestao_vencimento ?? r.vencimento;
}

async function loadActiveTransactions(supabase: any, filters: Filters): Promise<TxRow[]> {
  const { data: rep } = await supabase.from("reports").select("id").eq("status", "active").maybeSingle();
  if (!rep) return [];
  let q = supabase.from("transactions").select("*").eq("report_id", rep.id);
  if (filters.fornecedor) q = q.ilike("fornecedor", `%${filters.fornecedor}%`);
  if (filters.centro_custo) q = q.eq("centro_custo", filters.centro_custo);
  if (filters.conta) q = q.eq("conta", filters.conta);
  if (filters.documento) q = q.ilike("documento", `%${filters.documento}%`);
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
  let cleaned = all.filter((r) => r.fornecedor && String(r.fornecedor).trim().length > 0);
  const today = todayISO();
  // Recalcula status conforme regra de negócio atual, usando o vencimento efetivo
  for (const r of cleaned) {
    const v = effVenc(r);
    if (r.pagamento) r.status = "pago";
    else if (v && v < today) r.status = "vencido";
    else r.status = "aberto";
  }
  // Filtros de data (sobre vencimento efetivo) aplicados em memória
  if (filters.from) cleaned = cleaned.filter((r) => (effVenc(r) ?? "") >= filters.from!);
  if (filters.to) cleaned = cleaned.filter((r) => (effVenc(r) ?? "") <= filters.to!);
  if (filters.status) cleaned = cleaned.filter((r) => r.status === filters.status);
  return cleaned;
}


function todayISO() { return new Date().toISOString().slice(0, 10); }
function addDays(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// KPIs — sistema de DESPESAS: sem contas a receber.
// Card "Pago" agora reflete o valor pago DENTRO do período filtrado (pagamento ∈ [from,to]).
export const getKpis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => FiltersSchema.parse(raw ?? {}))
  .handler(async ({ data, context }) => {
    const rows = await loadActiveTransactions(context.supabase, data);
    const today = todayISO();
    const tomorrow = addDays(today, 1);
    const in7 = addDays(today, 7);
    const in30 = addDays(today, 30);

    const sumOpen = (arr: TxRow[]) => arr.reduce((s, r) => s + Number(r.valor_aberto), 0);
    const sumPaid = (arr: TxRow[]) => arr.reduce((s, r) => s + Number(r.valor_pago), 0);

    // Pago no período: usa o filtro from/to (se informado) sobre a data de pagamento.
    const paidRows = rows.filter((r) => !!r.pagamento);
    const paidInPeriod = paidRows.filter((r) => {
      if (data.from && (r.pagamento ?? "") < data.from) return false;
      if (data.to && (r.pagamento ?? "") > data.to) return false;
      return true;
    });

    const openRows = rows.filter((r) => !r.pagamento);
    const vencidos = openRows.filter((r) => {
      const v = effVenc(r);
      return v && v < today;
    });
    const aVencer = openRows.filter((r) => {
      const v = effVenc(r);
      return !v || v >= today;
    });

    const pagarHoje = openRows.filter((r) => effVenc(r) === today);
    const pagarAmanha = openRows.filter((r) => effVenc(r) === tomorrow);
    const pagar7 = openRows.filter((r) => {
      const v = effVenc(r);
      return v && v >= today && v <= in7;
    });
    const pagar30 = openRows.filter((r) => {
      const v = effVenc(r);
      return v && v >= today && v <= in30;
    });

    return {
      pagoPeriodo: sumPaid(paidInPeriod),
      pagoPeriodoCount: paidInPeriod.length,
      pagar: {
        total: sumOpen(openRows),
        hoje: sumOpen(pagarHoje),
        amanha: sumOpen(pagarAmanha),
        d7: sumOpen(pagar7),
        d30: sumOpen(pagar30),
      },
      emAberto: sumOpen(openRows),
      aVencer: { count: aVencer.length, total: sumOpen(aVencer) },
      pago: sumPaid(paidRows),
      vencidos: { count: vencidos.length, total: sumOpen(vencidos) },
    };
  });

// Cashflow series — só despesas; saldo é monotonicamente decrescente a partir do saldo inicial.
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

    const buckets = new Map<string, { bucket: string; pagar: number; qtd: number }>();
    for (const r of rows) {
      // Âncora da despesa: pagamento (se pago) ou vencimento efetivo (se em aberto)
      const anchor = r.pagamento ?? effVenc(r);
      if (!anchor) continue;
      if (data.openingDate && anchor < data.openingDate) continue;
      const b = bucketOf(anchor);
      const cur = buckets.get(b) ?? { bucket: b, pagar: 0, qtd: 0 };
      // Despesa do bucket = tudo o que sai (pagas + em aberto). Sem "receber".
      cur.pagar += Number(r.valor_pago) + Number(r.valor_aberto);
      cur.qtd += 1;
      buckets.set(b, cur);
    }
    const arr = [...buckets.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
    let saldo = Number(data.openingBalance ?? 0);
    return arr.map((b) => {
      saldo -= b.pagar; // saldo só diminui
      return { ...b, saldo };
    });
  });


// Alerts — sem "top receber".
export const getAlerts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => FiltersSchema.parse(raw ?? {}))
  .handler(async ({ data, context }) => {
    const rows = await loadActiveTransactions(context.supabase, data);
    const today = todayISO();
    const tomorrow = addDays(today, 1);
    const daysAgo = (iso: string) => Math.floor((new Date(today).getTime() - new Date(iso).getTime()) / 86400000);
    const vencidos = rows.filter((r) => r.status === "vencido")
      .sort((a, b) => (effVenc(a) ?? "").localeCompare(effVenc(b) ?? ""));
    const hoje = rows.filter((r) => r.status !== "pago" && effVenc(r) === today);
    const amanha = rows.filter((r) => r.status !== "pago" && effVenc(r) === tomorrow);
    const topPagar = [...rows.filter((r) => r.status !== "pago")]
      .sort((a, b) => Number(b.valor_aberto) - Number(a.valor_aberto)).slice(0, 10);

    return {
      vencidos: vencidos.slice(0, 15).map((r) => ({
        id: r.id, documento: r.documento, fornecedor: r.fornecedor,
        vencimento: effVenc(r), valor_aberto: Number(r.valor_aberto),
        atraso: effVenc(r) ? daysAgo(effVenc(r)!) : 0,
      })),
      hoje: hoje.map((r) => ({ id: r.id, documento: r.documento, fornecedor: r.fornecedor, valor_aberto: Number(r.valor_aberto) })),
      amanha: amanha.map((r) => ({ id: r.id, documento: r.documento, fornecedor: r.fornecedor, valor_aberto: Number(r.valor_aberto) })),
      topPagar: topPagar.map((r) => ({ id: r.id, fornecedor: r.fornecedor, valor: Number(r.valor_aberto), vencimento: effVenc(r) })),
      diasAtraso: vencidos.reduce((s, r) => s + (effVenc(r) ? daysAgo(effVenc(r)!) : 0), 0),
      valorAtraso: vencidos.reduce((s, r) => s + Number(r.valor_aberto), 0),
    };
  });

// Breakdown for pies and top-N — despesas apenas.
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
      // Total = todas as despesas (pagas + em aberto)
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
      const d = r.pagamento ?? effVenc(r);
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
    // Como o filtro por data efetiva não pode ser expresso via PostgREST simples,
    // aplicamos filtros textuais no DB e (quando houver from/to ou status) paginamos em memória.
    const f = data.filters;
    const needsInMemory = !!(f.from || f.to || f.status);

    if (needsInMemory) {
      const all = await loadActiveTransactions(context.supabase, f);
      const sort = data.sort;
      const sorted = sort
        ? [...all].sort((a: any, b: any) => {
            const av = a[sort.column]; const bv = b[sort.column];
            if (av == null) return 1; if (bv == null) return -1;
            if (av < bv) return sort.asc ? -1 : 1;
            if (av > bv) return sort.asc ? 1 : -1;
            return 0;
          })
        : [...all].sort((a, b) => (effVenc(a) ?? "").localeCompare(effVenc(b) ?? ""));
      const start = data.page * data.pageSize;
      return { rows: sorted.slice(start, start + data.pageSize), total: sorted.length };
    }

    let q = context.supabase.from("transactions").select("*", { count: "exact" }).eq("report_id", rep.id).not("fornecedor", "is", null);
    if (f.fornecedor) q = q.ilike("fornecedor", `%${f.fornecedor}%`);
    if (f.centro_custo) q = q.eq("centro_custo", f.centro_custo);
    if (f.conta) q = q.eq("conta", f.conta);
    if (f.documento) q = q.ilike("documento", `%${f.documento}%`);
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

// Atualiza (ou remove) a Sugestão de Vencimento de uma transação.
export const updateSugestaoVencimento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({
    id: z.number(),
    date: z.string().nullable(),
  }).parse(raw))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("transactions")
      .update({ sugestao_vencimento: data.date })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
