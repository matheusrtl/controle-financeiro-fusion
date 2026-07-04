import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { importReport } from "@/lib/reports.functions";
import { isCurrentUserAdmin } from "@/lib/users.functions";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { UploadCloud, FileSpreadsheet, Loader2, CheckCircle2, Lock } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/_authenticated/upload")({
  component: UploadPage,
});

const REQUIRED_COLUMNS = ["Documento", "Fornecedor - Nome", "Vencimento", "Valor"];

function UploadPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const importFn = useServerFn(importReport);
  const fetchAdmin = useServerFn(isCurrentUserAdmin);
  const adminQ = useQuery({ queryKey: ["is-admin"], queryFn: () => fetchAdmin() });
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState<{ rows: number } | null>(null);

  const onDrop = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { toast.error("Arquivo maior que 20MB"); return; }
    setFile(f); setDone(null);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, maxFiles: 1,
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel": [".xls"],
      "text/csv": [".csv"],
    },
  });

  async function submit() {
    if (!file) return;
    setUploading(true); setProgress(10);
    try {
      const isCsv = /\.csv$/i.test(file.name);
      let headers: string[] = [];
      let payload: { filename: string; base64?: string; csvText?: string };

      if (isCsv) {
        const text = await file.text();
        setProgress(35);
        const wb = XLSX.read(text, { type: "string" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
        headers = rows[0] ? Object.keys(rows[0]).map((h) => h.trim()) : [];
        payload = { filename: file.name, csvText: text };
      } else {
        const buf = await file.arrayBuffer();
        setProgress(30);
        const wb = XLSX.read(new Uint8Array(buf), { type: "array", cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
        headers = rows[0] ? Object.keys(rows[0]).map((h) => h.trim()) : [];
        let bin = "";
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        payload = { filename: file.name, base64: btoa(bin) };
      }

      const missing = REQUIRED_COLUMNS.filter(
        (c) => !headers.some((h) => h.toLowerCase() === c.toLowerCase()),
      );
      if (missing.length) {
        setUploading(false);
        toast.error("Planilha inválida", { description: `Colunas ausentes: ${missing.join(", ")}` });
        return;
      }

      setProgress(60);
      const res = await importFn({ data: payload });
      setProgress(100);
      setDone({ rows: res.rowCount });
      qc.invalidateQueries();
      toast.success("Relatório atualizado com sucesso.", { description: `${res.rowCount.toLocaleString("pt-BR")} lançamentos importados.` });
    } catch (e: any) {
      toast.error("Falha ao importar", { description: e?.message ?? String(e) });
    } finally { setUploading(false); }
  }

  if (adminQ.isLoading) {
    return (
      <AppShell>
        <div className="mx-auto max-w-3xl space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      </AppShell>
    );
  }

  if (!adminQ.data?.isAdmin) {
    return (
      <AppShell>
        <div className="mx-auto max-w-3xl">
          <Card className="p-10 flex flex-col items-center text-center gap-4">
            <div className="rounded-full bg-muted p-4"><Lock className="h-8 w-8 text-muted-foreground" /></div>
            <h1 className="text-xl font-bold">Acesso restrito</h1>
            <p className="text-sm text-muted-foreground max-w-md">
              A importação de relatórios é permitida somente para administradores.
              Solicite acesso a um administrador ou volte ao dashboard.
            </p>
            <Button onClick={() => nav({ to: "/dashboard" })}>Voltar ao dashboard</Button>
          </Card>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold">Novo Upload</h1>
        <p className="text-sm text-muted-foreground">
          Envie a planilha de contas a pagar/receber (.xlsx, .xls ou .csv). O relatório atual será substituído.
        </p>
        <Card className="mt-6 p-6">
          <div
            {...getRootProps()}
            className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 cursor-pointer transition-colors ${
              isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/60 hover:bg-accent/30"
            }`}
          >
            <input {...getInputProps()} />
            <UploadCloud className="h-10 w-10 text-primary" />
            <p className="mt-3 text-sm font-medium">{isDragActive ? "Solte o arquivo aqui" : "Arraste a planilha ou clique para selecionar"}</p>
            <p className="mt-1 text-xs text-muted-foreground">Formatos .xlsx, .xls, .csv (até 20MB)</p>
          </div>

          {file && (
            <div className="mt-6 rounded-lg border bg-muted/30 p-4">
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="h-8 w-8 text-primary" />
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{file.name}</div>
                  <div className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</div>
                </div>
                {done && <CheckCircle2 className="h-5 w-5 text-[color:var(--success)]" />}
              </div>
              {uploading && (
                <div className="mt-3">
                  <Progress value={progress} />
                  <p className="mt-1.5 text-xs text-muted-foreground">Processando…</p>
                </div>
              )}
              {done && (
                <p className="mt-3 text-sm text-[color:var(--success)]">
                  {done.rows.toLocaleString("pt-BR")} lançamentos importados com sucesso.
                </p>
              )}
            </div>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => nav({ to: "/dashboard" })}>Voltar</Button>
            <Button disabled={!file || uploading} onClick={submit} className="gap-2">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              Importar planilha
            </Button>
          </div>
        </Card>

        <Card className="mt-4 p-5 bg-muted/30">
          <h3 className="text-sm font-semibold">Colunas esperadas</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Documento · Fornecedor - Nome · Emissão · Vencimento · Pagamento · Valor · Multa · Juros · Desconto · Valor Pago · Valor em Aberto · Valor Total do Título · Centro de Custo · Observação da Parcela · Observação do Lançamento · Conta
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Obrigatórias: <strong>Documento, Fornecedor - Nome, Vencimento, Valor</strong>.
          </p>
        </Card>
      </div>
    </AppShell>
  );
}
