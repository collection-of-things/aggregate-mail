import type { Api } from "../api";
import { ATTACHMENT_BYTES } from "../../shared/attachments";
import { useContext, useEffect, useRef, useState } from "react";
import type { MailAttachment } from "../../shared/types";
import { PrivacyContext, Redact } from "../ui/Privacy";

const imageTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/avif"]);
// Parse and render each get this budget before the worker task is destroyed.
const PDF_RENDER_BUDGET_MS = 15000;

function PdfPreview({ bytes }: { bytes: Uint8Array }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    let destroy: (() => void) | undefined;
    setError(false);
    // A parse or render stall must not pin the worker; each step gets the same
    // budget and destroying the task frees its worker and buffers.
    const bounded = <T,>(work: Promise<T>, cancel: () => void) =>
      new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => { cancel(); reject(new Error("PDF preview timed out.")); }, PDF_RENDER_BUDGET_MS);
        work.then(
          (value) => { clearTimeout(timer); resolve(value); },
          (error) => { clearTimeout(timer); reject(error); },
        );
      });
    void (async () => {
      const pdfjs = await import("pdfjs-dist");
      const { default: worker } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      if (!active) return;
      pdfjs.GlobalWorkerOptions.workerSrc = worker;
      const task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: true,
        cMapUrl: "/pdfjs/cmaps/", standardFontDataUrl: "/pdfjs/standard_fonts/", wasmUrl: "/pdfjs/wasm/", useWasm: false,
        maxImageSize: 16777216 });
      destroy = () => { void task.destroy(); };
      const pdf = await bounded(task.promise, () => void task.destroy());
      if (!active) return;
      setPages(pdf.numPages);
      const sheet = await bounded(pdf.getPage(page), () => void task.destroy());
      if (!active || !canvas.current) return;
      const viewport = sheet.getViewport({ scale: Math.min(1.5, 1000 / sheet.getViewport({ scale: 1 }).width, 1400 / sheet.getViewport({ scale: 1 }).height) });
      canvas.current.width = viewport.width;
      canvas.current.height = viewport.height;
      await bounded(sheet.render({ canvas: canvas.current, viewport }).promise, () => void task.destroy());
    })().catch(() => { if (active) setError(true); });
    return () => { active = false; destroy?.(); };
  }, [bytes, page]);
  return <div className="attachment-pdf">
    {error ? <p role="alert">PDF preview is unavailable. Download the file to open it.</p> : <>
      <div className="attachment-actions"><button className="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous page</button>
        <span role="status">{pages ? `Page ${page} of ${pages}` : "Loading PDF…"}</span>
        <button className="button" disabled={!pages || page >= pages} onClick={() => setPage(page + 1)}>Next page</button></div>
      <canvas ref={canvas} aria-label={`PDF page ${page}`} />
    </>}
  </div>;
}

function Attachment({ mailId, file, index, api }: { mailId: string; file: MailAttachment; index: number; api?: Api }) {
  const { on: privacy } = useContext(PrivacyContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ bytes: Uint8Array; image?: string }>();
  const [url, setUrl] = useState<string>();
  const active = useRef(true);
  const request = useRef(0);
  const controller = useRef<AbortController | undefined>(undefined);
  const downloaded = useRef(false);
  const type = file.contentType.toLowerCase();
  const canPreview = file.size <= 524288 && (type === "application/pdf" || imageTypes.has(type));
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; request.current++; controller.current?.abort(); };
  }, []);
  useEffect(() => {
    if (privacy) { controller.current?.abort(); request.current++; setPreview(undefined); setUrl(undefined); setBusy(false); }
  }, [privacy]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const load = async (showPreview: boolean) => {
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    const current = ++request.current;
    setBusy(true); setError("");
    try {
      if (file.unavailable && !downloaded.current) {
        if (!api) throw Error("unavailable");
        await api(`/messages/${encodeURIComponent(mailId)}/attachments/${encodeURIComponent(file.id)}/download`, "POST", {}, abort.signal);
        downloaded.current = true;
      }
      const response = await fetch(`/api/messages/${encodeURIComponent(mailId)}/attachments/${encodeURIComponent(file.id)}`, { signal: abort.signal });
      if (!response.ok) throw Error("unavailable");
      if (Number(response.headers.get("content-length")) > ATTACHMENT_BYTES) throw Error("oversized");
      const blob = await response.blob();
      if (blob.size > ATTACHMENT_BYTES) throw Error("oversized");
      const bytes = showPreview ? new Uint8Array(await blob.arrayBuffer()) : undefined;
      if (!active.current || current !== request.current) return;
      const objectUrl = URL.createObjectURL(showPreview ? blob.slice(0, blob.size, type) : blob);
      if (showPreview) {
        setUrl(objectUrl);
        setPreview({ bytes: bytes!, ...(imageTypes.has(type) ? { image: objectUrl } : {}) });
      }
      else {
        const link = document.createElement("a");
        link.href = objectUrl; link.download = file.filename || `attachment-${index + 1}`;
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    } catch {
      if (active.current && current === request.current) setError(abort.signal.aborted ? "Attachment download cancelled." : "Attachment could not be loaded. Try again.");
    } finally {
      if (active.current && current === request.current) setBusy(false);
    }
  };
  return <li aria-busy={busy}>
    <div className="attachment-row"><span className="attachment-name"><Redact text={file.filename || `Attachment ${index + 1}`} /> <span className="attachment-size">({file.sizeIsEstimate ? "~" : ""}{Math.ceil(file.size / 1024)} KB)</span></span>
      {file.unavailable && <span>{file.size > 524288 ? "Large attachment not downloaded yet" : "Attachment not downloaded within the import limits"}</span>}
      {(!file.unavailable || api) && <div className="attachment-actions">
        {canPreview && !file.unavailable && <button className="button" type="button" disabled={busy} aria-label={`${preview ? "Hide preview" : "Preview attachment"} ${index + 1}`} aria-expanded={Boolean(preview)} onClick={() => { if (preview) { setPreview(undefined); setUrl(undefined); } else void load(true); }}>{preview ? "Hide preview" : "Preview"}</button>}
        <button className="button" type="button" disabled={busy || !file.sizeIsEstimate && file.size > ATTACHMENT_BYTES} aria-label={`Download attachment ${index + 1}`} onClick={() => void load(false)}>Download</button>
      </div>}
    </div>
    {busy && <p role="status">Loading attachment… <button type="button" className="button" onClick={() => controller.current?.abort()}>Cancel download</button></p>}
    {!file.sizeIsEstimate && file.size > ATTACHMENT_BYTES && <p>Download limit: 25 MiB. Open this attachment in your provider.</p>}
    {error && <p role="alert">{error}</p>}
    {preview && <div className="attachment-preview">
      {privacy && <p>Preview pixels may contain personal information.</p>}
      {preview.image ? <img src={preview.image} alt={`Attachment ${index + 1}`} onError={() => { setPreview(undefined); setUrl(undefined); setError("Image preview is unavailable. Download the file to open it."); }} /> : <PdfPreview bytes={preview.bytes} />}
    </div>}
  </li>;
}

export function Attachments({ mailId, files, api }: { mailId: string; files: MailAttachment[]; api?: Api }) {
  return <section className="reader-attachments" aria-label="Attachments"><h2>Attachments</h2>
    <ul>{files.map((file, index) => <Attachment api={api} key={`${mailId}:${file.id}`} mailId={mailId} file={file} index={index} />)}</ul>
  </section>;
}
