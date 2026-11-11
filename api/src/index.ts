import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { splitCents } from './split'

type AppEnv = { Bindings: Env }

type ShareRow = {
  id: string
  bill_id: string
  member_id: string
  amount_cents: number
  paid_at: string | null
  idempotency_key: string | null
}

const MAX_NAME = 100
const MAX_KEY = 200

const app = new Hono<AppEnv>()

app.use('/api/*', cors({ origin: '*', allowHeaders: ['Content-Type', 'Idempotency-Key'] }))

app.get('/api/health', (c) => c.json({ status: 'ok' }))

class HttpError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 422,
    message: string,
  ) {
    super(message)
  }
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await req.json()
    if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
      return body as Record<string, unknown>
    }
  } catch {
    // fall through
  }
  throw new HttpError(400, 'Request body must be a JSON object')
}

function cleanText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > MAX_NAME) {
    throw new HttpError(422, `${field} must be a non-empty string up to ${MAX_NAME} characters`)
  }
  return value.trim()
}

const toShare = (r: ShareRow) => ({
  id: r.id,
  memberId: r.member_id,
  amountCents: r.amount_cents,
  paidAt: r.paid_at,
})

async function homeExists(db: D1Database, homeId: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 AS ok FROM homes WHERE id = ?').bind(homeId).first()
  return row !== null
}

app.post('/api/homes', async (c) => {
  const body = await readBody(c.req.raw)
  const name = cleanText(body.name, 'name')
  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()
  return c.json({ id, name }, 201)
})

app.get('/api/homes/:homeId', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id, name FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string; name: string }>()
  if (!home) throw new HttpError(404, 'Home not found')
  const { results } = await c.env.DB.prepare(
    'SELECT id, home_id, name FROM members WHERE home_id = ? ORDER BY position',
  )
    .bind(homeId)
    .all<{ id: string; home_id: string; name: string }>()
  return c.json({
    id: home.id,
    name: home.name,
    members: results.map((m) => ({ id: m.id, homeId: m.home_id, name: m.name })),
  })
})

app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const body = await readBody(c.req.raw)
  if (!(await homeExists(c.env.DB, homeId))) throw new HttpError(404, 'Home not found')
  const name = cleanText(body.name, 'name')
  const id = crypto.randomUUID()
  // Position is computed inside the INSERT, so it is one atomic statement.
  // UNIQUE(home_id, position) rejects a clash if two inserts ever race.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await c.env.DB.prepare(
        `INSERT INTO members (id, home_id, name, position)
         SELECT ?, ?, ?, COALESCE(MAX(position), 0) + 1 FROM members WHERE home_id = ?`,
      )
        .bind(id, homeId, name, homeId)
        .run()
      return c.json({ id, homeId, name }, 201)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (!msg.includes('UNIQUE') || attempt === 2) throw err
    }
  }
  throw new Error('unreachable')
})

app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const body = await readBody(c.req.raw)
  if (!(await homeExists(c.env.DB, homeId))) throw new HttpError(404, 'Home not found')
  const title = cleanText(body.title, 'title')
  const total = body.totalCents
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total <= 0) {
    throw new HttpError(422, 'totalCents must be a positive whole number')
  }
  const { results: members } = await c.env.DB.prepare(
    'SELECT id FROM members WHERE home_id = ? ORDER BY position',
  )
    .bind(homeId)
    .all<{ id: string }>()
  if (members.length === 0) throw new HttpError(422, 'Home has no members')

  const billId = crypto.randomUUID()
  const amounts = splitCents(total, members.length)
  const shares = members.map((m, i) => ({
    id: crypto.randomUUID(),
    memberId: m.id,
    amountCents: amounts[i] ?? 0,
    paidAt: null,
  }))
  // One batch = one transaction: a bill never exists without all of its shares.
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)',
    ).bind(billId, homeId, title, total),
    ...shares.map((s) =>
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents) VALUES (?, ?, ?, ?)',
      ).bind(s.id, billId, s.memberId, s.amountCents),
    ),
  ])
  return c.json({ id: billId, homeId, title, totalCents: total, shares }, 201)
})

app.get('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  if (!(await homeExists(c.env.DB, homeId))) throw new HttpError(404, 'Home not found')
  const { results: bills } = await c.env.DB.prepare(
    'SELECT id, title, total_cents FROM bills WHERE home_id = ? ORDER BY rowid DESC',
  )
    .bind(homeId)
    .all<{ id: string; title: string; total_cents: number }>()
  const { results: shares } = await c.env.DB.prepare(
    `SELECT s.* FROM shares s
     JOIN bills b ON b.id = s.bill_id
     JOIN members m ON m.id = s.member_id
     WHERE b.home_id = ? ORDER BY m.position`,
  )
    .bind(homeId)
    .all<ShareRow>()
  return c.json({
    bills: bills.map((b) => ({
      id: b.id,
      homeId,
      title: b.title,
      totalCents: b.total_cents,
      shares: shares.filter((s) => s.bill_id === b.id).map(toShare),
    })),
  })
})

app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const key = c.req.header('Idempotency-Key')?.trim()
  if (!key || key.length > MAX_KEY) throw new HttpError(400, 'Idempotency-Key header is required')
  const { billId, shareId } = c.req.param()
  const db = c.env.DB
  const select = db.prepare('SELECT * FROM shares WHERE id = ? AND bill_id = ?')

  const before = await select.bind(shareId, billId).first<ShareRow>()
  if (!before) throw new HttpError(404, 'Bill or share not found')

  // Atomic compare-and-set: only one request can flip paid_at from NULL.
  const update = await db
    .prepare(
      `UPDATE shares SET paid_at = ?, idempotency_key = ?
       WHERE id = ? AND bill_id = ? AND paid_at IS NULL`,
    )
    .bind(new Date().toISOString(), key, shareId, billId)
    .run()

  // Re-read so a request that lost the race sees the winner's key.
  const after = await select.bind(shareId, billId).first<ShareRow>()
  if (!after) throw new HttpError(404, 'Bill or share not found')
  if (update.meta.changes === 0 && after.idempotency_key !== key) {
    throw new HttpError(409, 'Share already paid with a different Idempotency-Key')
  }
  return c.json(toShare(after), 200)
})

app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')
  if (!(await homeExists(c.env.DB, homeId))) throw new HttpError(404, 'Home not found')
  const { results } = await c.env.DB.prepare(
    `SELECT m.id AS member_id, m.name AS name,
            COALESCE(SUM(CASE WHEN s.paid_at IS NULL THEN s.amount_cents END), 0) AS outstanding
     FROM members m LEFT JOIN shares s ON s.member_id = m.id
     WHERE m.home_id = ? GROUP BY m.id ORDER BY m.position`,
  )
    .bind(homeId)
    .all<{ member_id: string; name: string; outstanding: number }>()
  return c.json({
    balances: results.map((r) => ({
      memberId: r.member_id,
      name: r.name,
      outstandingCents: r.outstanding,
    })),
  })
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status)
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
