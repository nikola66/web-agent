export type ComposioIntegration = {
  app: string;
  name: string;
  iconSlug: string;
  operations: readonly string[];
};

/** Curated Composio apps surfaced in Settings; mirrors MARKETING_ACTIONS in composio-tools.ts */
export const COMPOSIO_INTEGRATIONS: readonly ComposioIntegration[] = [
  {
    app: "gmail",
    name: "Gmail",
    iconSlug: "gmail",
    operations: [
      "Fetch emails",
      "List drafts",
      "Create draft",
      "Send draft",
      "Send email",
      "Add label to email",
    ],
  },
  {
    app: "googlecalendar",
    name: "Google Calendar",
    iconSlug: "googlecalendar",
    operations: [
      "List events",
      "Get event",
      "Create event",
      "Patch event",
      "Delete event",
      "Find free slots",
    ],
  },
  {
    app: "googlesheets",
    name: "Google Sheets",
    iconSlug: "googlesheets",
    operations: [
      "Batch get",
      "Values get",
      "Append values",
      "Update values",
      "Create row",
      "Upsert rows",
    ],
  },
  {
    app: "linkedin",
    name: "LinkedIn",
    iconSlug: "linkedin",
    operations: ["Create post", "Share article or URL", "Get my info"],
  },
  {
    app: "twitter",
    name: "X",
    iconSlug: "x",
    operations: ["Search recent", "Create post", "List post likers"],
  },
  {
    app: "instagram",
    name: "Instagram",
    iconSlug: "instagram",
    operations: [
      "Get user info",
      "Get user media",
      "Post media",
      "Publish media",
      "Send text message",
      "Send image",
    ],
  },
  {
    app: "hubspot",
    name: "HubSpot",
    iconSlug: "hubspot",
    operations: ["Search contacts", "Create contact", "Update contact"],
  },
  {
    app: "notion",
    name: "Notion",
    iconSlug: "notion",
    operations: ["Search pages", "Create page"],
  },
  {
    app: "slack",
    name: "Slack",
    iconSlug: "slack",
    operations: ["Send message"],
  },
  {
    app: "youtube",
    name: "YouTube",
    iconSlug: "youtube",
    operations: ["Search"],
  },
];
