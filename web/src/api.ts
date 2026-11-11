export type Member = { id: string; homeId: string; name: string }
export type Home = { id: string; name: string; members: Member[] }
export type Share = { id: string; memberId: string; amountCents: number; paidAt: string | null }
export type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}
export type Balance = { memberId: string; name: string; outstandingCents: number }

export class ApiError extends Error {}

const BASE: string = import.meta.env.VITE_API_URL ?? ''
const TIMEOUT_MS = 10_000

/** Calls the API. Never throws anything except ApiError, so the UI can always show a message. */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE}${path}`, { ...init, signal: controller.signal })
    let data: unknown = null
    try {
      data = await res.json()
    } catch {
      // body was empty or not JSON (for example a proxy error page)
    }
    if (!res.ok) {
      const message =
        typeof data === 'object' && data !== null && 'error' in data
          ? String((data as { error: unknown }).error)
          : `Request failed (${res.status})`
      throw new ApiError(message)
    }
    return data as T
  } catch (err) {
    if (err instanceof ApiError) throw err
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError('The server took too long to answer. Try again.')
    }
    throw new ApiError('Cannot reach the server. Check your connection and try again.')
  } finally {
    clearTimeout(timer)
  }
}

const json = (method: string, body: unknown, headers: HeadersInit = {}): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
})

export const api = {
  createHome: (name: string) =>
    request<{ id: string; name: string }>('/api/homes', json('POST', { name })),
  getHome: (id: string) => request<Home>(`/api/homes/${encodeURIComponent(id)}`),
  addMember: (homeId: string, name: string) =>
    request<Member>(`/api/homes/${encodeURIComponent(homeId)}/members`, json('POST', { name })),
  listBills: (homeId: string) =>
    request<{ bills: Bill[] }>(`/api/homes/${encodeURIComponent(homeId)}/bills`),
  createBill: (homeId: string, title: string, totalCents: number) =>
    request<Bill>(
      `/api/homes/${encodeURIComponent(homeId)}/bills`,
      json('POST', { title, totalCents }),
    ),
  balances: (homeId: string) =>
    request<{ balances: Balance[] }>(`/api/homes/${encodeURIComponent(homeId)}/balances`),
  pay: (billId: string, shareId: string, key: string) =>
    request<Share>(
      `/api/bills/${encodeURIComponent(billId)}/shares/${encodeURIComponent(shareId)}/pay`,
      json('POST', {}, { 'Idempotency-Key': key }),
    ),
}

/** "12.5" -> 1250. Returns null for anything that is not a positive amount with up to 2 decimals. */
export function parseDollarsToCents(input: string): number | null {
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(input.trim())
  if (!m) return null
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
  return cents > 0 ? cents : null
}

export const formatCents = (cents: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
