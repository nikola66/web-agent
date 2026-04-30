import { useState, type ReactNode } from "react";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import { useSettingsStore } from "../stores/settings-store";
import { BROWSER_AGENT_PROVIDERS } from "@/core/browseragent";

/** Settings keys mirrored into agent env by the adapter. */
type EmailField = {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
  hint?: string;
};

const EMAIL_SEND_FIELDS: ReadonlyArray<EmailField> = [
  {
    key: "resend_api_key",
    label: "Resend API key",
    secret: true,
    placeholder: "re_...",
    hint: "Resend dashboard",
  },
  {
    key: "resend_from",
    label: "From address",
    placeholder: "Agent <agent@yourdomain.com>",
    hint: "Verified in Resend",
  },
];

function SettingsSection(props: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-md border border-white/10 bg-white/2 p-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-xs font-semibold text-text-primary">{props.title}</h3>
        <p className="text-[10px] leading-relaxed text-text-muted">{props.subtitle}</p>
      </div>
      {props.children}
    </section>
  );
}

function EmailCredentialGrid(props: {
  fields: readonly EmailField[];
  apiKeys: Record<string, string>;
  setApiKey: (key: string, value: string) => void;
  visibleKeys: ReadonlySet<string>;
  toggleVisibility: (peekKey: string) => void;
}) {
  const { fields, apiKeys, setApiKey, visibleKeys, toggleVisibility } = props;
  return (
    <div className="grid grid-cols-1 gap-3">
      {fields.map((field) => {
        const vk = `${field.key}__peek`;
        const isSecret = !!field.secret;
        const keyVisible = visibleKeys.has(vk);
        return (
          <div key={field.key} className="flex min-w-0 flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2">
              <label className="text-[10px] font-medium text-text-secondary" htmlFor={field.key}>
                {field.label}
              </label>
              {field.hint ? <span className="shrink-0 text-[9px] text-text-muted">{field.hint}</span> : null}
            </div>
            <div className="flex flex-col gap-1">
              <input
                id={field.key}
                type={isSecret && !keyVisible ? "password" : "text"}
                placeholder={field.placeholder}
                value={apiKeys[field.key] || ""}
                onChange={(e) => setApiKey(field.key, e.target.value)}
                className="w-full bg-transparent px-2 py-1.5 text-[11px] text-text-primary outline-none placeholder:text-text-muted"
                style={{
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-sm)",
                }}
                autoComplete={isSecret ? "off" : undefined}
              />
              {isSecret ? (
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="rounded-sm p-1.5 text-text-muted hover:text-text-primary"
                    aria-label={`Toggle ${field.label} visibility`}
                    onClick={() => toggleVisibility(vk)}
                  >
                    {keyVisible ? <EyeOff size={13} strokeWidth={1.5} /> : <Eye size={13} strokeWidth={1.5} />}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function SettingsPanel() {
  const { apiKeys, setApiKey, removeApiKey } = useSettingsStore();
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());

  const toggleVisibility = (provider: string) => {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {BROWSER_AGENT_PROVIDERS.map((provider) => {
        const settingKey = provider.auth?.settingKey;
        if (!settingKey) return null;
        const hasKey = !!apiKeys[settingKey];
        const keyVisible = visibleKeys.has(settingKey);
        const inputId = `${settingKey}-input`;
        return (
          <SettingsSection
            key={provider.id}
            title="Web tools"
            subtitle={
              <>
                Add a <span className="font-semibold text-text-primary">{provider.name}</span> key to enable{" "}
                <span className="font-mono">web_search</span> and <span className="font-mono">web_fetch</span>
                {provider.docsUrl ? (
                  <>
                    .{" "}
                    <a
                      href={provider.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2 hover:text-text-secondary"
                    >
                      Get key
                    </a>
                  </>
                ) : null}
                .
              </>
            }
          >
            <div className="flex flex-col gap-1.5">
              <label className="sr-only" htmlFor={inputId}>
                {provider.name} API key
              </label>
              <input
                id={inputId}
                type={keyVisible ? "text" : "password"}
                placeholder={provider.auth?.placeholder || "Enter API key"}
                value={apiKeys[settingKey] || ""}
                onChange={(e) => setApiKey(settingKey, e.target.value)}
                className="w-full bg-transparent px-3 py-2 text-xs text-text-primary outline-none transition-all placeholder:text-text-muted"
                style={{
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-sm)",
                  transitionDuration: "var(--duration-fast)",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "var(--color-brand-magenta-light)";
                  e.currentTarget.style.boxShadow = "0 0 15px var(--color-glow-subtle)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "var(--color-border)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              />
              {hasKey && (
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => toggleVisibility(settingKey)}
                    className="rounded-sm p-1.5 text-text-muted transition-colors hover:text-text-primary"
                    aria-label={keyVisible ? "Hide API key" : "Show API key"}
                    style={{
                      borderRadius: "var(--radius-sm)",
                      transitionDuration: "var(--duration-fast)",
                    }}
                  >
                    {keyVisible ? (
                      <EyeOff size={14} strokeWidth={1.5} />
                    ) : (
                      <Eye size={14} strokeWidth={1.5} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeApiKey(settingKey)}
                    className="rounded-sm p-1.5 text-text-muted transition-colors hover:text-red-400"
                    aria-label="Remove API key"
                    style={{
                      borderRadius: "var(--radius-sm)",
                      transitionDuration: "var(--duration-fast)",
                    }}
                  >
                    <Trash2 size={14} strokeWidth={1.5} />
                  </button>
                </div>
              )}
            </div>
          </SettingsSection>
        );
      })}

      <SettingsSection
        title="Email"
        subtitle={
          <>
            Send mail through your verified <span className="font-semibold text-text-primary">Resend</span> sender.{" "}
            <a
              href="https://resend.com/api-keys"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-text-secondary"
            >
              Get key
            </a>
            .
          </>
        }
      >
        <EmailCredentialGrid
          fields={EMAIL_SEND_FIELDS}
          apiKeys={apiKeys}
          setApiKey={setApiKey}
          visibleKeys={visibleKeys}
          toggleVisibility={toggleVisibility}
        />
      </SettingsSection>
    </div>
  );
}
