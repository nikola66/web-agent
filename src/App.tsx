import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Sidebar } from "./ui/components/Sidebar";
import { Terminal } from "./ui/components/Terminal";
import { ChatInput } from "./ui/components/ChatInput";
import { ArtifactOfferBar } from "./ui/components/ArtifactOfferBar";
import { ClarifyOfferBar } from "./ui/components/ClarifyOfferBar";
import { ErrorBoundary } from "./ui/components/ErrorBoundary";
import { useBrowserMetadata } from "./ui/use-browser-metadata";
import { useActiveProfileRuntime } from "./ui/stores/runtime-store";
import {
  clampSidebarWidthPx,
  SIDEBAR_WIDTH_DEFAULT_PX,
  useSettingsStore,
} from "./ui/stores/settings-store";

const SIDEBAR_SLIDE_MS = 280;
const MOBILE_SIDEBAR_MQ = "(max-width: 767px)";

const AURORA_TOP_STYLE = {
  background: "radial-gradient(ellipse, rgba(251,117,252,0.5) 0%, transparent 70%)",
  filter: "blur(100px)",
} as const;

const AURORA_BOTTOM_STYLE = {
  background: "radial-gradient(ellipse, rgba(75,28,221,0.4) 0%, transparent 70%)",
  filter: "blur(80px)",
} as const;

function mobileSidebarOpenWidthPx(): number {
  const iw = typeof window !== "undefined" ? window.innerWidth : 0;
  const vw = typeof window !== "undefined" ? window.visualViewport?.width ?? 0 : 0;
  const base = Math.max(iw, vw, 1);
  return Math.round(base * 0.9);
}

function isMobileSidebarViewport(): boolean {
  return window.matchMedia(MOBILE_SIDEBAR_MQ).matches;
}

export function App() {
  useBrowserMetadata();

  const sidebarOpen = useSettingsStore((s) => s.sidebarOpen);
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar);
  const sidebarWidthPx = useSettingsStore((s) => s.sidebarWidthPx);
  const setSidebarWidthPx = useSettingsStore((s) => s.setSidebarWidthPx);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRailRef = useRef<HTMLDivElement | null>(null);
  const [sidebarEdgePx, setSidebarEdgePx] = useState(0);
  /** Bumps on window resize so mobile `90vw` rail/targets recompute. */
  const [, setLayoutVersion] = useState(0);

  const { runtimeStatus } = useActiveProfileRuntime();

  const sidebarRailTargetPx = sidebarOpen
    ? isMobileSidebarViewport()
      ? mobileSidebarOpenWidthPx()
      : sidebarWidthPx
    : 0;

  const panelContentWidthPx = isMobileSidebarViewport()
    ? mobileSidebarOpenWidthPx()
    : sidebarWidthPx;
  const sidebarPanelWidthPx = panelContentWidthPx;

  useLayoutEffect(() => {
    const el = sidebarRailRef.current;
    if (!el) return;
    const sync = () => setSidebarEdgePx(Math.round(el.getBoundingClientRect().width));
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    sync();
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!isMobileSidebarViewport()) return;
    if (runtimeStatus !== "booting" && runtimeStatus !== "installing") return;
    if (!sidebarOpen) return;
    let id2 = 0;
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => {
        useSettingsStore.getState().setSidebarOpen(false);
      });
    });
    return () => {
      cancelAnimationFrame(id1);
      cancelAnimationFrame(id2);
    };
  }, [runtimeStatus, sidebarOpen]);

  useEffect(() => {
    let timer: number | null = null;
    const onWinResize = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        setLayoutVersion((v) => v + 1);
        const st = useSettingsStore.getState();
        const w = st.sidebarWidthPx;
        const next = clampSidebarWidthPx(w);
        if (next !== w) setSidebarWidthPx(next);
      }, 120);
    };
    window.addEventListener("resize", onWinResize);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("resize", onWinResize);
    };
  }, [setSidebarWidthPx]);

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (!sidebarOpen) return;
      const startX = e.clientX;
      const startW = useSettingsStore.getState().sidebarWidthPx;
      setIsResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (move: MouseEvent) => {
        setSidebarWidthPx(startW + (move.clientX - startX));
      };
      const onUp = () => {
        setIsResizing(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [sidebarOpen, setSidebarWidthPx]
  );

  const onResizeHandleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!sidebarOpen) return;
      setSidebarWidthPx(SIDEBAR_WIDTH_DEFAULT_PX);
    },
    [sidebarOpen, setSidebarWidthPx]
  );

  return (
    <div className="flex h-full w-full max-md:overflow-x-hidden bg-bg-primary">
      {/* Aurora glow accent */}
      <div
        className="pointer-events-none fixed top-[-200px] left-[-100px] h-[600px] w-[600px] rounded-full opacity-14"
        style={AURORA_TOP_STYLE}
      />
      <div
        className="pointer-events-none fixed right-[-150px] bottom-[-150px] h-[500px] w-[500px] rounded-full opacity-8"
        style={AURORA_BOTTOM_STYLE}
      />

      {/* Sidebar — inner slides on transform; rail width transitions so main column moves in sync */}
      <div
        ref={sidebarRailRef}
        id="app-sidebar"
        className="relative shrink-0 overflow-hidden"
        inert={!sidebarOpen ? true : undefined}
        style={{
          width: sidebarRailTargetPx,
          transitionProperty: "width",
          transitionDuration: isResizing ? "0ms" : `${SIDEBAR_SLIDE_MS}ms`,
          transitionTimingFunction: "var(--ease-out)",
        }}
      >
        <div
          className="relative h-full"
          style={{
            width: sidebarPanelWidthPx,
            transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
            transitionProperty: "transform",
            transitionDuration: isResizing ? "0ms" : `${SIDEBAR_SLIDE_MS}ms`,
            transitionTimingFunction: "var(--ease-out)",
          }}
        >
          <Sidebar />
          {sidebarOpen && (
            <button
              type="button"
              aria-label="Drag to resize sidebar. Double-click to restore default width."
              title="Drag to resize · Double-click for default width"
              className="absolute top-0 right-0 z-10 hidden h-full w-2 cursor-col-resize border-0 bg-transparent p-0 hover:bg-[rgba(255,255,255,0.06)] active:bg-[rgba(255,255,255,0.1)] md:block"
              onMouseDown={onResizeStart}
              onDoubleClick={onResizeHandleDoubleClick}
            />
          )}
        </div>
      </div>

      {/* Main area */}
      <div
        className="terminal-hscroll relative flex min-h-0 w-full flex-col overflow-x-auto overflow-y-hidden max-md:w-[100dvw] max-md:max-w-[100dvw] max-md:min-w-[100dvw] max-md:flex-none max-md:shrink-0 md:min-w-0 md:flex-1"
        style={{
          ["--sidebar-edge" as string]: `${sidebarEdgePx}px`,
        }}
      >
        <ErrorBoundary label="Terminal">
          <Terminal />
        </ErrorBoundary>
        <ArtifactOfferBar />
        <ClarifyOfferBar />
        <ChatInput />
        {sidebarOpen && (
          <button
            type="button"
            aria-label="Close sidebar"
            className="fixed top-0 right-0 bottom-0 z-10 cursor-pointer touch-manipulation border-0 bg-black/25 backdrop-blur-sm md:hidden"
            style={{ left: "var(--sidebar-edge, 0px)" }}
            onClick={toggleSidebar}
          />
        )}
        <button
          type="button"
          onClick={toggleSidebar}
          className="z-20 flex items-center justify-center rounded-sm border p-1 touch-manipulation backdrop-blur-sm transition-colors max-md:fixed max-md:top-2 max-md:z-30 max-md:left-[max(0px,calc(var(--sidebar-edge,0px)+8px))] max-md:border-white max-md:bg-black/55 max-md:text-white md:absolute md:top-2 md:left-2 md:border-white/10 md:bg-black/40 md:text-text-muted md:hover:text-text-primary"
          style={{ transitionDuration: "var(--duration-fast)" }}
          aria-expanded={sidebarOpen}
          aria-controls="app-sidebar"
          aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        >
          {sidebarOpen ? (
            <ChevronLeft size={16} strokeWidth={1.5} />
          ) : (
            <ChevronRight size={16} strokeWidth={1.5} />
          )}
        </button>
      </div>
    </div>
  );
}
