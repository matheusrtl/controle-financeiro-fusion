import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  getKpis, getCashflowSeries, getAlerts, getBreakdown, listTransactions, getFacets,
} from "@/lib/dashboard.functions";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBRL, formatDateBR, shortMonth } from "@/lib/format";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend,
  PieChart, Pie, Cell, BarChart, LineChart,
} from "recharts";
import {
  ArrowDownCircle, ArrowUpCircle, Wallet, AlertTriangle, CheckCircle2, Clock,
  Search, Download, ChevronLeft, ChevronRight, Settings2,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

type Filters = {
  from?: string; to?: string;
  fornecedor?: string; centro_custo?: string; conta?: string;
  status?: "pago" | "aberto" | "vencido";
  documento?: string;
};

const CHART_COLORS = ["#1565C0", "#2E7D32", "#D32F2F", "#F9A825", "#0D47A1", "#6a1b9a", "#00838f", "#c62828"];

function DashboardPage() {
  const [filters, setFilters] = useState<Filters>({});
  const [granularity, setGranularity] = useState<"day" | "week" | "month" | "year">("month");
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<any | null>(null);
  const [opening, setOpening] = useState<{ value: number; date: string }>(() => {
    if (typeof window === "undefined") return { value: 0, date: "" };
    try {
      const raw = localStorage.getItem("fusion:opening");
      if (raw) return JSON.parse(raw);
    } catch {}
    return { value: 0, date: "" };
  });
  const saveOpening = (v: { value: number; date: string }) => {
    setOpening(v);
    try { localStorage.setItem("fusion:opening", JSON.stringify(v)); } catch {}
  };

  const kpisFn = useServerFn(getKpis);
  const seriesFn = useServerFn(getCashflowSeries);
  const alertsFn = useServerFn(getAlerts);
  const breakdownFn = useServerFn(getBreakdown);
  const listFn = useServerFn(listTransactions);
  const facetsFn = useServerFn(getFacets);

  const kpis = useQuery({ queryKey: ["kpis", filters], queryFn: () => kpisFn({ data: filters }) });
  const series = useQuery({ queryKey: ["series", filters, granularity], queryFn: () => seriesFn({ data: { granularity, filters } }) });
  const alerts = useQuery({ queryKey: ["alerts", filters], queryFn: () => alertsFn({ data: filters }) });
  const byCC = useQuery({ queryKey: ["breakdown-cc", filters], queryFn: () => breakdownFn({ data: { dimension: "centro_custo", filters, limit: 8 } }) });
  const byConta = useQuery({ queryKey: ["breakdown-conta", filters], queryFn: () => breakdownFn({ data: { dimension: "conta", filters, limit: 8 } }) });
  const topFornec = useQuery({ queryKey: ["top-fornec", filters], queryFn: () => breakdownFn({ data: { dimension: "fornecedor", filters, limit: 10 } }) });
  const list = useQuery({ queryKey: ["tx", filters, page], queryFn: () => listFn({ data: { filters, page, pageSize: 25 } }) });
  const facets = useQuery({ queryKey: ["facets"], queryFn: () => facetsFn() });

  const chartData = useMemo(() => (series.data ?? []).map((b) => ({
    ...b, label: granularity === "month" ? shortMonth(b.bucket) : b.bucket,
  })), [series.data, granularity]);

  return (
    <AppShell>
      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 shadow-[var(--shadow-card)]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Documento…" className="w-40 pl-8"
            value={filters.documento ?? ""} onChange={(e) => setFilters({ ...filters, documento: e.target.value || undefined })}
          />
        </div>
        <Input placeholder="Fornecedor…" className="w-48"
          value={filters.fornecedor ?? ""} onChange={(e) => setFilters({ ...filters, fornecedor: e.target.value || undefined })} />
        <FSelect label="Centro de Custo" value={filters.centro_custo} options={facets.data?.centros ?? []}
          onChange={(v) => setFilters({ ...filters, centro_custo: v })} />
        <FSelect label="Conta" value={filters.conta} options={facets.data?.contas ?? []}
          onChange={(v) => setFilters({ ...filters, conta: v })} />
        <FSelect label="Status" value={filters.status} options={["aberto", "pago", "vencido"]}
          onChange={(v) => setFilters({ ...filters, status: v as any })} />
        <Input type="date" className="w-40" value={filters.from ?? ""} onChange={(e) => setFilters({ ...filters, from: e.target.value || undefined })} />
        <Input type="date" className="w-40" value={filters.to ?? ""} onChange={(e) => setFilters({ ...filters, to: e.target.value || undefined })} />
        {Object.values(filters).some(Boolean) && (
          <Button variant="ghost" size="sm" onClick={() => setFilters({})}>Limpar filtros</Button>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
        <KpiCard title="Receber" value={kpis.data?.receber.total} tone="success" icon={<ArrowDownCircle className="h-4 w-4" />}
          breakdown={[
            ["Hoje", kpis.data?.receber.hoje], ["Amanhã", kpis.data?.receber.amanha],
            ["7 dias", kpis.data?.receber.d7], ["30 dias", kpis.data?.receber.d30],
          ]} />
        <KpiCard title="Pagar" value={kpis.data?.pagar.total} tone="destructive" icon={<ArrowUpCircle className="h-4 w-4" />}
          breakdown={[
            ["Hoje", kpis.data?.pagar.hoje], ["Amanhã", kpis.data?.pagar.amanha],
            ["7 dias", kpis.data?.pagar.d7], ["30 dias", kpis.data?.pagar.d30],
          ]} />
        <KpiCard title="Saldo Projetado" value={kpis.data?.saldo} tone="info" icon={<Wallet className="h-4 w-4" />} big />
        <KpiCard title="Em Aberto" value={kpis.data?.emAberto} tone="warning" icon={<Clock className="h-4 w-4" />} big />
        <KpiCard title="Pago" value={kpis.data?.pago} tone="success" icon={<CheckCircle2 className="h-4 w-4" />} big />
        <KpiCard title="Vencidos" value={kpis.data?.vencidos.total} tone="destructive" icon={<AlertTriangle className="h-4 w-4" />}
          badge={`${kpis.data?.vencidos.count ?? 0} títulos`} big />
      </div>

      {/* Chart + alerts */}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold">Fluxo de Caixa</h2>
              <p className="text-xs text-muted-foreground">Receber, Pagar e Saldo acumulado</p>
            </div>
            <Tabs value={granularity} onValueChange={(v) => setGranularity(v as any)}>
              <TabsList>
                <TabsTrigger value="day">Dia</TabsTrigger>
                <TabsTrigger value="week">Semana</TabsTrigger>
                <TabsTrigger value="month">Mês</TabsTrigger>
                <TabsTrigger value="year">Ano</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="h-[340px]">
            <ResponsiveContainer>
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
                <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                  tickFormatter={(v) => Intl.NumberFormat("pt-BR", { notation: "compact" }).format(v)} />
                <RTooltip content={<ChartTooltip />} />
                <Legend />
                <Bar dataKey="receber" name="Receber" fill="#2E7D32" radius={[4, 4, 0, 0]} />
                <Bar dataKey="pagar" name="Pagar" fill="#D32F2F" radius={[4, 4, 0, 0]} />
                <Line dataKey="saldo" name="Saldo" stroke="#1565C0" strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-lg font-bold">Alertas</h2>
          <div className="space-y-4 text-sm">
            <AlertSection title="Vencidos" tone="destructive" items={(alerts.data?.vencidos ?? []).map((v) => ({
              key: `v-${v.id}`, primary: v.fornecedor ?? "—",
              secondary: `${v.atraso} dias · ${formatDateBR(v.vencimento)}`,
              value: v.valor_aberto,
            }))} />
            <AlertSection title="Vencem hoje" tone="warning" items={(alerts.data?.hoje ?? []).map((v) => ({
              key: `h-${v.id}`, primary: v.fornecedor ?? "—", secondary: v.documento ?? "", value: v.valor_aberto,
            }))} />
            <AlertSection title="Vencem amanhã" tone="warning" items={(alerts.data?.amanha ?? []).map((v) => ({
              key: `a-${v.id}`, primary: v.fornecedor ?? "—", secondary: v.documento ?? "", value: v.valor_aberto,
            }))} />
            <AlertSection title="Top 10 a pagar" tone="destructive" items={(alerts.data?.topPagar ?? []).map((v) => ({
              key: `tp-${v.id}`, primary: v.fornecedor ?? "—", secondary: formatDateBR(v.vencimento), value: v.valor,
            }))} />
          </div>
        </Card>
      </div>

      {/* Secondary charts grid */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground">Distribuição por Centro de Custo</h3>
          <div className="h-[260px]">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={byCC.data ?? []} dataKey="total" nameKey="key" outerRadius={90} label={(e) => e.key}>
                  {(byCC.data ?? []).map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <RTooltip formatter={(v: number) => formatBRL(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground">Distribuição por Conta</h3>
          <div className="h-[260px]">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={byConta.data ?? []} dataKey="total" nameKey="key" outerRadius={90} label={(e) => e.key}>
                  {(byConta.data ?? []).map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <RTooltip formatter={(v: number) => formatBRL(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-4 lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground">Top 10 Fornecedores</h3>
          <div className="h-[300px]">
            <ResponsiveContainer>
              <BarChart data={topFornec.data ?? []} layout="vertical" margin={{ left: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" tickFormatter={(v) => Intl.NumberFormat("pt-BR", { notation: "compact" }).format(v)} />
                <YAxis dataKey="key" type="category" width={160} tick={{ fontSize: 11 }} />
                <RTooltip formatter={(v: number) => formatBRL(v)} />
                <Bar dataKey="total" fill="#1565C0" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Table */}
      <Card className="mt-4 p-0 overflow-hidden">
        <div className="flex items-center justify-between border-b p-4">
          <div>
            <h3 className="text-base font-bold">Lançamentos</h3>
            <p className="text-xs text-muted-foreground">
              {list.data ? `${list.data.total.toLocaleString("pt-BR")} títulos` : "carregando…"}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => exportCsv(list.data?.rows ?? [])} className="gap-2">
            <Download className="h-4 w-4" /> Exportar CSV
          </Button>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Documento</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead>Emissão</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Pagamento</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right">Pago</TableHead>
                <TableHead className="text-right">Aberto</TableHead>
                <TableHead>Centro Custo</TableHead>
                <TableHead>Conta</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(list.data?.rows ?? []).map((r: any) => (
                <TableRow key={r.id} onClick={() => setDetail(r)} className="cursor-pointer">
                  <TableCell className="font-medium">{r.documento ?? "—"}</TableCell>
                  <TableCell className="max-w-[220px] truncate">{r.fornecedor ?? "—"}</TableCell>
                  <TableCell>{formatDateBR(r.emissao)}</TableCell>
                  <TableCell>{formatDateBR(r.vencimento)}</TableCell>
                  <TableCell>{formatDateBR(r.pagamento)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatBRL(r.valor)}</TableCell>
                  <TableCell className="text-right tabular-nums text-[color:var(--success)]">{formatBRL(r.valor_pago)}</TableCell>
                  <TableCell className="text-right tabular-nums text-[color:var(--destructive)]">{formatBRL(r.valor_aberto)}</TableCell>
                  <TableCell className="max-w-[140px] truncate">{r.centro_custo ?? "—"}</TableCell>
                  <TableCell className="max-w-[120px] truncate">{r.conta ?? "—"}</TableCell>
                  <TableCell><StatusBadge status={r.status} /></TableCell>
                </TableRow>
              ))}
              {list.data && list.data.rows.length === 0 && (
                <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                  Nenhum lançamento — importe uma planilha em <b>Novo Upload</b>.
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between border-t p-3">
          <span className="text-xs text-muted-foreground">Página {page + 1} de {Math.max(1, Math.ceil((list.data?.total ?? 0) / 25))}</span>
          <div className="flex gap-1">
            <Button variant="outline" size="icon" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="icon"
              disabled={!list.data || (page + 1) * 25 >= list.data.total}
              onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      </Card>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Detalhes do lançamento</DialogTitle></DialogHeader>
          {detail && <DetailGrid row={detail} />}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function FSelect({ label, value, options, onChange }: { label: string; value?: string; options: string[]; onChange: (v?: string) => void }) {
  return (
    <Select value={value ?? "__all"} onValueChange={(v) => onChange(v === "__all" ? undefined : v)}>
      <SelectTrigger className="w-[180px]"><SelectValue placeholder={label} /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__all">{label} — todos</SelectItem>
        {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function KpiCard({ title, value, tone, icon, breakdown, badge, big }: {
  title: string; value?: number; tone: "success" | "destructive" | "info" | "warning";
  icon: React.ReactNode; breakdown?: [string, number | undefined][]; badge?: string; big?: boolean;
}) {
  const toneCls = {
    success: "text-[color:var(--success)] bg-[color:var(--success)]/10",
    destructive: "text-[color:var(--destructive)] bg-[color:var(--destructive)]/10",
    info: "text-primary bg-primary/10",
    warning: "text-[color:var(--warning)] bg-[color:var(--warning)]/10",
  }[tone];
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <Card className="p-4 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] transition-shadow">
        <div className="flex items-center gap-2">
          <div className={`inline-flex h-8 w-8 items-center justify-center rounded-md ${toneCls}`}>{icon}</div>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
          {badge && <Badge variant="outline" className="ml-auto text-[10px]">{badge}</Badge>}
        </div>
        <div className={`mt-2 font-bold tabular-nums ${big ? "text-2xl" : "text-xl"}`}>{formatBRL(value)}</div>
        {breakdown && (
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {breakdown.map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span>{k}</span><span className="tabular-nums text-foreground">{formatBRL(v ?? 0)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </motion.div>
  );
}

function AlertSection({ title, tone, items }: { title: string; tone: "destructive" | "warning"; items: { key: string; primary: string; secondary: string; value: number }[] }) {
  const toneCls = tone === "destructive" ? "text-[color:var(--destructive)]" : "text-[color:var(--warning)]";
  return (
    <div>
      <div className={`mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${toneCls}`}>
        {title} <span className="text-muted-foreground font-normal">({items.length})</span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nada por aqui.</p>
      ) : (
        <ul className="space-y-1">
          {items.slice(0, 6).map((it) => (
            <li key={it.key} className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-2 py-1.5">
              <div className="min-w-0">
                <div className="truncate text-xs font-medium">{it.primary}</div>
                <div className="truncate text-[10px] text-muted-foreground">{it.secondary}</div>
              </div>
              <div className={`shrink-0 text-xs font-semibold tabular-nums ${toneCls}`}>{formatBRL(it.value)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = {
    pago: "bg-[color:var(--success)]/15 text-[color:var(--success)]",
    aberto: "bg-[color:var(--warning)]/15 text-[color:var(--warning-foreground)] border border-[color:var(--warning)]/40",
    vencido: "bg-[color:var(--destructive)]/15 text-[color:var(--destructive)]",
  }[status] ?? "bg-muted";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${cls}`}>{status}</span>;
}

function DetailGrid({ row }: { row: any }) {
  const cells: [string, React.ReactNode][] = [
    ["Documento", row.documento], ["Fornecedor", row.fornecedor], ["Conta", row.conta],
    ["Centro de Custo", row.centro_custo], ["Emissão", formatDateBR(row.emissao)],
    ["Vencimento", formatDateBR(row.vencimento)], ["Pagamento", formatDateBR(row.pagamento)],
    ["Valor", formatBRL(row.valor)], ["Multa", formatBRL(row.multa)],
    ["Juros", formatBRL(row.juros)], ["Desconto", formatBRL(row.desconto)],
    ["Valor Pago", formatBRL(row.valor_pago)], ["Valor Aberto", formatBRL(row.valor_aberto)],
    ["Valor Total", formatBRL(row.valor_total)], ["Status", <StatusBadge status={row.status} />],
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        {cells.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2 border-b py-1.5 last:border-none">
            <span className="text-muted-foreground">{k}</span>
            <span className="font-medium text-right">{v ?? "—"}</span>
          </div>
        ))}
      </div>
      {row.obs_parcela && <p className="text-xs"><b>Obs. Parcela:</b> {row.obs_parcela}</p>}
      {row.obs_lancamento && <p className="text-xs"><b>Obs. Lançamento:</b> {row.obs_lancamento}</p>}
    </div>
  );
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload ?? {};
  return (
    <div className="rounded-lg border bg-card p-3 shadow-lg text-xs">
      <div className="mb-1 font-semibold">{label}</div>
      <Row label="Receber" value={formatBRL(p.receber)} color="#2E7D32" />
      <Row label="Pagar" value={formatBRL(p.pagar)} color="#D32F2F" />
      <Row label="Diferença" value={formatBRL(p.diferenca)} color="#0D47A1" />
      <Row label="Saldo" value={formatBRL(p.saldo)} color="#1565C0" />
      <Row label="Títulos" value={String(p.qtd ?? 0)} color="#666" />
    </div>
  );
}
function Row({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span style={{ color }}>{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function exportCsv(rows: any[]) {
  if (!rows.length) { toast.info("Nenhum lançamento para exportar."); return; }
  const cols = ["documento", "fornecedor", "emissao", "vencimento", "pagamento", "valor", "multa", "juros", "desconto", "valor_pago", "valor_aberto", "valor_total", "centro_custo", "conta", "status"];
  const csv = [cols.join(";"), ...rows.map((r) => cols.map((c) => JSON.stringify(r[c] ?? "")).join(";"))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `lancamentos-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
