// Typed fetch wrapper for the AgentProof backend.
// Field names and shapes follow shared/CONTRACT.md exactly — do not invent
// backend fields here.
//
// In dev, calls go to /api/... and the Vite dev proxy forwards them to
// http://localhost:4000. In production the backend is a Netlify Function:
// the app calls it DIRECTLY at /.netlify/functions/api/... because the
// /api redirect proxy drops POST bodies (verified: POST /api/chat hangs,
// direct POST to the function answers immediately).
const API_BASE = import.meta.env.PROD ? '/.netlify/functions/api' : '/api'

export type RiskSeverity = 'low' | 'medium' | 'high'

export interface RiskFlag {
  code: string
  severity: RiskSeverity
  detail: string
}

export interface ChatResponse {
  actionId?: string
  intent: 'transfer_sol' | 'balance' | 'history' | 'explain_tx' | 'unknown'
  summary: string
  explanation?: string
  riskFlags?: RiskFlag[]
  txPreview?: string
  requiresConfirm?: boolean
  amountSol?: number
  to?: string
  blocked?: boolean
  blockReason?: string
  result?: Record<string, unknown>
}

export interface ConfirmResponse {
  actionId: string
  status: 'executed'
  signature: string
  memoSignature: string
  solscan: { tx: string; memo: string }
}

export interface RejectResponse {
  actionId: string
  status: 'rejected'
}

export type ActionStatus = 'pending' | 'executed' | 'rejected' | 'blocked' | 'failed'

export interface ActionRecord {
  id: string
  intent: string
  summary: string
  status: ActionStatus
  amountSol?: number
  to?: string
  signature?: string
  memoSignature?: string
  receiptHash?: string
  createdAt: string
  explanation?: string
  riskFlags?: RiskFlag[]
  recordJson?: string
}

export interface VerifyResponse {
  verified: boolean
  expectedHash: string
  onChainHash: string
  memoSignature: string
}

export interface Limits {
  perTxCapSol: number
  sessionCapSol: number
  sessionSpentSol: number
}

export interface HealthResponse {
  ok: boolean
  slot: number
  demoWallet: string
  demoBalanceSol: number
}

export interface DemoSeedResponse {
  commands: { label: string; message: string }[]
  demoWallet: string
  demoBalanceSol: number
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // path is written as /api/...; API_BASE supplies the right prefix per env.
  const res = await fetch(API_BASE + path.slice('/api'.length), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new ApiError(res.status, (body as { error?: string }).error ?? `Request failed (${res.status})`)
  }
  return body as T
}

export const api = {
  health: () => request<HealthResponse>('/api/health'),
  chat: (message: string, opts: { wallet?: string; demo?: boolean }) =>
    request<ChatResponse>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message, wallet: opts.wallet, demo: opts.demo }),
    }),
  confirm: (actionId: string, signedTx?: string) =>
    request<ConfirmResponse>('/api/confirm', {
      method: 'POST',
      body: JSON.stringify(signedTx ? { actionId, signedTx } : { actionId }),
    }),
  reject: (actionId: string) =>
    request<RejectResponse>('/api/reject', {
      method: 'POST',
      body: JSON.stringify({ actionId }),
    }),
  actions: () => request<{ actions: ActionRecord[] }>('/api/actions'),
  action: (id: string) => request<ActionRecord>(`/api/actions/${id}`),
  verify: (id: string) =>
    request<VerifyResponse>(`/api/verify/${id}`, { method: 'POST' }),
  limits: () => request<Limits>('/api/limits'),
  updateLimits: (patch: { perTxCapSol?: number; sessionCapSol?: number }) =>
    request<Limits>('/api/limits', { method: 'POST', body: JSON.stringify(patch) }),
  demoSeed: () => request<DemoSeedResponse>('/api/demo/seed'),
}

/** Shorten a base58 address, e.g. 9xAb...CdEf. */
export function shortenAddress(addr: string, head = 4, tail = 4): string {
  if (!addr || addr.length <= head + tail + 3) return addr
  return `${addr.slice(0, head)}...${addr.slice(-tail)}`
}
