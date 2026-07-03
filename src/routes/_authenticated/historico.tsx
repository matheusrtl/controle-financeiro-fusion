import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listReports, deleteReport } from "@/lib/reports.functions";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateBR } from "@/lib/format";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/historico")({
  component: HistoricoPage,
});

function HistoricoPage() {
  const listFn = useServerFn(listReports);
  const delFn = useServerFn(deleteReport);
  const q = useQuery({ queryKey: ["reports-list"], queryFn: () => listFn() });

  async function onDelete(id: string) {
    if (!confirm("Remover este relatório?")) return;
    try { await delFn({ data: { id } }); q.refetch(); toast.success("Relatório removido."); }
    catch (e: any) { toast.error(e.message); }
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Histórico</h1>
          <p className="text-sm text-muted-foreground">Todas as planilhas enviadas — apenas uma pode estar ativa.</p>
        </div>
      </div>
      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Arquivo</TableHead>
              <TableHead>Upload</TableHead>
              <TableHead>Período</TableHead>
              <TableHead className="text-right">Lançamentos</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(q.data ?? []).map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.filename}</TableCell>
                <TableCell>{new Date(r.uploaded_at).toLocaleString("pt-BR")}</TableCell>
                <TableCell>{formatDateBR(r.period_start)} — {formatDateBR(r.period_end)}</TableCell>
                <TableCell className="text-right tabular-nums">{r.row_count.toLocaleString("pt-BR")}</TableCell>
                <TableCell>
                  {r.status === "active"
                    ? <Badge className="bg-[color:var(--success)]/15 text-[color:var(--success)] border-0">Ativo</Badge>
                    : <Badge variant="outline">Arquivado</Badge>}
                </TableCell>
                <TableCell className="text-right">
                  {r.status !== "active" && (
                    <Button variant="ghost" size="icon" onClick={() => onDelete(r.id)}>
                      <Trash2 className="h-4 w-4 text-[color:var(--destructive)]" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {q.data && q.data.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhum relatório ainda.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </AppShell>
  );
}
