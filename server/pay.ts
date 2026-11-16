import { Router } from 'express'
import { isClaimMethod } from '../shared/claims'
import { ASSETS, baseToMinor, minorToBase, type CurrencyCode } from '../shared/money'
import type { EntryData } from '../shared/ledger'
import { newReference, solanaPayUrl } from '../shared/solana'
import { cleanRef } from '../shared/upi'
import { claimView, settled } from './api'
import { limit } from './auth'
import { createClaim } from './claims'
import { config } from './config'
import { newId } from './crypto'
import { q, type ClaimRow, type PaylinkRow, type QuoteRow, type UserRow } from './db'
import { markClaimEvent } from './events'
import { avatarUrl, int, P } from './http'
import { appendAtomically } from './nostr'
import { assertUsable, price } from './rates'
import { findPayments, type Found } from './solana'
import { HttpError, loadGroupState, owed } from './state'

// Public pages: whoever has the link can pay it. No account, no install.
export const pay = Router()

/** keep checking a little past the 90 seconds, in case it was paid at the buzzer */
const GRACE_MS = 2 * 60_000

type CryptoAsset = 'SOL' | 'USDT'
const isCrypto = (a: unknown): a is CryptoAsset => a === 'SOL' || a === 'USDT'

function linkState(token: string) {
  const link = q.get<PaylinkRow>('SELECT * FROM paylinks WHERE token = ?', token)
  if (!link) throw new HttpError(404, 'bad_link', 'this pay link is broken or old')
  const s = loadGroupState(link.group_id)
  const from = s.members.find((m) => m.id === link.from_member)!
  const to = s.members.find((m) => m.id === link.to_member)!
  const payee = to.user_id ? q.get<UserRow>('SELECT * FROM users WHERE id = ?', to.user_id) ?? null : null
  const payer = from.user_id ? q.get<UserRow>('SELECT * FROM users WHERE id = ?', from.user_id) ?? null : null
  return { link, s, from, to, payee, payer }
}

/** Ways this person can be paid. UPI only works for rupee groups; crypto only if they turned it on. */
const railsOf = (payee: UserRow | null, currency: string) => {
  const sol = !!(config.solana.enabled && payee?.sol_address)
  return { UPI: !!(payee?.upi_id && currency === 'INR'), USDT: sol, SOL: sol }
}

const mintOf = (qr: QuoteRow) => /[?&]spl-token=([^&]+)/.exec(qr.invoice)?.[1]
const canSimulate = () => config.demoWallet && !config.solana.mainnet

function quoteView(qr: QuoteRow) {
  const now = Date.now()
  const status = qr.status === 'pending' && now > qr.expires_at ? 'expired' : qr.status
  return {
    id: qr.id,
    status,
    asset: qr.asset,
    amount: qr.amount,
    currency: qr.currency,
    base: qr.base_amount ?? '0',
    rate: qr.rate,
    rateSource: qr.rate_source,
    /** a solana: transfer request */
    invoice: qr.invoice,
    paymentHash: qr.payment_hash,
    recipient: qr.recipient,
    txSig: qr.tx_sig,
    createdAt: qr.created_at,
    expiresAt: qr.expires_at,
    /** on-chain payments can't be stopped at 90 seconds, so we keep looking for a day */
    lateWatch: qr.status === 'pending',
    demo: qr.status === 'paid' && !!q.get('SELECT 1 FROM settlements WHERE quote_id = ? AND demo = 1', qr.id),
    canSimulate: canSimulate(),
    note: qr.note,
  }
}

pay.get('/:token', (req, res) => {
  const { link, s, from, to, payee, payer } = linkState(P(req).token)
  const lastPaid = q.get<QuoteRow>("SELECT * FROM quotes WHERE paylink = ? AND status = 'paid' ORDER BY created_at DESC LIMIT 1", link.token)
  const pending = q.get<QuoteRow>("SELECT * FROM quotes WHERE paylink = ? AND status = 'pending' AND expires_at > ? ORDER BY created_at DESC LIMIT 1", link.token, Date.now() + 5000)
  const claim = q.get<ClaimRow>('SELECT * FROM claims WHERE group_id = ? AND from_member = ? AND to_member = ? ORDER BY created_at DESC LIMIT 1', s.group.id, from.id, to.id)
  res.setHeader('Cache-Control', 'no-store')
  res.json({
    group: { name: s.group.name, emoji: s.group.emoji, currency: s.currency },
    from: { name: from.name, avatar: avatarUrl(payer), joined: !!from.user_id },
    to: { name: to.name, avatar: avatarUrl(payee), joined: !!to.user_id, upi: payee?.upi_id ?? null, rails: railsOf(payee, s.currency) },
    owed: owed(s, from.id, to.id),
    claim: claim && (claim.status === 'pending' || Date.now() - (claim.decided_at ?? 0) < 24 * 60 * 60_000) ? claimView(claim) : null,
    lastPaid: lastPaid ? quoteView(lastPaid) : null,
    pending: pending ? quoteView(pending) : null,
    quoteSeconds: config.quoteSeconds,
    solana: { cluster: config.solana.cluster, stableLabel: config.solana.stableLabel },
  })
})

/** "I've paid": the payer tells the payee, who confirms from the app. */
pay.post('/:token/claims', limit('claim_link', 12, 10 * 60_000), (req, res) => {
  const { s, from, to } = linkState(P(req).token)
  const method = isClaimMethod(req.body?.method) && req.body.method !== 'kitty' ? req.body.method : 'upi'
  const c = createClaim(s, from, to, int(req.body?.amount, 'amount'), method, cleanRef(req.body?.ref), 'link')
  res.status(201).json({ claim: claimView(c) })
})

/** Pressed "I've paid" by mistake. Only while it's still waiting. */
pay.post('/:token/claims/:cid/cancel', limit('claim_link', 12, 10 * 60_000), (req, res) => {
  const { s, from, to } = linkState(P(req).token)
  const c = q.get<ClaimRow>("SELECT * FROM claims WHERE id = ? AND group_id = ? AND from_member = ? AND to_member = ? AND status = 'pending'", P(req).cid, s.group.id, from.id, to.id)
  if (!c) throw new HttpError(409, 'claim_done', 'already answered')
  q.run("UPDATE claims SET status = 'cancelled', decided_at = ? WHERE id = ?", Date.now(), c.id)
  markClaimEvent(s.group.id, c.id, 'cancelled')
  res.json({ claim: claimView(q.get<ClaimRow>('SELECT * FROM claims WHERE id = ?', c.id)!) })
})

/** Crypto: pin the live rate for 90 seconds in a Solana Pay request. */
pay.post('/:token/quote', limit('quote', 40, 10 * 60_000), async (req, res) => {
  const { link, s, from, to, payee } = linkState(P(req).token)
  const asset = req.body?.asset
  if (!isCrypto(asset)) throw new HttpError(400, 'bad_asset', 'pick USDT or SOL')
  const amount = owed(s, from.id, to.id)
  if (amount <= 0) throw new HttpError(409, 'nothing_owed', `${from.name} doesn't owe ${to.name} anything right now`)
  if (!payee || !railsOf(payee, s.currency)[asset]) throw new HttpError(409, 'payee_no_wallet', `${to.name} hasn't turned on crypto payments`)
  const reuse = q.get<QuoteRow>(
    "SELECT * FROM quotes WHERE paylink = ? AND status = 'pending' AND asset = ? AND amount = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
    link.token, asset, amount, Date.now() + 15_000,
  )
  if (reuse) return res.json({ quote: quoteView(reuse) })

  const rate = await price(asset, s.currency)
  assertUsable(rate, !config.solana.mainnet)
  const now = Date.now()
  const id = newId()
  const memo = `${s.group.name}: ${from.name} → ${to.name}`
  const base = minorToBase(amount, s.currency, asset, rate.price)
  const reference = newReference()
  const url = solanaPayUrl({
    recipient: payee.sol_address!,
    amount: base,
    decimals: asset === 'USDT' ? config.solana.stableDecimals : ASSETS.SOL.decimals,
    splToken: asset === 'USDT' ? config.solana.stableMint : undefined,
    reference,
    label: 'Bhai Paise De',
    message: memo,
  })
  q.run(
    "INSERT INTO quotes (id, paylink, group_id, from_member, to_member, amount, currency, rate, rate_source, sats, invoice, payment_hash, status, created_at, expires_at, asset, base_amount, recipient) VALUES (?,?,?,?,?,?,?,?,?,0,?,?,'pending',?,?,?,?,?)",
    id, link.token, s.group.id, from.id, to.id, amount, s.currency, rate.price, rate.source, url, reference, now, now + config.quoteSeconds * 1000, asset, base.toString(), payee.sol_address,
  )
  res.status(201).json({ quote: quoteView(q.get<QuoteRow>('SELECT * FROM quotes WHERE id = ?', id)!) })
})

pay.get('/:token/quote/:qid', async (req, res) => {
  const qr = q.get<QuoteRow>('SELECT * FROM quotes WHERE id = ? AND paylink = ?', P(req).qid, P(req).token)
  if (!qr) throw new HttpError(404, 'not_found', 'quote not found')
  if (qr.status === 'pending' && qr.asset !== 'BTC') await checkSolana([qr], 2000)
  res.setHeader('Cache-Control', 'no-store')
  res.json({ quote: quoteView(q.get<QuoteRow>('SELECT * FROM quotes WHERE id = ?', qr.id)!) })
})

/** Test networks only: pretend the transfer landed. It still goes through the same settlement path. */
pay.post('/:token/quote/:qid/demo-pay', async (req, res) => {
  const qr = q.get<QuoteRow>('SELECT * FROM quotes WHERE id = ? AND paylink = ?', P(req).qid, P(req).token)
  if (!qr) throw new HttpError(404, 'not_found', 'quote not found')
  if (!canSimulate() || qr.asset === 'BTC') throw new HttpError(400, 'not_demo', 'only test-network payments can be simulated')
  if (qr.status !== 'pending' || Date.now() > qr.expires_at) throw new HttpError(409, 'expired', 'this quote expired, get a fresh one')
  await settleSolana(qr, { signature: null, received: BigInt(qr.base_amount!), blockTime: null }, true)
  res.json({ quote: quoteView(q.get<QuoteRow>('SELECT * FROM quotes WHERE id = ?', qr.id)!) })
})

// ---------- settlement: the ledger moves only here, on proof ----------

/**
 * Solana: the chain says `received` base units reached the payee's address in a transaction that
 * carries this quote's reference key. Money that has moved can't be refused, so we record what
 * actually arrived: in full if it covers the quote, pro rata if it's short, and at today's rate if
 * it came after the quote ran out.
 */
async function settleSolana(qr: QuoteRow, found: Found, demo = false) {
  const asset = qr.asset
  const cur = qr.currency as CurrencyCode
  const expected = BigInt(qr.base_amount!)
  const late = !demo && found.blockTime !== null && found.blockTime * 1000 > qr.expires_at + GRACE_MS
  const nowRate = late ? await price(asset, cur) : null
  let value = found.received >= expected ? qr.amount : baseToMinor(found.received, cur, asset, qr.rate)
  let note: string | null = found.received >= expected ? null : 'paid less than asked; counted what arrived'
  if (late && nowRate) {
    value = Math.min(qr.amount, baseToMinor(found.received, cur, asset, nowRate.price))
    note = 'paid after the quote ran out; valued at the rate when it arrived'
  }
  // the checks that can reject happen first, in their own small transactions
  const fresh = q.get<QuoteRow>('SELECT * FROM quotes WHERE id = ?', qr.id)!
  if (fresh.status !== 'pending') return
  if (found.signature && q.get('SELECT id FROM settlements WHERE tx_sig = ?', found.signature)) {
    q.run("UPDATE quotes SET status = 'rejected', note = 'that transaction was already counted for another payment' WHERE id = ? AND status = 'pending'", qr.id)
    return
  }
  if (value <= 0) {
    q.run("UPDATE quotes SET status = 'rejected', note = 'amount too small to count', tx_sig = ? WHERE id = ? AND status = 'pending'", found.signature, qr.id)
    return
  }
  const id = newId()
  const data: EntryData = {
    type: 'settlement',
    id,
    from: qr.from_member,
    to: qr.to_member,
    amount: value,
    method: 'solana',
    asset,
    base: found.received.toString(),
    txSig: found.signature ?? undefined,
    note: note ?? undefined,
    demo: demo || undefined,
  }
  const done = appendAtomically(qr.group_id, [{ data, refId: id }], () => {
    const now = q.get<QuoteRow>('SELECT * FROM quotes WHERE id = ?', qr.id)!
    if (now.status !== 'pending') return false
    if (found.signature && q.get('SELECT id FROM settlements WHERE tx_sig = ?', found.signature)) return false
    q.run(
      "INSERT INTO settlements (id, group_id, from_member, to_member, amount, method, note, demo, quote_id, created_at, asset, base_amount, tx_sig) VALUES (?,?,?,?,?,'solana',?,?,?,?,?,?,?)",
      id, qr.group_id, qr.from_member, qr.to_member, value, note, demo ? 1 : 0, qr.id, Date.now(), asset, found.received.toString(), found.signature,
    )
    q.run("UPDATE quotes SET status = 'paid', settlement_id = ?, tx_sig = ?, note = ? WHERE id = ?", id, found.signature, note, qr.id)
    return true
  })
  if (done) {
    const g = loadGroupState(qr.group_id)
    const from = g.members.find((m) => m.id === qr.from_member)!
    const to = g.members.find((m) => m.id === qr.to_member)!
    settled(g, from, to, value, 'solana', null)
  }
}

// ---------- watching ----------

const checking = new Set<string>()

/** One batched RPC round trip for many quotes. `minGapMs` throttles per quote across every worker via checked_at. */
async function checkSolana(qrs: QuoteRow[], minGapMs: number) {
  const now = Date.now()
  const due = qrs.filter((qr) => !checking.has(qr.id) && (!qr.checked_at || now - qr.checked_at >= minGapMs))
  if (!due.length) return
  for (const qr of due) {
    checking.add(qr.id)
    q.run('UPDATE quotes SET checked_at = ? WHERE id = ?', now, qr.id)
  }
  try {
    const found = await findPayments(
      due.map((qr) => ({ reference: qr.payment_hash, recipient: qr.recipient!, mint: qr.asset === 'USDT' ? mintOf(qr) : undefined, exact: BigInt(qr.base_amount!), since: qr.created_at })),
      (sig) => !!q.get('SELECT 1 FROM settlements WHERE tx_sig = ?', sig),
    )
    for (let i = 0; i < due.length; i++) if (found[i]) await settleSolana(due[i], found[i]!)
  } catch (e) {
    console.warn('[solana] check failed:', (e as Error).message)
  } finally {
    for (const qr of due) checking.delete(qr.id)
  }
}

let ticking = false
async function tick() {
  if (ticking) return
  ticking = true
  try {
    const now = Date.now()
    // older Lightning quotes can't be checked any more
    q.run("UPDATE quotes SET status = 'expired' WHERE status = 'pending' AND asset = 'BTC'")
    if (config.solana.enabled) {
      // fresh quotes every few seconds; ones past their 90 s (late payers) once a minute, for a day
      const fresh = q.all<QuoteRow>("SELECT * FROM quotes WHERE status = 'pending' AND asset != 'BTC' AND expires_at > ? ORDER BY checked_at LIMIT 40", now - GRACE_MS)
      const late = q.all<QuoteRow>(
        "SELECT * FROM quotes WHERE status = 'pending' AND asset != 'BTC' AND expires_at <= ? AND created_at > ? AND (checked_at IS NULL OR checked_at < ?) ORDER BY checked_at LIMIT 40",
        now - GRACE_MS, now - config.solana.lateWindowMs, now - 60_000,
      )
      await checkSolana(fresh, 3000)
      await checkSolana(late, 60_000)
      q.run("UPDATE quotes SET status = 'expired' WHERE status = 'pending' AND asset != 'BTC' AND created_at <= ?", now - config.solana.lateWindowMs)
    }
  } catch (e) {
    console.warn('[watcher]', (e as Error).message)
  } finally {
    ticking = false
  }
}

/** Keeps watching open payment requests even after the payer closes the tab. */
export function startQuoteWatcher() {
  setInterval(tick, 4000).unref()
}
