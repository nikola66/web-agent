import { useEffect, useMemo } from "react";
import { mascotForAccentColor } from "./mascots";
import { useProfileStore } from "./stores/profile-store";
import { profileAgentWorking, useRuntimeStore } from "./stores/runtime-store";

const APP_NAME = "Web Agent";
const LOADING_FAVICON = "/icons/favicon-loading.svg";

function ensureFaviconLink(): HTMLLinkElement {
  let link = document.querySelector<HTMLLinkElement>("link#app-favicon");
  if (!link) {
    link = document.createElement("link");
    link.id = "app-favicon";
    document.head.appendChild(link);
  }
  link.rel = "icon";
  return link;
}

export function useBrowserMetadata(): void {
  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const activeProfile = useProfileStore((s) =>
    s.profiles.find((profile) => profile.id === activeProfileId)
  );
  const activeRuntime = useRuntimeStore((s) =>
    activeProfileId ? s.profileRuntime[activeProfileId] : null
  );

  const title = useMemo(() => {
    const agentName = activeProfile?.name?.trim() || APP_NAME;
    return `${agentName} · ${APP_NAME}`;
  }, [activeProfile?.name]);

  const faviconHref = useMemo(() => {
    const isBusy =
      activeRuntime?.runtimeStatus === "booting" ||
      Boolean(activeRuntime && profileAgentWorking(activeRuntime));
    if (isBusy) return LOADING_FAVICON;
    return mascotForAccentColor(activeProfile?.accentColor);
  }, [
    activeProfile?.accentColor,
    activeRuntime?.runtimeStatus,
    activeRuntime?.awaitingResponse,
    activeRuntime?.pendingToolConfirm,
    activeRuntime?.queuedInputs?.length,
  ]);

  useEffect(() => {
    document.title = title;
  }, [title]);

  useEffect(() => {
    const favicon = ensureFaviconLink();
    favicon.href = faviconHref;
  }, [faviconHref]);
}
