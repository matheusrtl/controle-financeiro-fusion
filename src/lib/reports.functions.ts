import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import * as XLSX from "xlsx";

// ============================================================
// Helpers: parse pt-BR values
// ============================================================
function parseDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    const iso = new Date(Date.UTC(d.y, d.m - 1, d.d)).toISOString().slice(0, 10);
    return iso;
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (m) {
      let [, d, mo, y] = m;
      if (y.length === 2) y = (Number(y) > 50 ? "19" : "20") + y;
      return `${y.padStart(4, "0")}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[0];
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  }
  return null;
}

function parseMoney(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Math.round(v * 100) / 100;
  const s = String(v).trim().replace(/[R$\s]/g, "");
  if (!s) return 0;
  // pt-BR: 1.234.567,89
  const norm = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(norm);
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
}

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    for (const key of Object.keys(row)) {
      if (key.trim().toLowerCase() === k.trim().toLowerCase()) return row[key];
    }
  }
  return undefined;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function statusFor(pagamento: string | null, vencimento: string | null, valorAberto: number): "pago" | "aberto" | "vencido" {
  if (valorAberto <= 0.001) return "pago";
  if (vencimento && vencimento < todayISO()) return "vencido";
  return "aberto";
}

// ============================================================
// Import a new report (replaces the active one)
// ============================================================
const REQUIRED_COLUMNS = ["Documento", "Fornecedor - Nome", "Vencimento", "Valor"];

export const importReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({
    filename: z.string(),
    base64: z.string().optional(),
    csvText: z.string().optional(),
  }).refine((v) => v.base64 || v.csvText, { message: "Arquivo não enviado" }).parse(raw))
  .handler(async ({ data, context }) => {
    let wb: XLSX.WorkBook;

    if (data.csvText) {
      wb = XLSX.read(data.csvText, { type: "string" });
    } else {
      const bytes = Uint8Array.from(atob(data.base64!), (c) => c.charCodeAt(0));
      wb = XLSX.read(bytes, { type: "array", cellDates: true });
    }
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new Error("Planilha vazia.");
    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
    if (rows.length === 0) throw new Error("Nenhuma linha encontrada.");

    const headers = Object.keys(rows[0]).map((h) => h.trim().toLowerCase());
    const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c.toLowerCase()));
    if (missing.length) throw new Error(`Colunas obrigatórias ausentes: ${missing.join(", ")}`);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Archive any active report
    await supabaseAdmin.from("reports").update({ status: "archived" }).eq("status", "active");

    // Create new active report
    const { data: newReport, error: repErr } = await supabaseAdmin
      .from("reports")
      .insert({
        filename: data.filename,
        uploaded_by: context.userId,
        row_count: 0,
        status: "active",
      })
      .select()
      .single();
    if (repErr || !newReport) throw new Error(repErr?.message || "Falha ao criar relatório.");

    // Map rows
    let minDate: string | null = null;
    let maxDate: string | null = null;

    const parsed = rows.map((r) => {
      const emissao = parseDate(pick(r, ["Emissão", "Emissao"]));
      const vencimento = parseDate(pick(r, ["Vencimento"]));
      const pagamento = parseDate(pick(r, ["Pagamento"]));
      const valor = parseMoney(pick(r, ["Valor"]));
      const multa = parseMoney(pick(r, ["Multa"]));
      const juros = parseMoney(pick(r, ["Juros"]));
      const desconto = parseMoney(pick(r, ["Desconto"]));
      const valor_pago = parseMoney(pick(r, ["Valor Pago", "ValorPago"]));
      const valor_aberto = parseMoney(pick(r, ["Valor em Aberto", "Valor Aberto"]));
      const valor_total = parseMoney(pick(r, ["Valor Total do Título", "Valor Total"]));

      for (const d of [emissao, vencimento, pagamento]) {
        if (!d) continue;
        if (!minDate || d < minDate) minDate = d;
        if (!maxDate || d > maxDate) maxDate = d;
      }

      return {
        report_id: newReport.id,
        documento: String(pick(r, ["Documento"]) ?? "").trim() || null,
        fornecedor: String(pick(r, ["Fornecedor - Nome", "Fornecedor"]) ?? "").trim() || null,
        emissao,
        vencimento,
        pagamento,
        valor,
        multa,
        juros,
        desconto,
        valor_pago,
        valor_aberto,
        valor_total: valor_total || valor + multa + juros - desconto,
        centro_custo: String(pick(r, ["Centro de Custo"]) ?? "").trim() || null,
        obs_parcela: String(pick(r, ["Observação da Parcela", "Observacao da Parcela"]) ?? "").trim() || null,
        obs_lancamento: String(pick(r, ["Observação do Lançamento", "Observacao do Lancamento"]) ?? "").trim() || null,
        conta: String(pick(r, ["Conta"]) ?? "").trim() || null,
        status: statusFor(pagamento, vencimento, valor_aberto),
      };
    });

    // Deduplicate rows within the same file by (documento|fornecedor|vencimento|valor)
    const seen = new Set<string>();
    const deduped = parsed.filter((r) => {
      const key = `${r.documento ?? ""}|${r.fornecedor ?? ""}|${r.vencimento ?? ""}|${r.valor}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Insert in batches
    const CHUNK = 1000;
    for (let i = 0; i < deduped.length; i += CHUNK) {
      const slice = deduped.slice(i, i + CHUNK);
      const { error } = await supabaseAdmin.from("transactions").insert(slice);
      if (error) throw new Error(`Falha ao inserir lote ${i / CHUNK + 1}: ${error.message}`);
    }

    await supabaseAdmin
      .from("reports")
      .update({ row_count: deduped.length, period_start: minDate, period_end: maxDate })
      .eq("id", newReport.id);

    return { reportId: newReport.id, rowCount: deduped.length };
  });

// ============================================================
// Report metadata
// ============================================================
export const getActiveReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("reports")
      .select("id, filename, uploaded_at, row_count, period_start, period_end, status")
      .eq("status", "active")
      .maybeSingle();
    return data;
  });

export const listReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("reports")
      .select("id, filename, uploaded_at, row_count, status, period_start, period_end")
      .order("uploaded_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const deleteReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { data: roleRow } = await context.supabase
      .from("user_roles").select("role").eq("user_id", context.userId).eq("role", "admin").maybeSingle();
    if (!roleRow) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("reports").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
