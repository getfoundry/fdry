/**
 * voltr/src/alerts.ts — Telegram + healthcheck notifications.
 *
 * Identical behavior to ../../bot/src/alerts.ts. Kept as its own copy
 * (not imported) so the voltr workspace is independently deployable to
 * Railway without a monorepo shared/ step.
 *
 * All alert functions are best-effort and fail silently: if env vars are
 * missing, the network is down, or remote returns an error, we log and
 * move on. Rotation MUST NOT block on alert delivery.
 */

export type Severity = "info" | "warn" | "critical";

const SEVERITY_EMOJI: Record<Severity, string> = {
  info: "ℹ️",
  warn: "🟡",
  critical: "🔴",
};

const TELEGRAM_API = "https://api.telegram.org";
const HEALTHCHECK_HOST = "https://hc-ping.com";
const ALERT_TIMEOUT_MS = 5_000;

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

export async function alertTelegram(message: string, severity: Severity = "info"): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const text = `${SEVERITY_EMOJI[severity]} ${message}`;
  const url = `${TELEGRAM_API}/bot${token}/sendMessage`;
  const { signal, cancel } = withTimeout(ALERT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
      signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[alerts] Telegram non-OK ${res.status}: ${body.slice(0, 300)}`);
    }
  } catch (err) {
    console.warn(`[alerts] Telegram send failed: ${(err as Error)?.message ?? err}`);
  } finally {
    cancel();
  }
}

export async function pingHealthcheck(status: "success" | "fail" = "success"): Promise<void> {
  const uuid = process.env.HEALTHCHECK_UUID;
  if (!uuid) return;
  const url = status === "fail" ? `${HEALTHCHECK_HOST}/${uuid}/fail` : `${HEALTHCHECK_HOST}/${uuid}`;
  const { signal, cancel } = withTimeout(ALERT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "POST", signal });
    if (!res.ok) console.warn(`[alerts] healthcheck non-OK ${res.status}`);
  } catch (err) {
    console.warn(`[alerts] healthcheck failed: ${(err as Error)?.message ?? err}`);
  } finally {
    cancel();
  }
}

export async function alertStartup(): Promise<void> {
  const host = process.env.HOSTNAME ?? "unknown-host";
  const cluster = process.env.SOLANA_CLUSTER ?? "unknown-cluster";
  const ts = new Date().toISOString();
  const msg = `<b>fdry voltr bot started</b>\nhost: <code>${host}</code>\ncluster: <code>${cluster}</code>\ntime: <code>${ts}</code>`;
  await alertTelegram(msg, "info");
}

function explorerLink(sig: string): string {
  const cluster = process.env.SOLANA_CLUSTER ?? "mainnet-beta";
  const suffix = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://solscan.io/tx/${sig}${suffix}`;
}

export async function alertRotateOk(sigs: string[], weightsSummary: string): Promise<void> {
  const links = sigs
    .slice(0, 8)
    .map((s) => `<a href="${explorerLink(s)}">${s.slice(0, 8)}…${s.slice(-8)}</a>`)
    .join(", ");
  const msg = `<b>voltr rotate OK</b>\nn_tx: <code>${sigs.length}</code>\nfirst: ${links}\n${weightsSummary}`;
  await Promise.allSettled([alertTelegram(msg, "info"), pingHealthcheck("success")]);
}

export async function alertRotateFail(reason: string): Promise<void> {
  const ts = new Date().toISOString();
  const trimmed = reason.length > 1500 ? `${reason.slice(0, 1500)}…` : reason;
  const msg = `<b>voltr rotate FAILED</b>\ntime: <code>${ts}</code>\nreason: <code>${trimmed}</code>`;
  await Promise.allSettled([alertTelegram(msg, "critical"), pingHealthcheck("fail")]);
}
