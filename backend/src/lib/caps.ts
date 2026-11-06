/**
 * Spending caps (CONTRACT.md): per-transaction default 0.1 SOL,
 * session default 0.5 SOL. Enforced in the backend, in code.
 */

export interface CapInput {
  /** Amount in SOL for this transfer; undefined (reads / token transfers) = no SOL cap applies. */
  amountSol?: number;
  perTxCapSol: number;
  sessionCapSol: number;
  sessionSpentSol: number;
}

export interface CapResult {
  blocked: boolean;
  blockReason?: string;
}

export function checkCaps(input: CapInput): CapResult {
  if (input.amountSol === undefined) return { blocked: false };
  if (input.amountSol > input.perTxCapSol) {
    return {
      blocked: true,
      blockReason:
        `Amount ${input.amountSol} SOL exceeds the per-transaction cap of ` +
        `${input.perTxCapSol} SOL.`,
    };
  }
  if (input.sessionSpentSol + input.amountSol > input.sessionCapSol) {
    return {
      blocked: true,
      blockReason:
        `This transfer would take session spending to ` +
        `${round9(input.sessionSpentSol + input.amountSol)} SOL, above the session cap of ` +
        `${input.sessionCapSol} SOL (${input.sessionSpentSol} SOL already spent).`,
    };
  }
  return { blocked: false };
}

export function round9(n: number): number {
  return Math.round(n * 1e9) / 1e9;
}
