import { isTauri } from "@tauri-apps/api/core";

type AnalyticsCategory = "app" | "pdf" | "export" | "update";
type AnalyticsCommand = [string, ...Array<string | number | boolean>];
declare global {
  interface Window { _hmt?: { push(command: AnalyticsCommand): unknown } }
}
let enabled = false;

/** Use fixed event names and counts, never paths, document contents or error text. */
export function trackEvent(category: AnalyticsCategory, action: string, label = "", value?: number) {
  if (!enabled) return;
  try {
    const command: AnalyticsCommand = ["_trackEvent", category, action, label];
    if (value !== undefined && Number.isFinite(value)) command.push(value);
    window._hmt?.push(command);
  } catch { /* Analytics must never interrupt the application. */ }
}

export function initializeAnalytics() {
  const siteId = import.meta.env.VITE_BAIDU_TONGJI_SITE_ID?.trim();
  if (enabled || !import.meta.env.PROD || !/^[a-f0-9]{32}$/i.test(siteId ?? "")) return;
  try {
    window._hmt ??= [];
    window._hmt.push(["_setAutoPageview", false]);
    window._hmt.push(["_trackPageview", isTauri() ? "/desktop" : "/web"]);
    const script = document.createElement("script");
    script.id = "baidu-tongji";
    script.async = true;
    script.src = `https://hm.baidu.com/hm.js?${siteId}`;
    script.onerror = () => { enabled = false; window._hmt = undefined; script.remove(); };
    document.head.appendChild(script);
    enabled = true;
    trackEvent("app", "launch", isTauri() ? "desktop" : "web");
  } catch { enabled = false; }
}
