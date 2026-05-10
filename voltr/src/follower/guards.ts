// Follower-scoped risk guards for the bridge-source follower.
//
// Pure-function gate: callers pass current NAV/deployed/PnL state and an
// intended trade size (all in $FDRY units, already converted from on-chain
// u64/lamport scale upstream). The guard returns either {ok:true,size_fdry}
// where size_fdry equals the intended size (no auto-shrink in Day 6) or
// {ok:false,reason} with a single canonical reason code.
//
// Distinct from voltr/src/guards.ts, which guards strategy-rotator weights.

export type FollowerCaps = {
  trade_cap_pct: number;
  deploy_cap_pct: number;
  day_loss_stop_pct: number;
  hard_stop_pct: number;
  min_signal_size_fdry: number;
};

export type GuardInput = {
  navFdry: number;
  deployedFdry: number;
  dayPnlFdry: number;
  cumPnlFdry: number;
  intendedSizeFdry: number;
  caps?: Partial<FollowerCaps>;
};

export type GuardResult =
  | { ok: true; size_fdry: number }
  | {
      ok: false;
      reason:
        | 'per_trade_cap_exceeded'
        | 'deploy_cap_exceeded'
        | 'day_stop_tripped'
        | 'hard_stop_tripped'
        | 'below_min_size'
        | 'invalid_input';
    };

export const DEFAULT_FOLLOWER_CAPS: FollowerCaps = {
  trade_cap_pct: 0.01,
  deploy_cap_pct: 0.04,
  day_loss_stop_pct: 0.01,
  hard_stop_pct: 0.02,
  min_signal_size_fdry: 10,
};

function isBadNumber(n: number): boolean {
  return typeof n !== 'number' || Number.isNaN(n) || !Number.isFinite(n);
}

export function checkGuards(input: GuardInput): GuardResult {
  const caps: FollowerCaps = { ...DEFAULT_FOLLOWER_CAPS, ...(input.caps ?? {}) };

  const { navFdry, deployedFdry, dayPnlFdry, cumPnlFdry, intendedSizeFdry } = input;

  // invalid_input: NaN/Inf anywhere, non-positive nav, negative deployed/intended.
  if (
    isBadNumber(navFdry) ||
    isBadNumber(deployedFdry) ||
    isBadNumber(dayPnlFdry) ||
    isBadNumber(cumPnlFdry) ||
    isBadNumber(intendedSizeFdry) ||
    navFdry <= 0 ||
    deployedFdry < 0 ||
    intendedSizeFdry < 0
  ) {
    return { ok: false, reason: 'invalid_input' };
  }

  // Per-trade cap (boundary inclusive).
  if (intendedSizeFdry > navFdry * caps.trade_cap_pct) {
    return { ok: false, reason: 'per_trade_cap_exceeded' };
  }

  // Deploy cap (boundary inclusive).
  if (intendedSizeFdry + deployedFdry > navFdry * caps.deploy_cap_pct) {
    return { ok: false, reason: 'deploy_cap_exceeded' };
  }

  // Day stop: only negative day pnl trips. abs(pnl) >= threshold trips.
  if (dayPnlFdry < 0 && Math.abs(dayPnlFdry) >= navFdry * caps.day_loss_stop_pct) {
    return { ok: false, reason: 'day_stop_tripped' };
  }

  // Hard stop: only negative cumulative pnl trips.
  if (cumPnlFdry < 0 && Math.abs(cumPnlFdry) >= navFdry * caps.hard_stop_pct) {
    return { ok: false, reason: 'hard_stop_tripped' };
  }

  // Min size last so heavier caps fire first.
  if (intendedSizeFdry < caps.min_signal_size_fdry) {
    return { ok: false, reason: 'below_min_size' };
  }

  return { ok: true, size_fdry: intendedSizeFdry };
}
