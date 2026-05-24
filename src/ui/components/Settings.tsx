import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Eye, EyeOff, Fish, Globe, Mail, Trash2 } from "lucide-react";
import { useSettingsStore } from "../stores/settings-store";
import { BROWSER_AGENT_PROVIDERS } from "@/core/browseragent";
import {
  COMPOSIO_INTEGRATIONS,
  type ComposioIntegration,
} from "@/core/composio-integrations";

type SettingsFieldDef = {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
};

const EMAIL_SEND_FIELDS: ReadonlyArray<SettingsFieldDef> = [
  { key: "resend_api_key", label: "Resend API key", secret: true, placeholder: "re_..." },
  { key: "resend_from", label: "From address", placeholder: "Agent <agent@yourdomain.com>" },
];

const COMPOSIO_FIELDS: ReadonlyArray<SettingsFieldDef> = [
  { key: "composio_api_key", label: "API key", secret: true, placeholder: "cmp_..." },
];

const inputClass =
  "min-w-0 flex-1 bg-transparent px-2.5 py-1.5 text-[11px] text-text-primary outline-none transition-all placeholder:text-text-muted";

const inputStyle = {
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  transitionDuration: "var(--duration-fast)",
} as const;

function SectionIcon(props: { children: ReactNode }) {
  return <span className="shrink-0 text-text-muted">{props.children}</span>;
}

function ComposioMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-3 w-3" aria-hidden="true" fill="currentColor">
      <path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 3.5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z" />
    </svg>
  );
}

function SettingsHeading(props: {
  icon: ReactNode;
  title: string;
  link?: { href: string; label: string };
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <SectionIcon>{props.icon}</SectionIcon>
        <h3 className="text-xs font-semibold text-text-primary">{props.title}</h3>
      </div>
      {props.link ? <SettingsExternalLink href={props.link.href}>{props.link.label}</SettingsExternalLink> : null}
    </div>
  );
}

function SettingsDivider() {
  return (
    <div className="py-5" role="separator" aria-hidden="true">
      <div className="border-t border-white/10" />
    </div>
  );
}

function SettingsGroup(props: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-col gap-3 ${props.className ?? ""}`}>{props.children}</div>;
}

function SettingsExternalLink(props: { href: string; children: ReactNode }) {
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noreferrer"
      className="shrink-0 text-[10px] text-text-muted underline underline-offset-2 hover:text-text-secondary"
    >
      {props.children}
    </a>
  );
}

function SettingsBlock(props: {
  icon?: ReactNode;
  title: string;
  link?: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {props.icon ? <SectionIcon>{props.icon}</SectionIcon> : null}
          <h4 className="text-[10px] font-medium text-text-secondary">{props.title}</h4>
        </div>
        {props.link ? <SettingsExternalLink href={props.link.href}>{props.link.label}</SettingsExternalLink> : null}
      </div>
      {props.children}
    </div>
  );
}

function SettingsField(props: {
  field: SettingsFieldDef;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggleVisibility?: () => void;
  onRemove?: () => void;
}) {
  const { field, value, onChange, visible, onToggleVisibility, onRemove } = props;
  const isSecret = !!field.secret;
  const inputId = `${field.key}-input`;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label className="text-[10px] font-medium text-text-secondary" htmlFor={inputId}>
        {field.label}
      </label>
      <div className="flex min-w-0 items-center gap-1">
        <input
          id={inputId}
          type={isSecret && !visible ? "password" : "text"}
          placeholder={field.placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
          style={inputStyle}
          autoComplete={isSecret ? "off" : undefined}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--color-brand-magenta-light)";
            e.currentTarget.style.boxShadow = "0 0 12px var(--color-glow-subtle)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--color-border)";
            e.currentTarget.style.boxShadow = "none";
          }}
        />
        {isSecret && onToggleVisibility ? (
          <button
            type="button"
            className="shrink-0 rounded-sm p-1.5 text-text-muted transition-colors hover:text-text-primary"
            aria-label={visible ? "Hide API key" : "Show API key"}
            onClick={onToggleVisibility}
          >
            {visible ? <EyeOff size={13} strokeWidth={1.5} /> : <Eye size={13} strokeWidth={1.5} />}
          </button>
        ) : null}
        {onRemove && value ? (
          <button
            type="button"
            className="shrink-0 rounded-sm p-1.5 text-text-muted transition-colors hover:text-red-400"
            aria-label="Remove API key"
            onClick={onRemove}
          >
            <Trash2 size={13} strokeWidth={1.5} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ComposioBrandIcon(props: { app: string; iconSlug: string }) {
  const className = "h-3.5 w-3.5 opacity-80";
  if (props.app === "linkedin") {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a-2.116 2.116 0 1 1 0-4.232 2.116 2.116 0 0 1 0 4.232zM7.119 20.452H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    );
  }
  if (props.app === "slack") {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
        <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
      </svg>
    );
  }
  return (
    <img
      src={`https://cdn.simpleicons.org/${props.iconSlug}/ffffff`}
      alt=""
      className={className}
      loading="lazy"
    />
  );
}

function ComposioIntegrationLogos() {
  const [active, setActive] = useState<ComposioIntegration | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  const showTooltip = (integration: ComposioIntegration, target: HTMLElement) => {
    setActive(integration);
    setAnchor(target.getBoundingClientRect());
  };

  const hideTooltip = () => {
    setActive(null);
    setAnchor(null);
  };

  useEffect(() => {
    if (!active) return;
    const onScroll = () => hideTooltip();
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [active]);

  const tooltip =
    active && anchor
      ? createPortal(
          <div
            className="pointer-events-none fixed z-50 w-44 rounded-sm border border-white/10 bg-[var(--color-bg-elevated)] px-2 py-1.5 shadow-lg"
            style={{
              top: anchor.bottom + 6,
              left: Math.max(8, Math.min(anchor.left, window.innerWidth - 184)),
            }}
            aria-live="polite"
          >
            <p className="text-[10px] font-medium text-text-primary">{active.name}</p>
            <ul className="mt-0.5 flex flex-col gap-0.5">
              {active.operations.map((operation) => (
                <li key={operation} className="text-[9px] leading-snug text-text-muted">
                  {operation}
                </li>
              ))}
            </ul>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {COMPOSIO_INTEGRATIONS.map((integration) => {
          const isActive = active?.app === integration.app;
          return (
            <button
              key={integration.app}
              type="button"
              className={`flex h-7 w-7 items-center justify-center rounded-sm border text-white transition-colors ${
                isActive
                  ? "border-white/25 bg-white/10"
                  : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10"
              }`}
              aria-label={`${integration.name} operations`}
              onMouseEnter={(e) => showTooltip(integration, e.currentTarget)}
              onMouseLeave={hideTooltip}
              onFocus={(e) => showTooltip(integration, e.currentTarget)}
              onBlur={hideTooltip}
            >
              <ComposioBrandIcon app={integration.app} iconSlug={integration.iconSlug} />
            </button>
          );
        })}
      </div>
      {tooltip}
    </>
  );
}

export function SettingsPanel() {
  const { apiKeys, setApiKey, removeApiKey } = useSettingsStore();
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());

  const toggleVisibility = (key: string) => {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const peekKey = (fieldKey: string) => `${fieldKey}__peek`;

  return (
    <div className="flex flex-col">
      <SettingsGroup>
        <SettingsHeading icon={<Globe size={12} strokeWidth={1.75} />} title="Web tools" />
        <SettingsBlock
          icon={<ComposioMark />}
          title="Composio"
          link={{ href: "https://dashboard.composio.dev", label: "Dashboard" }}
        >
          <ComposioIntegrationLogos />
          {COMPOSIO_FIELDS.map((field) => (
            <SettingsField
              key={field.key}
              field={field}
              value={apiKeys[field.key] || ""}
              onChange={(value) => setApiKey(field.key, value)}
              visible={visibleKeys.has(peekKey(field.key))}
              onToggleVisibility={() => toggleVisibility(peekKey(field.key))}
              onRemove={() => removeApiKey(field.key)}
            />
          ))}
        </SettingsBlock>
      </SettingsGroup>

      {BROWSER_AGENT_PROVIDERS.map((provider) => {
        const settingKey = provider.auth?.settingKey;
        if (!settingKey) return null;
        return (
          <div key={provider.id}>
            <SettingsDivider />
            <SettingsGroup>
              <SettingsBlock
                icon={<Fish size={12} strokeWidth={1.75} />}
                title={provider.name}
                link={provider.docsUrl ? { href: provider.docsUrl, label: "Get key" } : undefined}
              >
                <p className="text-[10px] leading-relaxed text-text-muted">
                  Enables <span className="font-mono">web_search</span> and{" "}
                  <span className="font-mono">web_fetch</span>.
                </p>
                <SettingsField
                  field={{
                    key: settingKey,
                    label: "API key",
                    secret: true,
                    placeholder: provider.auth?.placeholder || "Enter API key",
                  }}
                  value={apiKeys[settingKey] || ""}
                  onChange={(value) => setApiKey(settingKey, value)}
                  visible={visibleKeys.has(settingKey)}
                  onToggleVisibility={() => toggleVisibility(settingKey)}
                  onRemove={() => removeApiKey(settingKey)}
                />
              </SettingsBlock>
            </SettingsGroup>
          </div>
        );
      })}

      <SettingsDivider />

      <SettingsGroup>
        <SettingsHeading
          icon={<Mail size={12} strokeWidth={1.75} />}
          title="Email"
          link={{ href: "https://resend.com/api-keys", label: "Get key" }}
        />
        <p className="text-[10px] leading-relaxed text-text-muted">
          Send mail through your verified <span className="font-semibold text-text-primary">Resend</span>{" "}
          sender.
        </p>
        {EMAIL_SEND_FIELDS.map((field) => (
          <SettingsField
            key={field.key}
            field={field}
            value={apiKeys[field.key] || ""}
            onChange={(value) => setApiKey(field.key, value)}
            visible={visibleKeys.has(peekKey(field.key))}
            onToggleVisibility={field.secret ? () => toggleVisibility(peekKey(field.key)) : undefined}
          />
        ))}
      </SettingsGroup>
    </div>
  );
}
