import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { importReport } from "@/lib/reports.functions";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { UploadCloud, FileSpreadsheet, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/upload")({
  component: UploadPage,
});

function UploadPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const importFn = useServerFn(importReport);
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
    accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"], "application/vnd.ms-excel": [".xls"] },
  });

  async function submit() {
    if (!file) return;
    setUploading(true); setProgress(15);
    try {
      const buf = await file.arrayBuffer();
      setProgress(35);
      let bin = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const base64 = btoa(bin);
      setProgress(55);
      const res = await importFn({ data: { filename: file.name, base64 } });
      setProgress(100);
      setDone({ rows: res.rowCount });
      qc.invalidateQueries();
      toast.success("Relatório atualizado com sucesso.", { description: `${res.rowCount} lançamentos importados.` });
    } catch (e: any) {
      toast.error("Falha ao importar", { description: e.message });
    } finally { setUploading(false); }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold">Novo Upload</h1>
        <p className="text-sm text-muted-foreground">
          Envie a planilha Excel de contas a pagar/receber. O relatório atual será substituído.
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
            <p className="mt-1 text-xs text-muted-foreground">Formato .xlsx (até 20MB)</p>
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
        </Card>
      </div>
    </AppShell>
  );
}
