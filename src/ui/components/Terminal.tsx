import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import type { IUnicodeVersionProvider } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { terminalFontFamily, terminalTheme } from "../theme";
import { attachProfileTerminal, detachTerminal, notifyAgentTerminalResized, switchToProfile } from "@/core/orchestrator";
import { fitTerminalForViewport } from "@/core/xterm-fit-viewport";
import { useRuntimeStore } from "../stores/runtime-store";
import { useProfileStore } from "../stores/profile-store";

const RESIZE_OBSERVER_DEBOUNCE_MS = 400;
const WINDOW_RESIZE_DEBOUNCE_MS = 250;
const BRAND_URL_WITH_REFERRER = "https://aratech.ae/?referrer=web-agent";

/** Matches Tailwind `md` — stacked banner fits narrow terminal cols without wrapping mid-logo. */
const MOBILE_ASCII_BANNER_MQ = "(max-width: 767px)";

const BANNER_ROW_COLORS = [
  "38;2;251;117;252",
  "38;2;200;51;247",
  "38;2;138;56;245",
  "38;2;104;35;229",
  "38;2;75;28;221",
  "38;2;75;28;221",
] as const;

const BANNER_DESKTOP_LINES = [
  "  ██╗    ██╗███████╗██████╗      █████╗  ██████╗ ███████╗███╗   ██╗████████╗",
  "  ██║    ██║██╔════╝██╔══██╗    ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝",
  "  ██║ █╗ ██║█████╗  ██████╔╝    ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ",
  "  ██║███╗██║██╔══╝  ██╔══██╗    ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ",
  "  ╚███╔███╔╝███████╗██████╔╝    ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ",
  "   ╚══╝╚══╝ ╚══════╝╚═════╝     ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ",
] as const;

const WEB_BANNER_LINES = [
  "  ██╗    ██╗███████╗██████╗",
  "  ██║    ██║██╔════╝██╔══██╗",
  "  ██║ █╗ ██║█████╗  ██████╔╝",
  "  ██║███╗██║██╔══╝  ██╔══██╗",
  "  ╚███╔███╔╝███████╗██████╔╝",
  "   ╚══╝╚══╝ ╚══════╝╚═════╝",
] as const;

const AGENT_BANNER_LINES = [
  "  █████╗  ██████╗ ███████╗███╗   ██╗████████╗",
  "  ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝",
  "  ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║",
  "  ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║",
  "  ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║",
  "  ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝",
] as const;

interface TerminalEntry {
  terminal: XTerm;
  fitAddon: FitAddon;
  container: HTMLDivElement;
}

function charProperties(width: 0 | 1 | 2, shouldJoin = false): number {
  return (width << 1) | (shouldJoin ? 1 : 0);
}

function propertyWidth(properties: number): 0 | 1 | 2 {
  return ((properties >> 1) & 3) as 0 | 1 | 2;
}

function isWideEmoji(codepoint: number): boolean {
  return /\p{Extended_Pictographic}/u.test(String.fromCodePoint(codepoint));
}

function createEmojiUnicodeProvider(): IUnicodeVersionProvider {
  let base: IUnicodeVersionProvider | null = null;
  new Unicode11Addon().activate({ unicode: { register: (provider: IUnicodeVersionProvider) => { base = provider; } } } as XTerm);
  const provider = base!;
  return {
    version: "webagent-emoji",
    wcwidth: (codepoint) => (isWideEmoji(codepoint) ? 2 : provider.wcwidth(codepoint)),
    charProperties: (codepoint, preceding) => {
      if (codepoint === 0xfe0f && propertyWidth(preceding) > 0) return charProperties(2, true);
      if (isWideEmoji(codepoint)) return charProperties(2);
      return provider.charProperties(codepoint, preceding);
    },
  };
}

function writeWelcomeBanner(terminal: XTerm): void {
  terminal.writeln("");
  const stacked =
    typeof window !== "undefined" && window.matchMedia(MOBILE_ASCII_BANNER_MQ).matches;
  const writeBlock = (bodies: readonly string[]) => {
    for (let i = 0; i < bodies.length; i++) {
      terminal.writeln(`\x1b[${BANNER_ROW_COLORS[i]}m${bodies[i]}\x1b[0m`);
    }
  };
  if (stacked) {
    writeBlock(WEB_BANNER_LINES);
    terminal.writeln("");
    writeBlock(AGENT_BANNER_LINES);
  } else {
    writeBlock(BANNER_DESKTOP_LINES);
  }
  terminal.writeln("");
  terminal.writeln(
    `\x1b[38;2;188;50;214m  Browser-native agent · profiles · tools\x1b[0m  \x1b[90m— by \x1b[0m\x1b]8;;${BRAND_URL_WITH_REFERRER}\x07\x1b[97maratech\x1b[0m\x1b]8;;\x07`
  );
  terminal.writeln(
    "\x1b[90m  Zero installs, isolated, secured and self-evolving agent.\x1b[0m"
  );
  terminal.writeln("");
}

export function Terminal() {
  const mainRef = useRef<HTMLDivElement>(null);
  const instancesRef = useRef<Map<string, TerminalEntry>>(new Map());
  const prevProfileId = useRef<string | null>(null);
  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const [, setIsOnboarding] = useState(false);

  function getOrCreateEntry(profileId: string): TerminalEntry {
    if (instancesRef.current.has(profileId)) {
      return instancesRef.current.get(profileId)!;
    }

    // Create container for this profile's terminal
    const container = document.createElement("div");
    container.style.cssText = "position:absolute;inset:0;display:none";
    mainRef.current?.appendChild(container);

    // Create xterm instance
    const terminal = new XTerm({
      theme: terminalTheme,
      fontFamily: terminalFontFamily,
      fontSize: 14,
      lineHeight: 1.35,
      letterSpacing: 0.1,
      cursorBlink: true,
      cursorStyle: "bar",
      allowTransparency: true,
      allowProposedApi: true,
      scrollback: 10000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    const unicode11Addon = new Unicode11Addon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(unicode11Addon);
    terminal.unicode.register(createEmojiUnicodeProvider());
    terminal.unicode.activeVersion = "webagent-emoji";
    terminal.open(container);

    // Store fitAddon on terminal for switchToProfile to access
    (terminal as any).__fitAddon = fitAddon;

    // Register with orchestrator
    attachProfileTerminal(profileId, terminal);

    // Show the same initial welcome screen for every profile terminal.
    writeWelcomeBanner(terminal);

    // Keyboard shortcuts (copy via Ctrl+C)
    terminal.attachCustomKeyEventHandler((event) => {
      if (
        event.type === "keydown" &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "c"
      ) {
        const selected = terminal.getSelection();
        if (selected) {
          void navigator.clipboard.writeText(selected).catch(() => {
            /* clipboard may be blocked by browser policy */
          });
          terminal.clearSelection();
        }
        return false;
      }
      return true;
    });

    const entry = { terminal, fitAddon, container };
    instancesRef.current.set(profileId, entry);
    return entry;
  }

  // On activeProfileId change: switch terminal
  useEffect(() => {
    if (!mainRef.current || !activeProfileId) return;

    // Hide previous
    const prev = prevProfileId.current;
    if (prev && instancesRef.current.has(prev)) {
      instancesRef.current.get(prev)!.container.style.display = "none";
    }

    // Create or show active
    const entry = getOrCreateEntry(activeProfileId);
    entry.container.style.display = "block";
    prevProfileId.current = activeProfileId;

    // Trigger switch in orchestrator and fit
    void switchToProfile(activeProfileId);
    entry.terminal.focus();
  }, [activeProfileId]);

  // Resizing and cleanup
  useEffect(() => {
    if (!mainRef.current) return;

    const fitOnlyActive = () => {
      const active = prevProfileId.current;
      if (active && instancesRef.current.has(active)) {
        const { terminal, fitAddon } = instancesRef.current.get(active)!;
        fitTerminalForViewport(terminal, fitAddon);
      }
    };

    const fitAndNotifyPty = () => {
      fitOnlyActive();
      notifyAgentTerminalResized();
    };

    const scheduleFitAndNotifyPty = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(fitAndNotifyPty);
      });
    };

    let roDebounceTimer: number | null = null;
    const debouncedResizeObserverFit = () => {
      if (roDebounceTimer) window.clearTimeout(roDebounceTimer);
      roDebounceTimer = window.setTimeout(() => {
        roDebounceTimer = null;
        fitAndNotifyPty();
      }, RESIZE_OBSERVER_DEBOUNCE_MS);
    };

    let winDebounceTimer: number | null = null;
    const debouncedWindowResize = () => {
      if (winDebounceTimer) window.clearTimeout(winDebounceTimer);
      winDebounceTimer = window.setTimeout(() => {
        winDebounceTimer = null;
        scheduleFitAndNotifyPty();
      }, WINDOW_RESIZE_DEBOUNCE_MS);
    };

    // Initial fit
    scheduleFitAndNotifyPty();

    const el = mainRef.current;
    const ro = new ResizeObserver(() => {
      debouncedResizeObserverFit();
    });
    ro.observe(el);

    const lateFitTimers = [
      window.setTimeout(scheduleFitAndNotifyPty, 50),
      window.setTimeout(scheduleFitAndNotifyPty, 200),
      window.setTimeout(scheduleFitAndNotifyPty, 500),
    ];

    // Runtime status subscription for PTY resize notification
    let prevRunning = false;
    const unsubAgent = useRuntimeStore.subscribe((s) => {
      const active = prevProfileId.current;
      const running = !!(active && s.runningProfileIds.includes(active));
      if (running && !prevRunning) {
        requestAnimationFrame(() => {
          notifyAgentTerminalResized();
        });
      }
      prevRunning = running;
    });

    const handleResize = () => {
      debouncedWindowResize();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      unsubAgent();
      if (roDebounceTimer) window.clearTimeout(roDebounceTimer);
      if (winDebounceTimer) window.clearTimeout(winDebounceTimer);
      ro.disconnect();
      for (const id of lateFitTimers) window.clearTimeout(id);
      window.removeEventListener("resize", handleResize);

      // Cleanup: dispose all terminals
      for (const [, entry] of instancesRef.current) {
        entry.terminal.dispose();
        entry.container.remove();
      }
      instancesRef.current.clear();
      detachTerminal();
    };
  }, []);

  return (
    <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden md:min-w-[800px]">
      <div
        ref={mainRef}
        className="h-full w-full"
        style={{ position: "relative" }}
      />
    </div>
  );
}
