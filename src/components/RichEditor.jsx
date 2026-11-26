import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { Bold, Italic, Heading2, Heading3, List, ListOrdered, ListChecks, Link2, Image as ImageIcon, Paperclip, ExternalLink, Copy, Check, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { fileUrl, uploadFile, errMsg } from "../lib/api";
import { useApp } from "../context/AppContext";

const SANITIZE_CACHE = new Map();

export const sanitize = (html) => {
  const raw = html || "";
  if (!raw) return "";
  if (SANITIZE_CACHE.has(raw)) return SANITIZE_CACHE.get(raw);
  const clean = DOMPurify.sanitize(raw, { ADD_ATTR: ["target", "rel", "style"] });
  if (SANITIZE_CACHE.size > 250) SANITIZE_CACHE.clear();
  SANITIZE_CACHE.set(raw, clean);
  return clean;
};

const IMAGE_PRESETS = [
  { label: "23%", value: 23.5, hint: "Kecil (4 sejajar)" },
  { label: "31%", value: 31.5, hint: "3 sejajar" },
  { label: "48%", value: 48.5, hint: "2 sejajar" },
  { label: "100%", value: 100, hint: "Penuh" },
];

function escapeAttr(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getSafeHref(raw) {
  if (!raw || typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  try {
    const parsed = new URL(trimmed, typeof window !== "undefined" ? window.location.origin : "https://example.com");
    if (["http:", "https:", "mailto:"].includes(parsed.protocol)) return trimmed;
  } catch {}
  return "";
}

function formatLinkLabel(url) {
  try {
    const u = new URL(url, typeof window !== "undefined" ? window.location.origin : "https://example.com");
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname && u.pathname !== "/" ? u.pathname : "";
    const combined = `${host}${path}${u.search || ""}`;
    return combined.length > 34 ? `${combined.slice(0, 32)}…` : combined;
  } catch {
    return url.length > 34 ? `${url.slice(0, 32)}…` : url;
  }
}

export function RichView({ html, className = "" }) {
  const { t } = useApp() || {};
  const tr = t || ((_k, fb) => fb || _k);
  return <div className={`rich text-sm leading-relaxed ${className}`} dangerouslySetInnerHTML={{ __html: sanitize(html) || `<p style='opacity:.6'>${tr("editor_empty_desc", "Belum ada deskripsi")}</p>` }} />;
}

export default function RichEditor({ value, onChange, onBlur, placeholder, testid = "rich-editor" }) {
  const { t: trRaw } = useApp() || {};
  const tr = trRaw || ((_k, fb) => fb || _k);
  const resolvedPlaceholder = placeholder || tr("editor_placeholder", "Tulis brief… tempel link, tambah gambar, atau unggah file");
  const wrapperRef = useRef(null);
  const ref = useRef(null);
  const popoverRef = useRef(null);
  const imgOverlayRef = useRef(null);
  const activeAnchorRef = useRef(null);
  const activeImgRef = useRef(null);
  const img = useRef(null);
  const doc = useRef(null);
  const savedRange = useRef(null);
  const [linkBarOpen, setLinkBarOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkPopover, setLinkPopover] = useState(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [imgOverlay, setImgOverlay] = useState(null);

  const lastAppliedValueRef = useRef(null);

  useLayoutEffect(() => {
    const nextVal = value || "";
    if (ref.current && lastAppliedValueRef.current !== nextVal) {
      const cleaned = nextVal ? sanitize(nextVal) : "";
      if (ref.current.innerHTML !== cleaned) {
        ref.current.innerHTML = cleaned;
      }
      lastAppliedValueRef.current = nextVal;
    }
    setLinkPopover(null);
    activeAnchorRef.current = null;
    if (activeImgRef.current && !ref.current?.contains(activeImgRef.current)) {
      activeImgRef.current = null;
      setImgOverlay(null);
    }
  }, [value]);

  const computePopoverPos = useCallback((anchorEl, clickX, clickY) => {
    if (!anchorEl || !wrapperRef.current || !ref.current) return null;
    const rawHref = anchorEl.getAttribute("href") || "";
    const safeUrl = getSafeHref(rawHref);
    if (!safeUrl) return null;

    const wRect = wrapperRef.current.getBoundingClientRect();
    const eRect = ref.current.getBoundingClientRect();
    const rects = Array.from(anchorEl.getClientRects?.() || []);
    let targetRect = anchorEl.getBoundingClientRect();
    if (rects.length > 0 && typeof clickX === "number" && typeof clickY === "number") {
      const hit = rects.find(
        (r) => clickX >= r.left - 4 && clickX <= r.right + 4 && clickY >= r.top - 4 && clickY <= r.bottom + 4
      );
      if (hit) targetRect = hit;
      else targetRect = rects[0];
    }

    if (targetRect.bottom < eRect.top + 4 || targetRect.top > eRect.bottom - 4) {
      return null;
    }

    const popoverWidth = Math.min(320, Math.max(200, wRect.width - 16));
    const anchorCenterX = typeof clickX === "number"
      ? clickX - wRect.left
      : targetRect.left - wRect.left + Math.min(targetRect.width / 2, 120);
    const desiredLeft = anchorCenterX - Math.min(90, popoverWidth / 3);
    const maxLeft = Math.max(8, wRect.width - popoverWidth - 8);
    const left = Math.max(8, Math.min(desiredLeft, maxLeft));

    const spaceAboveEditor = targetRect.top - eRect.top;
    const placeBelow = spaceAboveEditor < 44;
    const top = placeBelow
      ? Math.min(targetRect.bottom - wRect.top + 6, wRect.height - 6)
      : Math.max(8, targetRect.top - wRect.top - 6);

    return {
      url: safeUrl,
      top,
      left,
      placement: placeBelow ? "bottom" : "top",
    };
  }, []);

  const computeImgOverlay = useCallback((imgEl) => {
    if (!imgEl || !wrapperRef.current || !ref.current || !ref.current.contains(imgEl)) return null;
    const wRect = wrapperRef.current.getBoundingClientRect();
    const eRect = ref.current.getBoundingClientRect();
    const iRect = imgEl.getBoundingClientRect();

    if (iRect.bottom < eRect.top + 10 || iRect.top > eRect.bottom - 10 || iRect.width < 8 || iRect.height < 8) {
      return null;
    }

    const editorInnerWidth = Math.max(120, ref.current.clientWidth - 24);
    const styleW = String(imgEl.style?.width || "").trim();
    let pct = Math.round((iRect.width / editorInnerWidth) * 100);
    if (styleW.endsWith("%")) {
      const parsed = parseFloat(styleW);
      if (!Number.isNaN(parsed) && parsed > 0) pct = parsed;
    }
    pct = Math.max(10, Math.min(100, Math.round(pct * 10) / 10));

    const clippedTop = Math.max(iRect.top, eRect.top);
    const clippedBottom = Math.min(iRect.bottom, eRect.bottom);
    const top = clippedTop - wRect.top;
    const left = iRect.left - wRect.left;
    const height = Math.max(16, clippedBottom - clippedTop);

    const toolbarWidth = Math.min(310, Math.max(220, wRect.width - 16));
    const toolbarLeft = Math.max(8, Math.min(left, wRect.width - toolbarWidth - 8));
    const spaceAbove = clippedTop - eRect.top;
    const placeBelow = spaceAbove < 46;
    const toolbarTop = placeBelow
      ? Math.min(clippedBottom - wRect.top + 8, wRect.height - 8)
      : Math.max(8, clippedTop - wRect.top - 8);

    return {
      src: getSafeHref(imgEl.getAttribute("src") || ""),
      top,
      left,
      width: iRect.width,
      height,
      pct,
      toolbarLeft,
      toolbarTop,
      toolbarPlacement: placeBelow ? "bottom" : "top",
    };
  }, []);

  const syncImgOverlay = useCallback(() => {
    if (!activeImgRef.current) return;
    const next = computeImgOverlay(activeImgRef.current);
    if (!next) {
      activeImgRef.current = null;
      setImgOverlay(null);
    } else {
      setImgOverlay(next);
    }
  }, [computeImgOverlay]);

  useEffect(() => {
    if (!linkPopover && !imgOverlay) return;
    const onDocPointerDown = (ev) => {
      if (popoverRef.current?.contains(ev.target)) return;
      if (imgOverlayRef.current?.contains(ev.target)) return;
      if (!wrapperRef.current?.contains(ev.target)) {
        setLinkPopover(null);
        activeAnchorRef.current = null;
        setImgOverlay(null);
        activeImgRef.current = null;
      }
    };
    const onResize = () => {
      if (activeImgRef.current) syncImgOverlay();
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown);
      window.removeEventListener("resize", onResize);
    };
  }, [linkPopover, imgOverlay, syncImgOverlay]);

  const emit = () => {
    const clean = sanitize(ref.current.innerHTML);
    lastAppliedValueRef.current = clean;
    onChange?.(clean);
  };
  const handleBlur = (e) => {
    if (!ref.current) return;
    if (popoverRef.current && e?.relatedTarget && popoverRef.current.contains(e.relatedTarget)) {
      return;
    }
    if (imgOverlayRef.current && e?.relatedTarget && imgOverlayRef.current.contains(e.relatedTarget)) {
      return;
    }
    const clean = sanitize(ref.current.innerHTML);
    lastAppliedValueRef.current = clean;
    onChange?.(clean);
    onBlur?.(clean);
  };
  const cmd = (c, v) => { ref.current.focus(); document.execCommand(c, false, v); emit(); };
  const insert = (html) => { ref.current.focus(); document.execCommand("insertHTML", false, html); emit(); };
  const openLinkBar = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && ref.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    } else {
      savedRange.current = null;
    }
    setLinkUrl("");
    setLinkPopover(null);
    setImgOverlay(null);
    activeImgRef.current = null;
    setLinkBarOpen((v) => !v);
  };
  const applyLink = () => {
    const raw = linkUrl.trim();
    if (!raw) {
      setLinkBarOpen(false);
      return;
    }
    const candidate = /^https?:\/\/|^mailto:|^\//i.test(raw) ? raw : `https://${raw}`;
    const url = getSafeHref(candidate);
    if (!url) {
      toast.error(tr("editor_link_invalid", "URL link tidak valid"));
      return;
    }
    ref.current.focus();
    const sel = window.getSelection();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
    if (sel && !sel.isCollapsed) {
      document.execCommand("createLink", false, url);
      ref.current.querySelectorAll("a[href]").forEach((a) => {
        if (!a.getAttribute("target")) a.setAttribute("target", "_blank");
        if (!a.getAttribute("rel")) a.setAttribute("rel", "noopener noreferrer");
      });
    } else {
      document.execCommand("insertHTML", false, `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>&nbsp;`);
    }
    emit();
    onBlur?.(sanitize(ref.current.innerHTML));
    setLinkBarOpen(false);
    setLinkUrl("");
    savedRange.current = null;
  };
  const up = async (e, image) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = "";
    if (picked.length === 0) return;
    try {
      const htmlParts = [];
      for (const f of picked) {
        const r = await uploadFile(f);
        if (image) {
          htmlParts.push(`<img src="${fileUrl(r.id)}" alt="${escapeAttr(r.name)}" style="width: 31.5%;"/>`);
        } else {
          htmlParts.push(`<a href="${fileUrl(r.id)}" target="_blank" rel="noopener noreferrer">📎 ${escapeAttr(r.name)}</a>&nbsp;`);
        }
      }
      if (htmlParts.length > 0) {
        insert(htmlParts.join(""));
        if (ref.current) onBlur?.(sanitize(ref.current.innerHTML));
      }
    } catch (er) { toast.error(errMsg(er)); }
  };
  const paste = async (e) => {
    const pastedFiles = Array.from(e.clipboardData?.files || []).filter((f) => f.type?.startsWith("image/"));
    if (pastedFiles.length > 0) {
      e.preventDefault();
      try {
        const parts = [];
        for (const f of pastedFiles) {
          const r = await uploadFile(f);
          parts.push(`<img src="${fileUrl(r.id)}" alt="${escapeAttr(r.name)}" style="width: 31.5%;"/>`);
        }
        if (parts.length > 0) {
          insert(parts.join(""));
          if (ref.current) onBlur?.(sanitize(ref.current.innerHTML));
        }
      } catch (er) { toast.error(errMsg(er)); }
      return;
    }
    const t = e.clipboardData.getData("text/plain");
    const safePasted = getSafeHref(t.trim());
    if (/^https?:\/\/\S+$/.test(t.trim()) && safePasted) {
      e.preventDefault();
      insert(`<a href="${safePasted}" target="_blank" rel="noopener noreferrer">${safePasted}</a>&nbsp;`);
    }
  };
  const B = ({ on, I, label }) => <button type="button" onMouseDown={(e) => { e.preventDefault(); on(); }} className="flex h-8 w-8 items-center justify-center rounded-lg text-sub hover:bg-surface hover:text-ink" aria-label={label} title={label}><I size={15} /></button>;
  const onClick = (e) => {
    if (e.target.tagName === "LI" && e.target.parentElement?.classList?.contains("checklist")) {
      e.target.classList.toggle("checked");
      emit();
      if (ref.current) onBlur?.(sanitize(ref.current.innerHTML));
    }
    const imgEl = e.target?.tagName === "IMG" ? e.target : null;
    if (imgEl && ref.current?.contains(imgEl)) {
      activeAnchorRef.current = null;
      setLinkPopover(null);
      activeImgRef.current = imgEl;
      const ov = computeImgOverlay(imgEl);
      setImgOverlay(ov);
      return;
    }
    activeImgRef.current = null;
    setImgOverlay(null);

    const anchorEl = e.target?.closest?.("a");
    if (anchorEl && ref.current?.contains(anchorEl)) {
      const pos = computePopoverPos(anchorEl, e.clientX, e.clientY);
      if (pos) {
        activeAnchorRef.current = anchorEl;
        setCopiedLink(false);
        setLinkPopover(pos);
        return;
      }
    }
    activeAnchorRef.current = null;
    setLinkPopover(null);
  };

  const applyImageWidthPct = (pct) => {
    const imgEl = activeImgRef.current;
    if (!imgEl || !ref.current?.contains(imgEl)) return;
    const clamped = Math.max(10, Math.min(100, Number(pct) || 31.5));
    imgEl.style.width = `${clamped}%`;
    imgEl.style.height = "auto";
    emit();
    onBlur?.(sanitize(ref.current.innerHTML));
    requestAnimationFrame(() => syncImgOverlay());
  };

  const removeSelectedImage = () => {
    const imgEl = activeImgRef.current;
    if (!imgEl || !ref.current?.contains(imgEl)) return;
    imgEl.remove();
    activeImgRef.current = null;
    setImgOverlay(null);
    emit();
    onBlur?.(sanitize(ref.current.innerHTML));
  };

  const startResizeDrag = (e, fromLeft = false) => {
    e.preventDefault();
    e.stopPropagation();
    const imgEl = activeImgRef.current;
    if (!imgEl || !ref.current?.contains(imgEl)) return;

    const startX = e.clientX;
    const startW = imgEl.getBoundingClientRect().width;
    const editorInnerWidth = Math.max(140, ref.current.clientWidth - 24);
    let raf = 0;

    const onMove = (ev) => {
      const delta = fromLeft ? (startX - ev.clientX) : (ev.clientX - startX);
      const nextPx = Math.max(56, Math.min(editorInnerWidth, startW + delta));
      const nextPct = Math.max(12, Math.min(100, Math.round((nextPx / editorInnerWidth) * 100)));
      imgEl.style.width = `${nextPct}%`;
      imgEl.style.height = "auto";
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => syncImgOverlay());
    };

    const onUp = () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      emit();
      if (ref.current) onBlur?.(sanitize(ref.current.innerHTML));
      requestAnimationFrame(() => syncImgOverlay());
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const handleEditorKeyUp = (e) => {
    if (e.key === "Escape") {
      activeAnchorRef.current = null;
      setLinkPopover(null);
      activeImgRef.current = null;
      setImgOverlay(null);
      return;
    }
    if (activeImgRef.current && (!ref.current?.contains(activeImgRef.current) || e.key === "Backspace" || e.key === "Delete")) {
      if (!ref.current?.contains(activeImgRef.current)) {
        activeImgRef.current = null;
        setImgOverlay(null);
      }
    }
    if (!linkPopover) return;
    const sel = window.getSelection();
    const anchorNode = sel?.anchorNode;
    const el = anchorNode?.nodeType === 1 ? anchorNode : anchorNode?.parentElement;
    const insideAnchor = el?.closest?.("a");
    if (!insideAnchor || !ref.current?.contains(insideAnchor)) {
      activeAnchorRef.current = null;
      setLinkPopover(null);
    }
  };

  const handleEditorScroll = () => {
    if (activeImgRef.current) {
      syncImgOverlay();
    }
    if (!linkPopover || !activeAnchorRef.current) return;
    const nextPos = computePopoverPos(activeAnchorRef.current);
    if (!nextPos) {
      activeAnchorRef.current = null;
      setLinkPopover(null);
    } else {
      setLinkPopover(nextPos);
    }
  };

  const handleCopyPopoverLink = () => {
    if (!linkPopover?.url) return;
    navigator.clipboard?.writeText(linkPopover.url).then(() => {
      setCopiedLink(true);
      toast.success(tr("editor_link_copied", "Link disalin"));
      setTimeout(() => setCopiedLink(false), 1500);
    }).catch(() => {});
  };

  return (
    <div ref={wrapperRef} className="relative rounded-2xl border bg-surface2" data-testid={testid}>
      <div className="flex flex-wrap gap-0.5 border-b p-1">
        <B I={Bold} label={tr("editor_bold", "Tebal")} on={() => cmd("bold")} /><B I={Italic} label={tr("editor_italic", "Miring")} on={() => cmd("italic")} />
        <B I={Heading2} label={tr("editor_h2", "Judul")} on={() => cmd("formatBlock", "h2")} /><B I={Heading3} label={tr("editor_h3", "Subjudul")} on={() => cmd("formatBlock", "h3")} />
        <B I={List} label={tr("editor_ul", "Daftar Poin")} on={() => cmd("insertUnorderedList")} /><B I={ListOrdered} label={tr("editor_ol", "Daftar Angka")} on={() => cmd("insertOrderedList")} />
        <B I={ListChecks} label={tr("editor_checklist", "Checklist")} on={() => insert(`<ul class="checklist"><li>${tr("editor_checklist_item", "Item checklist")}</li></ul><p></p>`)} />
        <B I={Link2} label={tr("editor_link", "Link")} on={openLinkBar} />
        <B I={ImageIcon} label={tr("editor_image", "Gambar")} on={() => img.current.click()} /><B I={Paperclip} label={tr("editor_file", "File")} on={() => doc.current.click()} />
        <input ref={img} type="file" accept="image/*" multiple hidden onChange={(e) => up(e, true)} /><input ref={doc} type="file" hidden onChange={(e) => up(e, false)} />
      </div>
      {linkBarOpen && (
        <div className="flex items-center gap-2 border-b bg-surface px-2.5 py-2">
          <input
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); applyLink(); }
              if (e.key === "Escape") { e.preventDefault(); setLinkBarOpen(false); }
            }}
            placeholder="https://contoh.com/dokumen"
            autoFocus
            className="h-8 flex-1 rounded-xl border bg-surface2 px-2.5 text-xs outline-none focus:border-brand"
          />
          <button type="button" onClick={applyLink} className="btn-accent h-8 px-3 text-xs font-semibold">{tr("editor_link_insert", "Sisipkan")}</button>
          <button type="button" onClick={() => setLinkBarOpen(false)} className="btn-ghost h-8 border px-2.5 text-xs font-semibold">{tr("common_cancel", "Batal")}</button>
        </div>
      )}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={() => {
          emit();
          if (activeImgRef.current) requestAnimationFrame(() => syncImgOverlay());
        }}
        onBlur={handleBlur}
        onPaste={paste}
        onClick={onClick}
        onKeyUp={handleEditorKeyUp}
        onScroll={handleEditorScroll}
        data-placeholder={resolvedPlaceholder}
        className="rich min-h-[120px] max-h-[360px] overflow-y-auto p-3 text-sm outline-none"
        data-testid={`${testid}-content`}
      />
      {linkPopover && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Aksi link"
          onMouseDown={(e) => e.preventDefault()}
          style={{ top: `${linkPopover.top}px`, left: `${linkPopover.left}px` }}
          className={`absolute z-30 flex max-w-[min(320px,calc(100%-16px))] items-center gap-1.5 rounded-xl border border-border bg-surface px-2.5 py-1.5 text-xs shadow-lg shadow-slate-900/12 dark:shadow-black/45 animate-popover-enter ${
            linkPopover.placement === "top" ? "-translate-y-full" : ""
          }`}
          data-testid={`${testid}-link-popover`}
        >
          <Link2 size={13} className="shrink-0 text-rose-500" />
          <span className="min-w-0 flex-1 truncate font-medium text-sub" title={linkPopover.url}>
            {formatLinkLabel(linkPopover.url)}
          </span>
          <button
            type="button"
            onClick={handleCopyPopoverLink}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sub hover:bg-surface2 hover:text-ink transition-colors cursor-pointer"
            title={tr("common_copy_link", "Salin link")}
            aria-label={tr("common_copy_link", "Salin link")}
            data-testid={`${testid}-link-copy`}
          >
            {copiedLink ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
          </button>
          <a
            href={linkPopover.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              activeAnchorRef.current = null;
              setLinkPopover(null);
            }}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg bg-brand px-2.5 text-[11px] font-bold text-white shadow-xs hover:brightness-105 transition cursor-pointer whitespace-nowrap"
            data-testid={`${testid}-link-open`}
          >
            <span>{tr("editor_open_link", "Buka Link")}</span>
            <ExternalLink size={11} />
          </a>
        </div>
      )}
      {imgOverlay && (
        <div ref={imgOverlayRef} onMouseDown={(e) => e.preventDefault()}>
          {/* Selection box + Drag-to-resize handles */}
          <div
            style={{
              top: `${imgOverlay.top}px`,
              left: `${imgOverlay.left}px`,
              width: `${imgOverlay.width}px`,
              height: `${imgOverlay.height}px`,
            }}
            className="pointer-events-none absolute z-20 rounded-xl ring-2 ring-brand ring-offset-1"
            data-testid={`${testid}-img-selection`}
          >
            <button
              type="button"
              onPointerDown={(e) => startResizeDrag(e, true)}
              aria-label="Resize kiri atas"
              className="pointer-events-auto absolute -left-1.5 -top-1.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-brand shadow-sm cursor-nwse-resize"
            />
            <button
              type="button"
              onPointerDown={(e) => startResizeDrag(e, false)}
              aria-label="Resize kanan atas"
              className="pointer-events-auto absolute -right-1.5 -top-1.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-brand shadow-sm cursor-nesw-resize"
            />
            <button
              type="button"
              onPointerDown={(e) => startResizeDrag(e, true)}
              aria-label="Resize kiri bawah"
              className="pointer-events-auto absolute -left-1.5 -bottom-1.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-brand shadow-sm cursor-nesw-resize"
            />
            <button
              type="button"
              onPointerDown={(e) => startResizeDrag(e, false)}
              aria-label="Resize kanan bawah"
              className="pointer-events-auto absolute -right-1.5 -bottom-1.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-brand shadow-sm cursor-nwse-resize"
              data-testid={`${testid}-img-resize-handle`}
            />
            <button
              type="button"
              onPointerDown={(e) => startResizeDrag(e, false)}
              aria-label="Tarik sisi kanan untuk resize"
              className="pointer-events-auto absolute -right-1.5 top-1/2 -translate-y-1/2 h-7 w-2.5 rounded-full border border-white bg-brand shadow-sm cursor-ew-resize"
            />
          </div>

          {/* Floating Resize & Action Controller */}
          <div
            role="toolbar"
            aria-label="Kontrol ukuran gambar"
            style={{ top: `${imgOverlay.toolbarTop}px`, left: `${imgOverlay.toolbarLeft}px` }}
            className={`absolute z-30 flex flex-wrap items-center gap-1 rounded-xl border border-border bg-surface px-2 py-1.5 text-xs shadow-lg shadow-slate-900/12 dark:shadow-black/45 animate-popover-enter ${
              imgOverlay.toolbarPlacement === "top" ? "-translate-y-full" : ""
            }`}
            data-testid={`${testid}-img-toolbar`}
          >
            {IMAGE_PRESETS.map((preset) => {
              const active = Math.abs(imgOverlay.pct - preset.value) <= 2.5;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => applyImageWidthPct(preset.value)}
                  title={preset.hint}
                  className={`h-6 rounded-lg px-2 text-[11px] font-bold transition-colors cursor-pointer whitespace-nowrap ${
                    active ? "bg-brand text-white shadow-xs" : "bg-surface2 text-sub hover:text-ink"
                  }`}
                  data-testid={`${testid}-img-preset-${parseInt(preset.label, 10)}`}
                >
                  {preset.label}
                </button>
              );
            })}
            <span className="px-1 text-[10px] font-semibold tabular-nums text-sub">
              {Math.round(imgOverlay.pct)}%
            </span>
            {imgOverlay.src && (
              <a
                href={imgOverlay.src}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-6 w-6 items-center justify-center rounded-lg text-sub hover:bg-surface2 hover:text-ink transition-colors cursor-pointer"
                title={tr("editor_open_image", "Buka gambar penuh")}
                aria-label={tr("editor_open_image", "Buka gambar penuh")}
                data-testid={`${testid}-img-open`}
              >
                <ExternalLink size={12} />
              </a>
            )}
            <button
              type="button"
              onClick={removeSelectedImage}
              className="flex h-6 w-6 items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
              title={tr("common_delete", "Hapus gambar")}
              aria-label={tr("common_delete", "Hapus gambar")}
              data-testid={`${testid}-img-delete`}
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
