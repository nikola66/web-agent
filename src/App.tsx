import { useCallback, useEffect, useState } from "react";
import { Sidebar } from "./ui/components/Sidebar";
import { Terminal } from "./ui/components/Terminal";
import { ChatInput } from "./ui/components/ChatInput";
import { ArtifactOfferBar } from "./ui/components/ArtifactOfferBar";
import { ClarifyOfferBar } from "./ui/components/ClarifyOfferBar";
import { useBrowserMetadata } from "./ui/use-browser-metadata";
import {
  clampSidebarWidthPx,
  SIDEBAR_WIDTH_DEFAULT_PX,
  useSettingsStore,
} from "./ui/stores/settings-store";

export function App() {
  useBrowserMetadata();

  const sidebarOpen = useSettingsStore((s) => s.sidebarOpen);
  const sidebarWidthPx = useSettingsStore((s) => s.sidebarWidthPx);
  const setSidebarWidthPx = useSettingsStore((s) => s.setSidebarWidthPx);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    const onWinResize = () => {
      const w = useSettingsStore.getState().sidebarWidthPx;
      const next = clampSidebarWidthPx(w);
      if (next !== w) setSidebarWidthPx(next);
    };
    window.addEventListener("resize", onWinResize);
    return () => window.removeEventListener("resize", onWinResize);
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
    <div className="flex h-full w-full bg-bg-primary">
      {/* Aurora glow accent */}
      <div
        className="pointer-events-none fixed top-[-200px] left-[-100px] h-[600px] w-[600px] rounded-full opacity-14"
        style={{
          background:
            "radial-gradient(ellipse, rgba(251,117,252,0.5) 0%, transparent 70%)",
          filter: "blur(100px)",
        }}
      />
      <div
        className="pointer-events-none fixed right-[-150px] bottom-[-150px] h-[500px] w-[500px] rounded-full opacity-8"
        style={{
          background:
            "radial-gradient(ellipse, rgba(75,28,221,0.4) 0%, transparent 70%)",
          filter: "blur(80px)",
        }}
      />

      {/* Sidebar — width animates when toggling; drag handle sets pixel width */}
      <div
        className="relative shrink-0 overflow-hidden"
        inert={!sidebarOpen ? true : undefined}
        style={{
          width: sidebarOpen ? sidebarWidthPx : 0,
          transitionProperty: "width",
          transitionDuration: isResizing ? "0ms" : "280ms",
          transitionTimingFunction: "var(--ease-out)",
        }}
      >
        <Sidebar />
        {sidebarOpen && (
          <button
            type="button"
            aria-label="Drag to resize sidebar. Double-click to restore default width."
            title="Drag to resize · Double-click for default width"
            className="absolute top-0 right-0 z-10 h-full w-2 cursor-col-resize border-0 bg-transparent p-0 hover:bg-[rgba(255,255,255,0.06)] active:bg-[rgba(255,255,255,0.1)]"
            onMouseDown={onResizeStart}
            onDoubleClick={onResizeHandleDoubleClick}
          />
        )}
      </div>

      {/* Main area */}
      <div className="terminal-hscroll relative flex min-w-0 flex-1 flex-col overflow-x-auto overflow-y-hidden">
        <Terminal />
        <ArtifactOfferBar />
        <ClarifyOfferBar />
        <ChatInput />
      </div>
    </div>
  );
}
