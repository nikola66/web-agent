export const BITNET_PROVIDER_ID = "bitnet";

export const DEFAULT_BITNET_DEMO_URL =
  "https://demo-bitnet-h0h8hcfqeqhrf5gf.canadacentral-01.azurewebsites.net";

export function bitnetDemoUrl() {
  return String(process.env.BITNET_DEMO_URL || DEFAULT_BITNET_DEMO_URL).replace(/\/$/, "");
}

export function bitnetDevice() {
  const raw = String(process.env.BITNET_DEVICE || "cpu").trim().toLowerCase();
  return raw === "gpu" || raw === "a100" ? raw : "cpu";
}

export function isBitnetProvider(id) {
  return String(id || "").trim().toLowerCase() === BITNET_PROVIDER_ID;
}
