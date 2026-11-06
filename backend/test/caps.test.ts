import { describe, expect, it } from 'vitest';
import { checkCaps } from '../src/lib/caps';

describe('caps', () => {
  it('allows a transfer inside both caps', () => {
    expect(checkCaps({ amountSol: 0.05, perTxCapSol: 0.1, sessionCapSol: 0.5, sessionSpentSol: 0 }))
      .toEqual({ blocked: false });
  });

  it('blocks a transfer above the per-tx cap', () => {
    const r = checkCaps({ amountSol: 5, perTxCapSol: 0.1, sessionCapSol: 0.5, sessionSpentSol: 0 });
    expect(r.blocked).toBe(true);
    expect(r.blockReason).toContain('per-transaction cap');
  });

  it('blocks at exactly the per-tx cap boundary when above (0.100000001)', () => {
    const r = checkCaps({ amountSol: 0.100000001, perTxCapSol: 0.1, sessionCapSol: 0.5, sessionSpentSol: 0 });
    expect(r.blocked).toBe(true);
  });

  it('allows exactly the per-tx cap amount itself', () => {
    expect(checkCaps({ amountSol: 0.1, perTxCapSol: 0.1, sessionCapSol: 0.5, sessionSpentSol: 0 }).blocked)
      .toBe(false);
  });

  it('blocks when the session cap would be exceeded', () => {
    const r = checkCaps({ amountSol: 0.05, perTxCapSol: 0.1, sessionCapSol: 0.5, sessionSpentSol: 0.48 });
    expect(r.blocked).toBe(true);
    expect(r.blockReason).toContain('session cap');
  });

  it('allows a transfer that lands exactly on the session cap', () => {
    expect(checkCaps({ amountSol: 0.05, perTxCapSol: 0.1, sessionCapSol: 0.5, sessionSpentSol: 0.45 }).blocked)
      .toBe(false);
  });

  it('does not block when no SOL amount is present (reads / token transfers)', () => {
    expect(checkCaps({ amountSol: undefined, perTxCapSol: 0.1, sessionCapSol: 0.5, sessionSpentSol: 0.5 }))
      .toEqual({ blocked: false });
  });
});
