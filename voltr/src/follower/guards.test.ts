import { describe, it, expect } from 'vitest';
import { checkGuards, DEFAULT_FOLLOWER_CAPS } from './guards.js';

const NAV = 100_000;

describe('DEFAULT_FOLLOWER_CAPS', () => {
  it('matches the documented R6 constants', () => {
    expect(DEFAULT_FOLLOWER_CAPS).toEqual({
      trade_cap_pct: 0.01,
      deploy_cap_pct: 0.04,
      day_loss_stop_pct: 0.01,
      hard_stop_pct: 0.02,
      min_signal_size_fdry: 10,
    });
  });
});

describe('checkGuards — happy path & per-trade cap', () => {
  it('accepts at 0.99% of NAV and returns intended size unchanged', () => {
    const r = checkGuards({
      navFdry: NAV,
      deployedFdry: 0,
      dayPnlFdry: 0,
      cumPnlFdry: 0,
      intendedSizeFdry: 990,
    });
    expect(r).toEqual({ ok: true, size_fdry: 990 });
  });

  it('accepts exactly at 1.00% boundary (inclusive)', () => {
    const r = checkGuards({
      navFdry: NAV,
      deployedFdry: 0,
      dayPnlFdry: 0,
      cumPnlFdry: 0,
      intendedSizeFdry: 1000,
    });
    expect(r).toEqual({ ok: true, size_fdry: 1000 });
  });

  it('rejects at 1.01% as per_trade_cap_exceeded', () => {
    const r = checkGuards({
      navFdry: NAV,
      deployedFdry: 0,
      dayPnlFdry: 0,
      cumPnlFdry: 0,
      intendedSizeFdry: 1010,
    });
    expect(r).toEqual({ ok: false, reason: 'per_trade_cap_exceeded' });
  });
});

describe('checkGuards — deploy cap', () => {
  it('rejects when already 4% deployed and a 0.5% new trade pushes total over cap', () => {
    const r = checkGuards({
      navFdry: NAV,
      deployedFdry: 4000,
      dayPnlFdry: 0,
      cumPnlFdry: 0,
      intendedSizeFdry: 500,
    });
    expect(r).toEqual({ ok: false, reason: 'deploy_cap_exceeded' });
  });
});

describe('checkGuards — day stop', () => {
  it('trips at dayPnl = -1.0% NAV', () => {
    const r = checkGuards({
      navFdry: NAV,
      deployedFdry: 0,
      dayPnlFdry: -1000,
      cumPnlFdry: 0,
      intendedSizeFdry: 500,
    });
    expect(r).toEqual({ ok: false, reason: 'day_stop_tripped' });
  });

  it('does NOT trip on a +5% NAV gain (positive pnl ignored)', () => {
    const r = checkGuards({
      navFdry: NAV,
      deployedFdry: 0,
      dayPnlFdry: 5000,
      cumPnlFdry: 0,
      intendedSizeFdry: 500,
    });
    expect(r).toEqual({ ok: true, size_fdry: 500 });
  });
});

describe('checkGuards — hard stop', () => {
  it('trips at cumPnl = -2.5% NAV', () => {
    const r = checkGuards({
      navFdry: NAV,
      deployedFdry: 0,
      dayPnlFdry: 0,
      cumPnlFdry: -2500,
      intendedSizeFdry: 500,
    });
    expect(r).toEqual({ ok: false, reason: 'hard_stop_tripped' });
  });
});

describe('checkGuards — min size', () => {
  it('rejects intendedSize=5 with default min=10', () => {
    const r = checkGuards({
      navFdry: NAV,
      deployedFdry: 0,
      dayPnlFdry: 0,
      cumPnlFdry: 0,
      intendedSizeFdry: 5,
    });
    expect(r).toEqual({ ok: false, reason: 'below_min_size' });
  });
});

describe('checkGuards — invalid input', () => {
  it('rejects navFdry=0', () => {
    const r = checkGuards({
      navFdry: 0,
      deployedFdry: 0,
      dayPnlFdry: 0,
      cumPnlFdry: 0,
      intendedSizeFdry: 100,
    });
    expect(r).toEqual({ ok: false, reason: 'invalid_input' });
  });

  it('rejects negative intendedSize', () => {
    const r = checkGuards({
      navFdry: NAV,
      deployedFdry: 0,
      dayPnlFdry: 0,
      cumPnlFdry: 0,
      intendedSizeFdry: -100,
    });
    expect(r).toEqual({ ok: false, reason: 'invalid_input' });
  });
});

describe('checkGuards — caps overrides & precedence', () => {
  it('honors caps override: trade_cap_pct=0.001 with 0.5% size trips per_trade_cap_exceeded', () => {
    const r = checkGuards({
      navFdry: NAV,
      deployedFdry: 0,
      dayPnlFdry: 0,
      cumPnlFdry: 0,
      intendedSizeFdry: 500, // 0.5% NAV; cap is now 0.1% NAV = 100
      caps: { trade_cap_pct: 0.001 },
    });
    expect(r).toEqual({ ok: false, reason: 'per_trade_cap_exceeded' });
  });

  it('precedence: per_trade_cap_exceeded fires before below_min_size when both apply', () => {
    // trade_cap = 0.0001 -> 10 max; min_signal_size = 1000; intended = 50.
    // 50 > 10 (trade cap exceeded) AND 50 < 1000 (below min). Per-trade fires first.
    const r = checkGuards({
      navFdry: NAV,
      deployedFdry: 0,
      dayPnlFdry: 0,
      cumPnlFdry: 0,
      intendedSizeFdry: 50,
      caps: { trade_cap_pct: 0.0001, min_signal_size_fdry: 1000 },
    });
    expect(r).toEqual({ ok: false, reason: 'per_trade_cap_exceeded' });
  });
});
