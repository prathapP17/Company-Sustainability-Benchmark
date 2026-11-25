import { guardRequest } from "@/lib/pipeline/access";
import { pipelineDb } from "@/lib/pipeline/db";
import { MAX_UPLOAD_BYTES, storeUpload } from "@/lib/pipeline/ingest";
import { defaultDataDir } from "@/lib/data/load";
import { listCompanyIds } from "@/lib/db/queries";
import { SourceType, VerificationClass } from "@/lib/schema/enums";

export async function POST(req: Request) {
  const g = guardRequest(req, { mutating: true, role: "reviewer" });
  if (g instanceof Response) return g;
  // Browsers always send Content-Length for form uploads; refusing bodies without it keeps the size check meaningful
  // when no proxy limits the body (local mode). The hosted proxy also caps bodies at 60 MB.
  const lenHeader = req.headers.get("content-length");
  if (!lenHeader) return Response.json({ error: "Content-Length required" }, { status: 411 });
  const len = Number(lenHeader);
  if (!Number.isFinite(len) || len > MAX_UPLOAD_BYTES + 1024 * 1024) return Response.json({ error: "file too large" }, { status: 413 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "choose a file" }, { status: 400 });
  const companyId = String(form.get("companyId") ?? "");
  if (!listCompanyIds().includes(companyId)) return Response.json({ error: "unknown company" }, { status: 400 });
  const reportType = SourceType.safeParse(form.get("reportType"));
  const verification = VerificationClass.safeParse(form.get("verificationClass"));
  if (!reportType.success || !verification.success) return Response.json({ error: "invalid report type or source class" }, { status: 400 });
  const yearRaw = String(form.get("reportingYear") ?? "").trim();
  const reportingYear = yearRaw ? Number(yearRaw) : null;
  if (reportingYear !== null && !(Number.isInteger(reportingYear) && reportingYear >= 1990 && reportingYear <= 2100)) {
    return Response.json({ error: "invalid reporting year" }, { status: 400 });
  }
  const sourceUrl = String(form.get("sourceUrl") ?? "").trim() || null;
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) return Response.json({ error: "source URL must start with http(s)://" }, { status: 400 });
  const title = String(form.get("title") ?? "").trim().slice(0, 200) || file.name;

  try {
    const dataDir = defaultDataDir();
    const r = storeUpload(pipelineDb(dataDir), dataDir, file.name, Buffer.from(await file.arrayBuffer()), {
      companyId,
      title,
      sourceUrl,
      reportType: reportType.data,
      reportingYear,
      verificationClass: verification.data,
      uploadedBy: g.reviewer,
    });
    return Response.json({ documentId: r.document.id, duplicate: r.duplicate });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
