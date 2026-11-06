// Solana helpers: Solscan links (DevNet) and Phantom tx signing.
// No fake signatures or balances here — every number comes from the API.

import { Transaction } from '@solana/web3.js'

export const SOLSCAN_CLUSTER = 'devnet'

/** Solscan link for a transaction signature on DevNet. */
export function solscanTxUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}?cluster=devnet`
}

/** Solscan link for an account address on DevNet. */
export function solscanAccountUrl(address: string): string {
  return `https://solscan.io/account/${address}?cluster=devnet`
}

/** Deserialize a base64 unsigned serialized transaction (the txPreview
 *  returned by POST /api/chat) into a web3.js Transaction. */
export function deserializeTx(base64Tx: string): Transaction {
  const bytes = Uint8Array.from(atob(base64Tx), (c) => c.charCodeAt(0))
  return Transaction.from(bytes)
}

/** Serialize a (signed) Transaction back to base64 for POST /api/confirm. */
export function serializeTx(tx: Transaction): string {
  const bytes = tx.serialize()
  let binary = ''
  bytes.forEach((b) => {
    binary += String.fromCharCode(b)
  })
  return btoa(binary)
}

export interface WalletSigner {
  signTransaction: (tx: Transaction) => Promise<Transaction>
}

/**
 * Sign the txPreview with the connected Phantom wallet and return the
 * base64 signed transaction ready for POST /api/confirm {signedTx}.
 * Throws if no wallet signer is provided.
 */
export async function signTxPreview(
  txPreview: string,
  signer: WalletSigner | null | undefined,
): Promise<string> {
  if (!signer) throw new Error('No wallet connected — connect Phantom or switch on Demo wallet.')
  const tx = deserializeTx(txPreview)
  const signed = await signer.signTransaction(tx)
  return serializeTx(signed)
}
