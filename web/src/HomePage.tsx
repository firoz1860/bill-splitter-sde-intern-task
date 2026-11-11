import { useNavigate, useSearch } from '@tanstack/react-router'
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react'
import { api, type Balance, type Bill, formatCents, type Home, parseDollarsToCents } from './api'

type Loaded<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T }

const messageOf = (err: unknown): string =>
  err instanceof Error ? err.message : 'Something went wrong. Try again.'

/** Loads data and exposes a reload. Stale responses from an older request are ignored. */
function useLoad<T>(load: () => Promise<T>): [Loaded<T>, () => void, (data: T) => void] {
  const [state, setState] = useState<Loaded<T>>({ status: 'loading' })
  const run = useRef(0)
  const loadRef = useRef(load)
  loadRef.current = load

  const reload = useCallback(() => {
    const id = ++run.current
    setState((s) => (s.status === 'ready' ? s : { status: 'loading' }))
    loadRef
      .current()
      .then((data) => id === run.current && setState({ status: 'ready', data }))
      .catch(
        (err: unknown) =>
          id === run.current && setState({ status: 'error', message: messageOf(err) }),
      )
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const set = useCallback((data: T) => {
    run.current++
    setState({ status: 'ready', data })
  }, [])
  return [state, reload, set]
}

function Notice({ kind, children }: { kind: 'error' | 'empty'; children: React.ReactNode }) {
  return (
    <p className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : undefined}>
      {children}
    </p>
  )
}

function Spinner({ label }: { label: string }) {
  return (
    <output className="loading">
      <span className="spinner" aria-hidden="true" />
      {label}
    </output>
  )
}

function CreateHome() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [existing, setExisting] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const home = await api.createHome(name)
      await navigate({ to: '/', search: { home: home.id } })
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="welcome">
      <section className="welcome-card">
        <h1>Split the bills. Keep the peace.</h1>
        <p className="lead">
          Create a home, add the people who live there, and share every bill fairly.
        </p>
        <form onSubmit={submit} className="stack">
          <label>
            Home name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Flat 4B"
              maxLength={100}
              required
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create home'}
          </button>
          {error && <Notice kind="error">{error}</Notice>}
        </form>
        <form
          className="stack join"
          onSubmit={(e) => {
            e.preventDefault()
            if (existing.trim()) void navigate({ to: '/', search: { home: existing.trim() } })
          }}
        >
          <label>
            Already have a home? Open it by ID
            <input
              value={existing}
              onChange={(e) => setExisting(e.target.value)}
              placeholder="Home ID"
            />
          </label>
          <button type="submit" className="btn btn-ghost">
            Open home
          </button>
        </form>
      </section>
    </main>
  )
}

function SmallForm(props: {
  label: string
  placeholder: string
  cta: string
  onSubmit: (value: string) => Promise<void>
  inputMode?: 'decimal'
}) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault()
        if (busy) return
        setBusy(true)
        setError(null)
        try {
          await props.onSubmit(value)
          setValue('')
        } catch (err) {
          setError(messageOf(err))
        } finally {
          setBusy(false)
        }
      }}
    >
      <label>
        {props.label}
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={props.placeholder}
          inputMode={props.inputMode}
          maxLength={100}
          required
        />
      </label>
      <button type="submit" className="btn btn-light" disabled={busy}>
        {busy ? 'Saving…' : props.cta}
      </button>
      {error && <Notice kind="error">{error}</Notice>}
    </form>
  )
}

function BillForm({
  homeId,
  hasMembers,
  onCreated,
}: {
  homeId: string
  hasMembers: boolean
  onCreated: (b: Bill) => void
}) {
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const cents = parseDollarsToCents(amount)
    if (cents === null) {
      setError('Enter an amount above 0 with at most 2 decimals, like 42.50.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      onCreated(await api.createBill(homeId, title, cents))
      setTitle('')
      setAmount('')
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <label>
        Bill title
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Electricity"
          maxLength={100}
          required
        />
      </label>
      <label>
        Total (USD)
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="42.50"
          inputMode="decimal"
          required
        />
      </label>
      <button type="submit" className="btn btn-orange" disabled={busy || !hasMembers}>
        {busy ? 'Splitting…' : 'Split bill'}
      </button>
      {!hasMembers && <p className="hint">Add at least one member first.</p>}
      {error && <Notice kind="error">{error}</Notice>}
    </form>
  )
}

function BillCard(props: {
  bill: Bill
  names: Map<string, string>
  pending: Set<string>
  errors: Map<string, string>
  onPay: (bill: Bill, shareId: string) => void
}) {
  const { bill } = props
  const open = bill.shares.filter((s) => !s.paidAt).length
  return (
    <article className="bill">
      <header>
        <h3>{bill.title}</h3>
        <strong className="total">{formatCents(bill.totalCents)}</strong>
      </header>
      <p className="meta">
        {open === 0 ? 'Everyone has paid' : `${open} of ${bill.shares.length} still to pay`}
      </p>
      <ul className="shares">
        {bill.shares.map((s) => {
          const busy = props.pending.has(s.id)
          const err = props.errors.get(s.id)
          return (
            <li key={s.id} className={s.paidAt ? 'share paid' : 'share'}>
              <span className="who">{props.names.get(s.memberId) ?? 'Former member'}</span>
              <span className="amt">{formatCents(s.amountCents)}</span>
              {s.paidAt ? (
                <span className="badge">Paid</span>
              ) : (
                <button
                  type="button"
                  className="btn btn-orange btn-sm"
                  disabled={busy}
                  onClick={() => props.onPay(bill, s.id)}
                >
                  {busy ? 'Paying…' : err ? 'Retry' : 'Pay'}
                </button>
              )}
              {err && (
                <p className="notice notice-error share-error" role="alert">
                  {err} This share is still unpaid.
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </article>
  )
}

function HomeView({ homeId }: { homeId: string }) {
  const navigate = useNavigate()
  const balId = useId()
  const billsId = useId()
  const [home, reloadHome, setHome] = useLoad<Home>(() => api.getHome(homeId))
  const [bills, reloadBills, setBills] = useLoad<Bill[]>(() =>
    api.listBills(homeId).then((r) => r.bills),
  )
  const [balances, reloadBalances] = useLoad<Balance[]>(() =>
    api.balances(homeId).then((r) => r.balances),
  )
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [payErrors, setPayErrors] = useState<Map<string, string>>(new Map())
  // One key per share until a payment succeeds, so a retry after a timeout can never pay twice.
  const keys = useRef(new Map<string, string>())

  async function pay(bill: Bill, shareId: string) {
    if (pending.has(shareId)) return
    const key = keys.current.get(shareId) ?? crypto.randomUUID()
    keys.current.set(shareId, key)
    setPending((p) => new Set(p).add(shareId))
    setPayErrors((m) => {
      const n = new Map(m)
      n.delete(shareId)
      return n
    })
    try {
      const paid = await api.pay(bill.id, shareId, key)
      keys.current.delete(shareId)
      setBills(
        bills.status === 'ready'
          ? bills.data.map((b) =>
              b.id === bill.id
                ? { ...b, shares: b.shares.map((s) => (s.id === paid.id ? paid : s)) }
                : b,
            )
          : [],
      )
      reloadBalances()
    } catch (err) {
      setPayErrors((m) => new Map(m).set(shareId, messageOf(err)))
    } finally {
      setPending((p) => {
        const n = new Set(p)
        n.delete(shareId)
        return n
      })
    }
  }

  if (home.status === 'loading') return <Spinner label="Loading your home…" />
  if (home.status === 'error') {
    return (
      <main className="welcome">
        <section className="welcome-card">
          <Notice kind="error">{home.message}</Notice>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={reloadHome}>
              Try again
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void navigate({ to: '/', search: {} })}
            >
              Choose another home
            </button>
          </div>
        </section>
      </main>
    )
  }

  const members = home.data.members
  const names = new Map(members.map((m) => [m.id, m.name]))

  return (
    <div className="layout">
      <aside className="side">
        <p className="brand">Bill Splitter</p>
        <h1>{home.data.name}</h1>
        <p className="home-id">
          Home ID <code>{homeId}</code>
        </p>
        <h2>Members</h2>
        {members.length === 0 ? (
          <p className="hint">No members yet.</p>
        ) : (
          <ol className="members">
            {members.map((m) => (
              <li key={m.id}>{m.name}</li>
            ))}
          </ol>
        )}
        <SmallForm
          label="Add a member"
          placeholder="Name"
          cta="Add member"
          onSubmit={async (name) => {
            const m = await api.addMember(homeId, name)
            setHome({ ...home.data, members: [...members, m] })
            reloadBalances()
          }}
        />
        <h2>New bill</h2>
        <BillForm
          homeId={homeId}
          hasMembers={members.length > 0}
          onCreated={(b) => {
            setBills([b, ...(bills.status === 'ready' ? bills.data : [])])
            reloadBalances()
          }}
        />
        <button
          type="button"
          className="btn btn-ghost btn-side"
          onClick={() => void navigate({ to: '/', search: {} })}
        >
          Switch home
        </button>
      </aside>

      <main className="main">
        <section aria-labelledby={balId}>
          <h2 id={balId}>Who owes what</h2>
          {balances.status === 'loading' && <Spinner label="Loading balances…" />}
          {balances.status === 'error' && (
            <Notice kind="error">
              {balances.message}{' '}
              <button type="button" className="link" onClick={reloadBalances}>
                Retry
              </button>
            </Notice>
          )}
          {balances.status === 'ready' &&
            (balances.data.length === 0 ? (
              <Notice kind="empty">Add members to see their balances.</Notice>
            ) : (
              <ul className="balances">
                {balances.data.map((b) => (
                  <li key={b.memberId} className={b.outstandingCents === 0 ? 'settled' : ''}>
                    <span>{b.name}</span>
                    <strong>
                      {b.outstandingCents === 0 ? 'All paid' : formatCents(b.outstandingCents)}
                    </strong>
                  </li>
                ))}
              </ul>
            ))}
        </section>

        <section aria-labelledby={billsId}>
          <h2 id={billsId}>Bills</h2>
          {bills.status === 'loading' && <Spinner label="Loading bills…" />}
          {bills.status === 'error' && (
            <Notice kind="error">
              {bills.message}{' '}
              <button type="button" className="link" onClick={reloadBills}>
                Retry
              </button>
            </Notice>
          )}
          {bills.status === 'ready' &&
            (bills.data.length === 0 ? (
              <Notice kind="empty">
                No bills yet. Add one from the panel to split it between your members.
              </Notice>
            ) : (
              <div className="bill-list">
                {bills.data.map((b) => (
                  <BillCard
                    key={b.id}
                    bill={b}
                    names={names}
                    pending={pending}
                    errors={payErrors}
                    onPay={pay}
                  />
                ))}
              </div>
            ))}
        </section>
      </main>
    </div>
  )
}

export function HomePage() {
  const { home } = useSearch({ from: '/' })
  return home ? <HomeView key={home} homeId={home} /> : <CreateHome />
}
