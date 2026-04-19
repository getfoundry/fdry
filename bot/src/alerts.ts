/**
 * alerts.ts — Telegram + healthcheck notifications.
 *
 * All alert functions are best-effort and fail silently: if env vars are
 * missing, the network is down, or Telegram/hc-ping returns an error, we log
 * and move on. The bot MUST NOT block on alert delivery — a rebalance cycle
 * must never be aborted because Telegram is down.
 */

export type Severity = 'info' | 'warn' | 'critical';

const SEVERITY_EMOJI: Record<Severity, string> = {
  info: 'ℹ️',
  warn: '🟡',
  critical: '🔴',
};

const TELEGRAM_API = 'https://api.telegram.org';
const HEALTHCHECK_HOST = 'https://hc-ping.com';

/**
 * Short timeout so a hung remote endpoint doesn't stall the caller.
 * Alerts are fire-and-forget; they should never dominate the cycle budget.
 */
const ALERT_TIMEOUT_MS = 5_000;

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}

/**
 * Post `message` to the configured Telegram chat. Prefixed with a severity
 * emoji. Silently returns if TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are unset.
 */
export async function alertTelegram(
  message: string,
  severity: Severity = 'info',
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    // Not configured — this is a valid state (e.g. local dev). Stay quiet.
    return;
  }

  const emoji = SEVERITY_EMOJI[severity];
  const text = `${emoji} ${message}`;

  const url = `${TELEGRAM_API}/bot${token}/sendMessage`;
  const { signal, cancel } = withTimeout(ALERT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal,
    });

    if (!res.ok) {
      // Read a short error body for logging; don't throw.
      let body = '';
      try {
        body = (await res.text()).slice(0, 300);
      } catch {
        /* ignore */
      }
      console.warn(
        `[alerts] Telegram non-OK ${res.status}: ${body}`,
      );
    }
  } catch (err) {
    // Network error, abort, DNS, etc. Swallow — never block on alerts.
    console.warn(
      `[alerts] Telegram send failed: ${(err as Error)?.message ?? err}`,
    );
  } finally {
    cancel();
  }
}

/**
 * Hit the Healthchecks.io dead-man-switch endpoint. Failing to ping is itself
 * what triggers the upstream alert, so we never raise here.
 */
export async function pingHealthcheck(
  status: 'success' | 'fail' = 'success',
): Promise<void> {
  const uuid = process.env.HEALTHCHECK_UUID;
  if (!uuid) return;

  const url =
    status === 'fail' ? `${HEALTHCHECK_HOST}/${uuid}/fail` : `${HEALTHCHECK_HOST}/${uuid}`;

  const { signal, cancel } = withTimeout(ALERT_TIMEOUT_MS);

  try {
    const res = await fetch(url, { method: 'POST', signal });
    if (!res.ok) {
      console.warn(`[alerts] healthcheck non-OK ${res.status}`);
    }
  } catch (err) {
    console.warn(
      `[alerts] healthcheck failed: ${(err as Error)?.message ?? err}`,
    );
  } finally {
    cancel();
  }
}

/**
 * Announce that the bot has started. Useful for catching crash-loops — if you
 * see this alert every minute, something is wrong.
 */
export async function alertStartup(): Promise<void> {
  const host = process.env.HOSTNAME ?? 'unknown-host';
  const cluster = process.env.SOLANA_CLUSTER ?? 'unknown-cluster';
  const ts = new Date().toISOString();
  const msg = `<b>fdry bot started</b>\nhost: <code>${host}</code>\ncluster: <code>${cluster}</code>\ntime: <code>${ts}</code>`;
  await alertTelegram(msg, 'info');
}

function fmtWeights(weights: number[]): string {
  if (!weights.length) return '[]';
  return (
    '[' + weights.map((w) => (w * 100).toFixed(2) + '%').join(', ') + ']'
  );
}

function explorerLink(sig: string): string {
  const cluster = process.env.SOLANA_CLUSTER ?? 'mainnet-beta';
  const suffix =
    cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`;
  return `https://solscan.io/tx/${sig}${suffix}`;
}

/**
 * Report a successful rebalance with old/new weights and a Solscan link.
 * Also pings healthcheck-success so the dead-man switch stays quiet.
 */
export async function alertRebalanceOk(
  sig: string,
  oldWeights: number[],
  newWeights: number[],
): Promise<void> {
  const link = explorerLink(sig);
  const shortSig = sig.length > 16 ? `${sig.slice(0, 8)}…${sig.slice(-8)}` : sig;
  const msg =
    `<b>rebalance OK</b>\n` +
    `tx: <a href="${link}">${shortSig}</a>\n` +
    `old: <code>${fmtWeights(oldWeights)}</code>\n` +
    `new: <code>${fmtWeights(newWeights)}</code>`;

  // Run in parallel; neither should block the other.
  await Promise.allSettled([
    alertTelegram(msg, 'info'),
    pingHealthcheck('success'),
  ]);
}

/**
 * Report a failed rebalance. Pings healthcheck-fail so the upstream monitor
 * escalates if this keeps happening.
 */
export async function alertRebalanceFail(reason: string): Promise<void> {
  const ts = new Date().toISOString();
  // Trim noisy stack traces — Telegram caps at 4096 chars per message.
  const trimmed = reason.length > 1500 ? `${reason.slice(0, 1500)}…` : reason;
  const msg =
    `<b>rebalance FAILED</b>\n` +
    `time: <code>${ts}</code>\n` +
    `reason: <code>${trimmed}</code>`;

  await Promise.allSettled([
    alertTelegram(msg, 'critical'),
    pingHealthcheck('fail'),
  ]);
}
