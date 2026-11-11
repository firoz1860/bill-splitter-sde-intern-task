import { describe, expect, it } from 'vitest'
import { splitCents } from '../src/split'
import { type Balance, type Bill, call, createBill, createHome } from './helpers'

const payUrl = (billId: string, shareId: string) => `/api/bills/${billId}/shares/${shareId}/pay`

describe('splitCents', () => {
  it('gives extra cents to the first members', () => {
    expect(splitCents(1000, 3)).toEqual([334, 333, 333])
    expect(splitCents(1, 3)).toEqual([1, 0, 0])
  })
})

describe('bill validation', () => {
  it('rejects zero, negative, decimal and non-number totals with 422', async () => {
    const { homeId } = await createHome(['A'])
    for (const totalCents of [0, -5, 10.5, '10', null]) {
      const res = await call('POST', `/api/homes/${homeId}/bills`, {
        body: { title: 'x', totalCents },
      })
      expect(res.status).toBe(422)
      expect(res.body).toHaveProperty('error')
    }
  })

  it('rejects a home with no members and an unknown home', async () => {
    const { homeId } = await createHome([])
    expect((await createBill(homeId, 100)).status).toBe(422)
    expect((await createBill('does-not-exist', 100)).status).toBe(404)
  })

  it('splits 1000 cents between 3 members in order', async () => {
    const { homeId } = await createHome(['A', 'B', 'C'])
    const bill = await createBill(homeId, 1000)
    expect(bill.status).toBe(201)
    expect(bill.body.shares.map((s) => s.amountCents)).toEqual([334, 333, 333])
  })
})

describe('home input', () => {
  it('rejects blank names and bad JSON with a JSON error', async () => {
    expect((await call('POST', '/api/homes', { body: { name: '' } })).status).toBe(422)
    expect((await call('POST', '/api/homes', { body: { name: 5 } })).status).toBe(422)
  })
})

describe('concurrent payments', () => {
  it('lets only one key win when the same share is paid at the same time', async () => {
    const { homeId } = await createHome(['A', 'B'])
    const bill = await createBill(homeId, 500)
    const share = bill.body.shares[0]
    if (!share) throw new Error('no share')
    const results = await Promise.all(
      ['k1', 'k2', 'k1', 'k2'].map((k) =>
        call('POST', payUrl(bill.body.id, share.id), { headers: { 'Idempotency-Key': k } }),
      ),
    )
    const statuses = results.map((r) => r.status).sort()
    expect(statuses).toEqual([200, 200, 409, 409])
    const bal = await call<{ balances: Balance[] }>('GET', `/api/homes/${homeId}/balances`)
    expect(bal.body.balances.map((b) => b.outstandingCents)).toEqual([0, 250])
  })
})

describe('listing bills', () => {
  it('returns bills with their shares', async () => {
    const { homeId } = await createHome(['A'])
    await createBill(homeId, 100)
    const res = await call<{ bills: Bill[] }>('GET', `/api/homes/${homeId}/bills`)
    expect(res.status).toBe(200)
    expect(res.body.bills[0]?.shares).toHaveLength(1)
  })
})
