import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import {
  getKpis, getCashflowSeries, getAlerts, getBreakdown, listTransactions, getFacets,
  updateSugestaoVencimento,
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
  PieChart, Pie, Cell, BarChart,
} from "recharts";
import {
  ArrowUpCircle, Wallet, AlertTriangle, CheckCircle2, Clock,
  Search, Download, ChevronLeft, ChevronRight, Settings2, CalendarClock, RotateCcw, X,
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

type PeriodPreset = "day" | "week" | "month" | "year" | "custom";
type Period = { preset: PeriodPreset; from?: string; to?: string; granularity: "day" | "week" | "month" | "year" };

function computePeriod(preset: PeriodPreset, currentFrom?: string, currentTo?: string): Period {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const iso = (dt: Date) => dt.toISOString().slice(0, 10);
  const today = iso(new Date(Date.UTC(y, m, d)));
  if (preset === "day") return { preset, from: today, to: today, granularity: "day" };
  if (preset === "week") {
    const dow = new Date(Date.UTC(y, m, d)).getUTCDay(); // 0=dom
    const start = new Date(Date.UTC(y, m, d - dow));
    const end = new Date(Date.UTC(y, m, d - dow + 6));
    return { preset, from: iso(start), to: iso(end), granularity: "day" };
  }
  if (preset === "month") {
    const start = new Date(Date.UTC(y, m, 1));
    const end = new Date(Date.UTC(y, m + 1, 0));
    return { preset, from: iso(start), to: iso(end), granularity: "day" };
  }
  if (preset === "year") {
    return { preset, from: `${y}-01-01`, to: `${y}-12-31`, granularity: "month" };
  }
  return { preset: "custom", from: currentFrom, to: currentTo, granularity: "month" };
}

function DashboardPage() {
  const [period, setPeriod] = useState<Period>(() => computePeriod("month"));
  const [filters, setFilters] = useState<Omit<Filters, "from" | "to">>({});
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<any | null>(null);
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
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

  // Filtro efetivo = filtros textuais + intervalo do período global.
  const effectiveFilters: Filters = useMemo(
    () => ({ ...filters, from: period.from, to: period.to }),
    [filters, period]
  );

  // Ao mudar granularidade/período, limpa o drill.
  useEffect(() => { setSelectedBucket(null); }, [period.granularity, period.from, period.to]);

  // Drill: reduz o intervalo ao bucket selecionado.
  const drillRange = useMemo(() => bucketToRange(selectedBucket, period.granularity), [selectedBucket, period.granularity]);
  const drillFilters: Filters = useMemo(
    () => (drillRange ? { ...effectiveFilters, from: drillRange.from, to: drillRange.to } : effectiveFilters),
    [effectiveFilters, drillRange]
  );
  const drillLabel = useMemo(() => {
    if (!drillRange) return "";
    if (drillRange.from === drillRange.to) return formatDateBR(drillRange.from);
    return `${formatDateBR(drillRange.from)} → ${formatDateBR(drillRange.to)}`;
  }, [drillRange]);


  const kpisFn = useServerFn(getKpis);
  const seriesFn = useServerFn(getCashflowSeries);
  const alertsFn = useServerFn(getAlerts);
  const breakdownFn = useServerFn(getBreakdown);
  const listFn = useServerFn(listTransactions);
  const facetsFn = useServerFn(getFacets);
  const updSugestaoFn = useServerFn(updateSugestaoVencimento);

  const qc = useQueryClient();
  const mutSugestao = useMutation({
    mutationFn: (v: { id: number; date: string | null }) => updSugestaoFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpis"] });
      qc.invalidateQueries({ queryKey: ["series"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["breakdown-cc"] });
      qc.invalidateQueries({ queryKey: ["breakdown-conta"] });
      qc.invalidateQueries({ queryKey: ["top-fornec"] });
      qc.invalidateQueries({ queryKey: ["tx"] });
      toast.success("Sugestão de vencimento atualizada");
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao atualizar"),
  });

  const kpis = useQuery({ queryKey: ["kpis", effectiveFilters], queryFn: () => kpisFn({ data: effectiveFilters }) });
  const series = useQuery({
    queryKey: ["series", effectiveFilters, period.granularity, opening],
    queryFn: () => seriesFn({ data: { granularity: period.granularity, filters: effectiveFilters, openingBalance: opening.value || 0, openingDate: opening.date || undefined } }),
  });
  const alerts = useQuery({ queryKey: ["alerts", effectiveFilters], queryFn: () => alertsFn({ data: effectiveFilters }) });
  const byCC = useQuery({ queryKey: ["breakdown-cc", drillFilters], queryFn: () => breakdownFn({ data: { dimension: "centro_custo", filters: drillFilters, limit: 8 } }) });
  const byConta = useQuery({ queryKey: ["breakdown-conta", drillFilters], queryFn: () => breakdownFn({ data: { dimension: "conta", filters: drillFilters, limit: 8 } }) });
  const topFornec = useQuery({ queryKey: ["top-fornec", drillFilters], queryFn: () => breakdownFn({ data: { dimension: "fornecedor", filters: drillFilters, limit: 10 } }) });
  const list = useQuery({ queryKey: ["tx", effectiveFilters, page], queryFn: () => listFn({ data: { filters: effectiveFilters, page, pageSize: 25 } }) });
  const facets = useQuery({ queryKey: ["facets"], queryFn: () => facetsFn() });

  useEffect(() => { setPage(0); }, [effectiveFilters]);

  const chartData = useMemo(() => (series.data ?? []).map((b) => ({
    ...b, label: period.granularity === "month" ? shortMonth(b.bucket) : b.bucket,
  })), [series.data, period.granularity]);

  const periodLabel: Record<PeriodPreset, string> = {
    day: "Hoje", week: "Semana", month: "Mês", year: "Ano", custom: "Personalizado",
  };

  return (
    <AppShell>
      {/* Global period + filters */}
      <div className="mb-4 space-y-2 rounded-xl border bg-card p-3 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase text-muted-foreground">Período</span>
          <Tabs value={period.preset} onValueChange={(v) => setPeriod(computePeriod(v as PeriodPreset, period.from, period.to))}>
            <TabsList>
              <TabsTrigger value="day">Dia</TabsTrigger>
              <TabsTrigger value="week">Semana</TabsTrigger>
              <TabsTrigger value="month">Mês</TabsTrigger>
              <TabsTrigger value="year">Ano</TabsTrigger>
              <TabsTrigger value="custom">Personalizado</TabsTrigger>
            </TabsList>
          </Tabs>
          {period.preset === "custom" && (
            <>
              <Input type="date" className="w-40" value={period.from ?? ""}
                onChange={(e) => setPeriod({ ...period, preset: "custom", from: e.target.value || undefined })} />
              <Input type="date" className="w-40" value={period.to ?? ""}
                onChange={(e) => setPeriod({ ...period, preset: "custom", to: e.target.value || undefined })} />
              <FSelect label="Granularidade" value={period.granularity}
                options={["day", "week", "month", "year"]}
                onChange={(v) => setPeriod({ ...period, granularity: (v as any) ?? "month" })} />
            </>
          )}
          {period.from && period.to && (
            <span className="ml-auto text-xs text-muted-foreground">
              {periodLabel[period.preset]} · {formatDateBR(period.from)} → {formatDateBR(period.to)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          {Object.values(filters).some(Boolean) && (
            <Button variant="ghost" size="sm" onClick={() => setFilters({})}>Limpar filtros</Button>
          )}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          title={`Pago em ${periodLabel[period.preset]}`}
          value={kpis.data?.pagoPeriodo}
          tone="success"
          icon={<CheckCircle2 className="h-4 w-4" />}
          badge={`${kpis.data?.pagoPeriodoCount ?? 0} títulos`}
          big
        />
        <KpiCard title="A Pagar" value={kpis.data?.pagar.total} tone="destructive" icon={<ArrowUpCircle className="h-4 w-4" />}
          breakdown={[
            ["Hoje", kpis.data?.pagar.hoje], ["Amanhã", kpis.data?.pagar.amanha],
            ["7 dias", kpis.data?.pagar.d7], ["30 dias", kpis.data?.pagar.d30],
          ]} />
        <SaldoPrevistoCard
          opening={opening}
          vencido={kpis.data?.vencidos.total ?? 0}
          aVencer={kpis.data?.aVencer?.total ?? 0}
          onEditOpening={saveOpening}
        />
        <KpiCard title="A Vencer" value={kpis.data?.aVencer?.total} tone="warning" icon={<Clock className="h-4 w-4" />}
          badge={`${kpis.data?.aVencer?.count ?? 0} títulos`} big />
        <KpiCard title="Vencidos" value={kpis.data?.vencidos.total} tone="destructive" icon={<AlertTriangle className="h-4 w-4" />}
          badge={`${kpis.data?.vencidos.count ?? 0} títulos`} big />
      </div>


      {/* Chart (full width) */}
      <div className="mt-4">
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold">Fluxo de Caixa (Despesas)</h2>
              <p className="text-xs text-muted-foreground">
                Despesas (barras · esquerda) e Saldo projetado (linha · direita). Clique numa barra para filtrar os gráficos abaixo pelo período.
                {opening.date && opening.value ? ` · Saldo inicial ${formatBRL(opening.value)} em ${formatDateBR(opening.date)}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <OpeningBalancePopover opening={opening} onSave={saveOpening} />
            </div>
          </div>
          <div className="h-[380px]">
            <ResponsiveContainer>
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
                <YAxis yAxisId="left" tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                  tickFormatter={(v) => Intl.NumberFormat("pt-BR", { notation: "compact" }).format(v)} />
                <YAxis yAxisId="right" orientation="right"
                  tick={{ fill: "#1565C0", fontSize: 12 }}
                  tickFormatter={(v) => Intl.NumberFormat("pt-BR", { notation: "compact" }).format(v)} />
                <RTooltip content={<ChartTooltip />} />
                <Legend />
                <Bar
                  yAxisId="left" dataKey="pagar" name="Despesa" radius={[4, 4, 0, 0]}
                  cursor="pointer"
                  onClick={(d: any) => {
                    const b = d?.bucket ?? d?.payload?.bucket;
                    if (!b) return;
                    setSelectedBucket((prev) => (prev === b ? null : b));
                  }}
                >
                  {chartData.map((entry) => (
                    <Cell
                      key={entry.bucket}
                      fill="#D32F2F"
                      fillOpacity={selectedBucket == null ? 1 : selectedBucket === entry.bucket ? 1 : 0.25}
                      stroke={selectedBucket === entry.bucket ? "#1565C0" : "none"}
                      strokeWidth={selectedBucket === entry.bucket ? 2 : 0}
                    />
                  ))}
                </Bar>
                <Line yAxisId="right" dataKey="saldo" name="Saldo" stroke="#1565C0" strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Alerts (full width) */}
      <div className="mt-4">
        <Card className="p-4">
          <h2 className="mb-3 text-lg font-bold">Alertas</h2>
          <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2 xl:grid-cols-4">
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

      {/* Drill filter banner */}
      {selectedBucket && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          <span className="text-xs font-semibold uppercase text-primary">Filtro ativo</span>
          <span className="font-semibold">{drillLabel}</span>
          <span className="text-xs text-muted-foreground">nos gráficos analíticos abaixo</span>
          <Button variant="ghost" size="sm" className="ml-auto h-7 gap-1 px-2 text-xs" onClick={() => setSelectedBucket(null)}>
            <X className="h-3.5 w-3.5" /> Limpar filtro
          </Button>
        </div>
      )}

      {/* Secondary charts grid */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SmartPie title="Distribuição por Centro de Custo" data={byCC.data ?? []} />
        <SmartPie title="Distribuição por Conta" data={byConta.data ?? []} />

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
                <TableHead>Sugestão Vencimento</TableHead>
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
                <TableRow key={r.id} className="cursor-pointer">
                  <TableCell className="font-medium" onClick={() => setDetail(r)}>{r.documento ?? "—"}</TableCell>
                  <TableCell className="max-w-[220px] truncate" onClick={() => setDetail(r)}>{r.fornecedor ?? "—"}</TableCell>
                  <TableCell onClick={() => setDetail(r)}>{formatDateBR(r.emissao)}</TableCell>
                  <TableCell onClick={() => setDetail(r)}>{formatDateBR(r.vencimento)}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <SugestaoVencimentoCell
                      row={r}
                      onSave={(date) => mutSugestao.mutate({ id: r.id, date })}
                      pending={mutSugestao.isPending && mutSugestao.variables?.id === r.id}
                    />
                  </TableCell>
                  <TableCell onClick={() => setDetail(r)}>{formatDateBR(r.pagamento)}</TableCell>
                  <TableCell className="text-right tabular-nums" onClick={() => setDetail(r)}>{formatBRL(r.valor)}</TableCell>
                  <TableCell className="text-right tabular-nums text-[color:var(--success)]" onClick={() => setDetail(r)}>{formatBRL(r.valor_pago)}</TableCell>
                  <TableCell className="text-right tabular-nums text-[color:var(--destructive)]" onClick={() => setDetail(r)}>{formatBRL(r.valor_aberto)}</TableCell>
                  <TableCell className="max-w-[140px] truncate" onClick={() => setDetail(r)}>{r.centro_custo ?? "—"}</TableCell>
                  <TableCell className="max-w-[120px] truncate" onClick={() => setDetail(r)}>{r.conta ?? "—"}</TableCell>
                  <TableCell onClick={() => setDetail(r)}><StatusBadge status={r.status} /></TableCell>
                </TableRow>
              ))}
              {list.data && list.data.rows.length === 0 && (
                <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground py-8">
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
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="h-full">
      <Card className="flex h-full flex-col p-4 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] transition-shadow">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${toneCls}`}>{icon}</div>
          <span className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
          {badge && <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">{badge}</Badge>}
        </div>
        <div
          className={`mt-2 font-bold tabular-nums leading-tight break-words ${big ? "text-xl xl:text-2xl" : "text-lg xl:text-xl"}`}
          title={formatBRL(value)}
        >
          {formatBRL(value)}
        </div>
        {breakdown && (
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {breakdown.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-1 min-w-0">
                <span className="shrink-0">{k}</span>
                <span className="truncate tabular-nums text-foreground" title={formatBRL(v ?? 0)}>{formatBRL(v ?? 0)}</span>
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
    ["Vencimento", formatDateBR(row.vencimento)],
    ["Sugestão Vencimento", formatDateBR(row.sugestao_vencimento)],
    ["Pagamento", formatDateBR(row.pagamento)],
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
      <Row label="Despesa" value={formatBRL(p.pagar)} color="#D32F2F" />
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

function OpeningBalancePopover({ opening, onSave, compact }: { opening: { value: number; date: string }; onSave: (v: { value: number; date: string }) => void; compact?: boolean }) {
  const [value, setValue] = useState(String(opening.value ?? 0));
  const [date, setDate] = useState(opening.date ?? "");
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {compact ? (
          <Button variant="ghost" size="icon" className="ml-auto h-7 w-7 shrink-0" title="Configurar saldo inicial">
            <Settings2 className="h-4 w-4" />
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="gap-2">
            <Settings2 className="h-4 w-4" />
            Saldo inicial
          </Button>
        )}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-72 space-y-3">
        <div>
          <h4 className="text-sm font-semibold">Saldo inicial</h4>
          <p className="text-xs text-muted-foreground">Define o ponto de partida do saldo. O saldo apenas diminui a partir daqui.</p>
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Data de referência</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Valor (R$)</Label>
          <Input type="number" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0,00" />
        </div>
        <div className="flex justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => { onSave({ value: 0, date: "" }); setValue("0"); setDate(""); setOpen(false); toast.success("Saldo inicial removido"); }}>
            Limpar
          </Button>
          <Button size="sm" onClick={() => { onSave({ value: Number(value) || 0, date }); setOpen(false); toast.success("Saldo inicial atualizado"); }}>
            Salvar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SugestaoVencimentoCell({ row, onSave, pending }: { row: any; onSave: (date: string | null) => void; pending: boolean }) {
  const effective = row.sugestao_vencimento ?? row.vencimento;
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(row.sugestao_vencimento ?? row.vencimento ?? "");
  const overridden = !!row.sugestao_vencimento;
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setVal(row.sugestao_vencimento ?? row.vencimento ?? ""); }}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost" size="sm"
          className={`h-7 gap-1 px-2 text-xs ${overridden ? "text-primary font-semibold" : "text-muted-foreground"}`}
          disabled={pending}
        >
          <CalendarClock className="h-3.5 w-3.5" />
          {formatDateBR(effective)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-2">
        <div className="space-y-1">
          <Label className="text-xs">Sugestão de Vencimento</Label>
          <Input type="date" value={val} onChange={(e) => setVal(e.target.value)} />
          <p className="text-[10px] text-muted-foreground">Original: {formatDateBR(row.vencimento)}</p>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost" size="sm" className="gap-1"
            onClick={() => { onSave(null); setOpen(false); }}
            disabled={!overridden}
            title="Voltar para o vencimento original"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Restaurar
          </Button>
          <Button size="sm" onClick={() => { onSave(val || null); setOpen(false); }} disabled={!val}>
            Salvar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}


function exportCsv(rows: any[]) {
  if (!rows.length) { toast.info("Nenhum lançamento para exportar."); return; }
  const cols = ["documento", "fornecedor", "emissao", "vencimento", "sugestao_vencimento", "pagamento", "valor", "multa", "juros", "desconto", "valor_pago", "valor_aberto", "valor_total", "centro_custo", "conta", "status"];
  const csv = [cols.join(";"), ...rows.map((r) => cols.map((c) => JSON.stringify(r[c] ?? "")).join(";"))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `lancamentos-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

type Scope = "none" | "vencido" | "aberto" | "ambos";

function SaldoPrevistoCard({
  opening, vencido, aVencer, onEditOpening,
}: {
  opening: { value: number; date: string };
  vencido: number; aVencer: number;
  onEditOpening: (v: { value: number; date: string }) => void;
}) {
  const [scope, setScope] = useState<Scope>(() => {
    if (typeof window === "undefined") return "ambos";
    return (localStorage.getItem("fusion:saldoScope") as Scope) || "ambos";
  });
  const setScopePersist = (s: Scope) => {
    setScope(s);
    try { localStorage.setItem("fusion:saldoScope", s); } catch {}
  };
  // Sistema de despesas: saldo previsto = inicial - despesas consideradas (nunca aumenta).
  const considerado =
    (scope === "vencido" || scope === "ambos" ? vencido : 0) +
    (scope === "aberto" || scope === "ambos" ? aVencer : 0);
  const saldo = (opening.value || 0) - considerado;
  const positivo = saldo >= 0;

  const scopeLabel: Record<Scope, string> = {
    none: "somente inicial",
    vencido: "− vencidos",
    aberto: "− a vencer",
    ambos: "− vencidos e a vencer",
  };

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="h-full">
      <Card className="flex h-full flex-col p-4 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] transition-shadow">
        <div className="flex items-center gap-2 min-w-0">
          <div className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-primary bg-primary/10">
            <Wallet className="h-4 w-4" />
          </div>
          <span className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">Saldo Previsto</span>
          <OpeningBalancePopover opening={opening} onSave={onEditOpening} compact />
        </div>
        <div
          className={`mt-2 text-xl xl:text-2xl font-bold tabular-nums leading-tight break-words ${positivo ? "text-[color:var(--success)]" : "text-[color:var(--destructive)]"}`}
          title={formatBRL(saldo)}
        >
          {formatBRL(saldo)}
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground truncate" title={`Inicial ${formatBRL(opening.value || 0)}${opening.date ? " · " + formatDateBR(opening.date) : ""}`}>
          {opening.value ? `Inicial ${formatBRL(opening.value)}` : "Defina o saldo inicial"} · {scopeLabel[scope]}
        </p>
        <div className="mt-3 grid grid-cols-4 gap-1">
          {(["none", "vencido", "aberto", "ambos"] as Scope[]).map((s) => (
            <button
              key={s}
              onClick={() => setScopePersist(s)}
              className={`rounded-md border px-1 py-1 text-[10px] font-semibold uppercase transition-colors ${
                scope === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent"
              }`}
              title={scopeLabel[s]}
            >
              {s === "none" ? "Base" : s === "vencido" ? "−Venc" : s === "aberto" ? "−Aberto" : "Todos"}
            </button>
          ))}
        </div>
      </Card>
    </motion.div>
  );
}

const PIE_PALETTE = [
  "#1565C0", "#2E7D32", "#F57C00", "#8E24AA", "#00838F",
  "#C62828", "#455A64", "#6D4C41", "#5E35B1", "#EF6C00",
  "#00695C", "#AD1457",
];

function SmartPie({ title, data, maxSlices = 8 }: { title: string; data: { key: string; total: number }[]; maxSlices?: number }) {
  const grouped = useMemo(() => {
    const clean = (data ?? []).filter((d) => d.total > 0).sort((a, b) => b.total - a.total);
    if (clean.length <= maxSlices) return clean;
    const head = clean.slice(0, maxSlices - 1);
    const tail = clean.slice(maxSlices - 1);
    const outros = tail.reduce((s, r) => s + r.total, 0);
    return [...head, { key: `Outros (${tail.length})`, total: outros }];
  }, [data, maxSlices]);
  const total = grouped.reduce((s, r) => s + r.total, 0) || 1;

  return (
    <Card className="p-4">
      <h3 className="mb-3 text-sm font-semibold text-muted-foreground">{title}</h3>
      {grouped.length === 0 ? (
        <div className="grid h-[260px] place-items-center text-xs text-muted-foreground">Sem dados</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px]">
          <div className="h-[260px]">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={grouped}
                  dataKey="total"
                  nameKey="key"
                  innerRadius={55}
                  outerRadius={95}
                  paddingAngle={1.5}
                  stroke="var(--card)"
                  strokeWidth={2}
                >
                  {grouped.map((_, i) => <Cell key={i} fill={PIE_PALETTE[i % PIE_PALETTE.length]} />)}
                </Pie>
                <RTooltip
                  content={({ active, payload }: any) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0];
                    const pct = ((p.value / total) * 100).toFixed(1);
                    return (
                      <div className="rounded-lg border bg-card p-2 text-xs shadow-lg">
                        <div className="font-semibold">{p.name}</div>
                        <div className="tabular-nums">{formatBRL(p.value)} · {pct}%</div>
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="max-h-[260px] overflow-auto space-y-1 text-xs">
            {grouped.map((g, i) => {
              const pct = ((g.total / total) * 100).toFixed(1);
              return (
                <li key={g.key} className="flex items-center gap-2 min-w-0">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: PIE_PALETTE[i % PIE_PALETTE.length] }} />
                  <span className="truncate flex-1" title={g.key}>{g.key}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{pct}%</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}
