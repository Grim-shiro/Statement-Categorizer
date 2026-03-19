"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// Polyfill for older browsers/runtimes (Promise.withResolvers is ES2024); required by pdfjs-dist
if (typeof Promise !== "undefined" && typeof (Promise as PromiseConstructor & { withResolvers?: () => { promise: Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void } }).withResolvers !== "function") {
  (Promise as PromiseConstructor & { withResolvers: () => { promise: Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void } }).withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

export interface SelectionRect {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  // Normalized coordinates (0-1) relative to page dimensions
  normX: number;
  normY: number;
  normWidth: number;
  normHeight: number;
}

interface PDFPageRendererProps {
  pdfBase64: string;
  scale?: number;
  onSelectionComplete?: (selection: SelectionRect) => void;
  selections?: SelectionRect[]; // Multiple selections across pages
}

export default function PDFPageRenderer({
  pdfBase64,
  scale = 1.5,
  onSelectionComplete,
  selections = [],
}: PDFPageRendererProps) {
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfDocRef = useRef<any>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  // Drag state
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null
  );
  const [dragEnd, setDragEnd] = useState<{ x: number; y: number } | null>(
    null
  );

  // Load PDF
  useEffect(() => {
    let cancelled = false;

    async function loadPDF() {
      try {
        setLoading(true);
        setError(null);

        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

        const binaryStr = atob(pdfBase64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }

        const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
        if (cancelled) return;

        pdfDocRef.current = pdf;
        setPageCount(pdf.numPages);
        setCurrentPage(1);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load PDF");
        setLoading(false);
      }
    }

    loadPDF();
    return () => {
      cancelled = true;
    };
  }, [pdfBase64]);

  // Render page
  useEffect(() => {
    if (!pdfDocRef.current || !canvasRef.current || loading) return;
    let cancelled = false;

    async function renderPage() {
      try {
        const pdf = pdfDocRef.current;
        const page = await pdf.getPage(currentPage);
        if (cancelled) return;

        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d")!;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = viewport.width * dpr;
        canvas.height = viewport.height * dpr;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        ctx.scale(dpr, dpr);

        setCanvasSize({ width: viewport.width, height: viewport.height });

        // Also size the overlay canvas
        if (overlayRef.current) {
          overlayRef.current.width = viewport.width * dpr;
          overlayRef.current.height = viewport.height * dpr;
          overlayRef.current.style.width = `${viewport.width}px`;
          overlayRef.current.style.height = `${viewport.height}px`;
        }

        await page.render({ canvasContext: ctx, viewport }).promise;
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to render page"
          );
        }
      }
    }

    renderPage();
    return () => {
      cancelled = true;
    };
  }, [currentPage, loading, scale]);

  // Draw selection overlay
  useEffect(() => {
    if (!overlayRef.current || canvasSize.width === 0) return;

    const canvas = overlayRef.current;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.width * dpr;
    canvas.height = canvasSize.height * dpr;
    canvas.style.width = `${canvasSize.width}px`;
    canvas.style.height = `${canvasSize.height}px`;

    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);

    // Draw saved selections for this page first
    const pageSelections = selections.filter(
      (s) => s.page === currentPage
    );
    for (const sel of pageSelections) {
      const sx = sel.normX * canvasSize.width;
      const sy = sel.normY * canvasSize.height;
      const sw = sel.normWidth * canvasSize.width;
      const sh = sel.normHeight * canvasSize.height;

      // Highlight fill
      ctx.fillStyle = "rgba(15, 52, 96, 0.08)";
      ctx.fillRect(sx, sy, sw, sh);

      ctx.strokeStyle = "#0f3460";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(sx, sy, sw, sh);

      // Label
      ctx.setLineDash([]);
      ctx.fillStyle = "#0f3460";
      ctx.font = "bold 11px system-ui";
      ctx.fillText("Transaction Zone", sx + 4, sy - 6);
    }

    // Draw active drag on top
    if (isDragging && dragStart && dragEnd) {
      const x = Math.min(dragStart.x, dragEnd.x);
      const y = Math.min(dragStart.y, dragEnd.y);
      const w = Math.abs(dragEnd.x - dragStart.x);
      const h = Math.abs(dragEnd.y - dragStart.y);

      // Dim everything outside
      ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
      ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);
      ctx.clearRect(x, y, w, h);

      // Selection border
      ctx.strokeStyle = "#0f3460";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(x, y, w, h);

      // Corner handles
      ctx.setLineDash([]);
      ctx.fillStyle = "#0f3460";
      const hs = 5;
      [
        [x, y],
        [x + w, y],
        [x, y + h],
        [x + w, y + h],
      ].forEach(([cx, cy]) => {
        ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
      });
    }
  }, [isDragging, dragStart, dragEnd, selections, currentPage, canvasSize]);

  // Mouse handlers for drag-to-select
  const getCanvasCoords = useCallback(
    (e: React.MouseEvent): { x: number; y: number } | null => {
      if (!containerRef.current) return null;
      const canvasEl = canvasRef.current;
      if (!canvasEl) return null;
      const rect = canvasEl.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(e.clientX - rect.left, canvasSize.width)),
        y: Math.max(0, Math.min(e.clientY - rect.top, canvasSize.height)),
      };
    },
    [canvasSize]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const coords = getCanvasCoords(e);
      if (!coords) return;
      setIsDragging(true);
      setDragStart(coords);
      setDragEnd(coords);
    },
    [getCanvasCoords]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      const coords = getCanvasCoords(e);
      if (!coords) return;
      setDragEnd(coords);

      // Auto-scroll when dragging near edges of the scrollable container
      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const edgeThreshold = 40;
        const scrollSpeed = 8;
        if (e.clientY > rect.bottom - edgeThreshold) {
          container.scrollTop += scrollSpeed;
        } else if (e.clientY < rect.top + edgeThreshold) {
          container.scrollTop -= scrollSpeed;
        }
      }
    },
    [isDragging, getCanvasCoords]
  );

  const handleMouseUp = useCallback(() => {
    if (!isDragging || !dragStart || !dragEnd) return;
    setIsDragging(false);

    const x = Math.min(dragStart.x, dragEnd.x);
    const y = Math.min(dragStart.y, dragEnd.y);
    const w = Math.abs(dragEnd.x - dragStart.x);
    const h = Math.abs(dragEnd.y - dragStart.y);

    // Ignore tiny selections (likely accidental clicks)
    if (w < 10 || h < 10) return;

    if (onSelectionComplete && canvasSize.width > 0 && canvasSize.height > 0) {
      onSelectionComplete({
        page: currentPage,
        x,
        y,
        width: w,
        height: h,
        normX: x / canvasSize.width,
        normY: y / canvasSize.height,
        normWidth: w / canvasSize.width,
        normHeight: h / canvasSize.height,
      });
    }
  }, [
    isDragging,
    dragStart,
    dragEnd,
    currentPage,
    canvasSize,
    onSelectionComplete,
  ]);

  const goToPage = useCallback(
    (page: number) => {
      if (page >= 1 && page <= pageCount) setCurrentPage(page);
    },
    [pageCount]
  );

  if (error) {
    return (
      <div className="px-5 py-8 text-center text-red-500">
        <svg
          className="w-8 h-8 mx-auto mb-2 text-red-300"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p className="text-sm font-medium">Could not render PDF</p>
        <p className="text-xs mt-1 text-red-400">{error}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="px-5 py-12 text-center">
        <div className="w-8 h-8 border-2 border-[#0f3460] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-500">Rendering PDF pages...</p>
      </div>
    );
  }

  return (
    <div>
      {/* Page nav */}
      <div className="flex items-center justify-center gap-3 py-2 bg-gray-50 border-b border-gray-100 sticky top-0 z-10">
        <button
          onClick={() => goToPage(currentPage - 1)}
          disabled={currentPage <= 1}
          className="p-1.5 rounded-lg hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <span className="text-xs text-gray-600 tabular-nums">
          Page{" "}
          <span className="font-semibold text-gray-800">{currentPage}</span> of{" "}
          <span className="font-semibold text-gray-800">{pageCount}</span>
        </span>
        <button
          onClick={() => goToPage(currentPage + 1)}
          disabled={currentPage >= pageCount}
          className="p-1.5 rounded-lg hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      </div>

      {/* PDF Canvas with selection overlay */}
      <div
        ref={containerRef}
        className="overflow-auto max-h-[80vh] bg-gray-100 flex justify-center p-4"
      >
        <div
          className="relative inline-block"
          style={{ cursor: "crosshair" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            if (isDragging) handleMouseUp();
          }}
        >
          <canvas ref={canvasRef} className="shadow-lg bg-white" />
          <canvas
            ref={overlayRef}
            className="absolute top-0 left-0 pointer-events-none"
          />
        </div>
      </div>
    </div>
  );
}
