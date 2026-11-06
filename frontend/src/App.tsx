import { useEffect, useMemo, useState } from 'react'
import { ConnectionProvider, WalletProvider, useWallet } from '@solana/wallet-adapter-react'
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom'
import { clusterApiUrl } from '@solana/web3.js'
import Chat from './pages/Chat'
import Audit from './pages/Audit'
import Settings from './pages/Settings'
import TrustFooter from './components/TrustFooter'
import { api, type HealthResponse } from './lib/api'

import '@solana/wallet-adapter-react-ui/styles.css'

type Tab = 'chat' | 'audit' | 'settings'

function Header({
  tab,
  setTab,
  demo,
  setDemo,
  health,
}: {
  tab: Tab
  setTab: (t: Tab) => void
  demo: boolean
  setDemo: (v: boolean) => void
  health: HealthResponse | null
}) {
  const { publicKey, connected } = useWallet()
  return (
    <header className="app-header">
      <div className="brand">
        <h1>AgentProof</h1>
        <span className="badge badge-devnet">DevNet</span>
        <span className="muted small tagline">AI agent on Solana — explained before you sign, proven after.</span>
      </div>
      <div className="header-right">
        {health && (
          <span className="muted small" title={`Demo wallet ${health.demoWallet}`}>
            Demo wallet: {health.demoBalanceSol} SOL · slot {health.slot}
          </span>
        )}
        <label className="demo-toggle">
          <input
            type="checkbox"
            checked={demo}
            onChange={(e) => setDemo(e.target.checked)}
          />
          Demo wallet
        </label>
        {connected && publicKey ? (
          <span className="wallet-status">
            {publicKey.toBase58().slice(0, 4)}…{publicKey.toBase58().slice(-4)}
          </span>
        ) : null}
        <WalletMultiButton />
      </div>
      <nav className="tabs" aria-label="Pages">
        <button className={tab === 'chat' ? 'tab active' : 'tab'} onClick={() => setTab('chat')}>
          Chat
        </button>
        <button className={tab === 'audit' ? 'tab active' : 'tab'} onClick={() => setTab('audit')}>
          Audit Log
        </button>
        <button className={tab === 'settings' ? 'tab active' : 'tab'} onClick={() => setTab('settings')}>
          Settings
        </button>
      </nav>
    </header>
  )
}

function Shell() {
  const [tab, setTab] = useState<Tab>('chat')
  const [demo, setDemo] = useState<boolean>(() => {
    try {
      // Fresh browser (no stored preference) defaults to demo ON — the
      // first-run flow (chat a transfer with no Phantom connected) only
      // works in demo mode. A stored '0' still means explicitly off.
      const stored = localStorage.getItem('agentproof-demo')
      return stored === null ? true : stored === '1'
    } catch {
      return true
    }
  })
  const [health, setHealth] = useState<HealthResponse | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem('agentproof-demo', demo ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [demo])

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null))
  }, [])

  return (
    <div className="app">
      <Header tab={tab} setTab={setTab} demo={demo} setDemo={setDemo} health={health} />
      <main className="main">
        {tab === 'chat' && <Chat demo={demo} />}
        {tab === 'audit' && <Audit />}
        {tab === 'settings' && <Settings />}
      </main>
      <TrustFooter />
    </div>
  )
}

export default function App() {
  const endpoint = useMemo(() => clusterApiUrl('devnet'), [])
  const wallets = useMemo(() => [new PhantomWalletAdapter()], [])
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <Shell />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}
