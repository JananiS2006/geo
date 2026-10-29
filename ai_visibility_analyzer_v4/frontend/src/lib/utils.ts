export function domainOf(url: string): string {
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const KNOWN: Record<string, string> = { clickup: "ClickUp", hubspot: "HubSpot", youtube: "YouTube", linkedin: "LinkedIn", github: "GitHub", paypal: "PayPal", wordpress: "WordPress" };
export function brandFromUrl(url: string): string {
  const name = domainOf(url).split(".")[0] || url;
  return KNOWN[name] ?? name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function scoreTone(n: number) {
  return n >= 70 ? "good" : n >= 45 ? "warn" : "bad";
}

export const TONE_HEX = { good: "#16A34A", warn: "#E59A0B", bad: "#E0465B" } as const;

export function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function download(filename: string, content: string, type = "text/plain") {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
