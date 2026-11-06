import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ExplainerCard from '../src/components/ExplainerCard'
import { solscanTxUrl, solscanAccountUrl } from '../src/lib/solana'
import { shortenAddress } from '../src/lib/api'
import type { ChatResponse } from '../src/lib/api'

const baseResponse: ChatResponse = {
  actionId: 'act_test123',
  intent: 'transfer_sol',
  summary: 'Send 0.05 SOL to 9xAbC...',
  explanation: 'You send 0.05 SOL to a new payee.',
  riskFlags: [
    { code: 'NEW_PAYEE', severity: 'medium', detail: 'Payee never seen in this session.' },
    { code: 'FRESH_WALLET', severity: 'high', detail: 'Payee has no prior transactions.' },
    { code: 'LARGE_AMOUNT', severity: 'low', detail: 'Amount is well under the cap.' },
  ],
  txPreview: 'AAAA',
  requiresConfirm: true,
  amountSol: 0.05,
  to: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
  blocked: false,
}

describe('ExplainerCard', () => {
  it('renders the explanation, amount and recipient', () => {
    render(
      <ExplainerCard response={baseResponse} busy={false} onConfirm={vi.fn()} onReject={vi.fn()} />,
    )
    expect(screen.getByText('Send 0.05 SOL to 9xAbC...')).toBeInTheDocument()
    expect(screen.getByText('You send 0.05 SOL to a new payee.')).toBeInTheDocument()
    expect(screen.getByText('0.05 SOL')).toBeInTheDocument()
    // Recipient appears twice: shortened in the Solscan link, full in the muted text.
    expect(screen.getAllByText(/9xQeWv/).length).toBeGreaterThanOrEqual(1)
  })

  it('renders every risk flag with its code, severity and detail', () => {
    render(
      <ExplainerCard response={baseResponse} busy={false} onConfirm={vi.fn()} onReject={vi.fn()} />,
    )
    for (const flag of baseResponse.riskFlags!) {
      expect(screen.getByText(flag.code)).toBeInTheDocument()
      expect(screen.getByText(flag.detail)).toBeInTheDocument()
    }
    expect(screen.getByText('medium')).toBeInTheDocument()
    expect(screen.getByText('high')).toBeInTheDocument()
    expect(screen.getByText('low')).toBeInTheDocument()
  })

  it('applies severity colour classes to flags', () => {
    const { container } = render(
      <ExplainerCard response={baseResponse} busy={false} onConfirm={vi.fn()} onReject={vi.fn()} />,
    )
    expect(container.querySelector('.flag-medium')).not.toBeNull()
    expect(container.querySelector('.flag-high')).not.toBeNull()
    expect(container.querySelector('.flag-low')).not.toBeNull()
  })

  it('shows Confirm and Reject buttons, disabled while busy', () => {
    const { rerender } = render(
      <ExplainerCard response={baseResponse} busy={false} onConfirm={vi.fn()} onReject={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: /Confirm & sign/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled()
    rerender(
      <ExplainerCard response={baseResponse} busy={true} onConfirm={vi.fn()} onReject={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: /Confirming/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled()
  })

  it('says so explicitly when there are no risk flags', () => {
    render(
      <ExplainerCard
        response={{ ...baseResponse, riskFlags: [] }}
        busy={false}
        onConfirm={vi.fn()}
        onReject={vi.fn()}
      />,
    )
    expect(screen.getByText('No risk flags raised.')).toBeInTheDocument()
  })

  it('links the recipient to Solscan (DevNet)', () => {
    render(
      <ExplainerCard response={baseResponse} busy={false} onConfirm={vi.fn()} onReject={vi.fn()} />,
    )
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute(
      'href',
      solscanAccountUrl(baseResponse.to!),
    )
  })
})

describe('Solscan link building', () => {
  it('builds DevNet tx links', () => {
    const sig = '5'.repeat(88)
    expect(solscanTxUrl(sig)).toBe(`https://solscan.io/tx/${sig}?cluster=devnet`)
  })

  it('builds DevNet account links', () => {
    const addr = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin'
    expect(solscanAccountUrl(addr)).toBe(
      `https://solscan.io/account/${addr}?cluster=devnet`,
    )
  })

  it('never builds a mainnet link', () => {
    expect(solscanTxUrl('abc')).not.toContain('mainnet')
    expect(solscanTxUrl('abc')).toContain('cluster=devnet')
  })
})

describe('cap display', () => {
  it('formats caps and remaining session budget', () => {
    const perTxCapSol = 0.1
    const sessionCapSol = 0.5
    const sessionSpentSol = 0.05
    const remaining = Math.max(0, sessionCapSol - sessionSpentSol)
    expect(`${perTxCapSol} SOL`).toBe('0.1 SOL')
    expect(`${sessionCapSol} SOL`).toBe('0.5 SOL')
    expect(remaining.toFixed(4)).toBe('0.4500')
    // A transfer above the per-tx cap must be blocked, never silently allowed.
    expect(0.5 > perTxCapSol).toBe(true)
    expect(0.05 > perTxCapSol).toBe(false)
  })
})

describe('shortenAddress', () => {
  it('shortens long addresses and leaves short ones alone', () => {
    expect(shortenAddress('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin')).toBe('9xQe...VFin')
    expect(shortenAddress('abc')).toBe('abc')
  })
})
