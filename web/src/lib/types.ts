import type { Asset, CurrencyCode } from '@shared/money'
import type { Transfer } from '@shared/balances'
import type { ClaimMethod } from '@shared/claims'
import type { SettlementMethod } from '@shared/ledger'

export type User = { id: string; name: string; createdAt: number; pubkey: string | null; solAddress: string | null; upi: string | null; avatar: string | null }

export type Member = {
  id: string
  name: string
  position: number
  joined: boolean
  /** a friend was added by their account and hasn't said yes yet */
  invited: boolean
  userId: string | null
  isMe: boolean
  avatar: string | null
  /** their UPI ID, if they added one */
  upi: string | null
  sol: boolean
  signs: boolean
  isCreator: boolean
}

export type Expense = {
  id: string
  description: string
  category: string
  amount: number
  paidBy: string
  mode: string
  split: unknown
  shares: Record<string, number>
  createdBy: string
  createdAt: number
  voidedAt: number | null
  kitty: boolean
  receipt: boolean
}

export type Settlement = {
  id: string
  from: string
  to: string
  amount: number
  method: SettlementMethod
  note: string | null
  ref: string | null
  sats: number | null
  asset: Asset | null
  base: string | null
  txSig: string | null
  demo: boolean
  recordedBy: string | null
  createdAt: number
}

export type Claim = { id: string; from: string; to: string; amount: number; method: ClaimMethod; ref: string | null; status: 'pending' | 'confirmed' | 'rejected' | 'cancelled'; via: 'app' | 'link'; createdAt: number }

export type Kitty = { holder: string; target: number | null; collected: number; spent: number; left: number; byMember: Record<string, number> }

export type GroupFull = {
  counts?: { expenses: number; settlements: number }
  group: { id: string; name: string; emoji: string; currency: CurrencyCode; simplify: boolean; createdAt: number; createdBy: string; inviteCode?: string; kitty: Kitty | null }
  me: string | null
  members: Member[]
  expenses: Expense[]
  settlements: Settlement[]
  claims: Claim[]
  balances: { net: Record<string, number>; pairwise: Transfer[]; simplified: Transfer[]; plan: Transfer[] }
  ledger: { entries: number; published: number; signed: number; offsite: boolean }
}

export type GroupSummary = {
  id: string
  name: string
  emoji: string
  currency: CurrencyCode
  me: string
  net: number
  members: { id: string; name: string; joined: boolean; avatar: string | null }[]
  expenseCount: number
  total: number
  lastActivity: number
  unread: number
  toConfirm: number
  kitty: boolean
}

export type Invite = { groupId: string; memberId: string; name: string; groupName: string; emoji: string; by: string | null }

export type Friend = { id: string; name: string; avatar: string | null; upi: boolean; shared: number }

export type Quote = {
  id: string
  status: 'pending' | 'paid' | 'expired' | 'rejected'
  asset: Asset
  amount: number
  currency: CurrencyCode
  /** base units as a decimal string: lamports, or USDT micro-units */
  base: string
  recipient: string | null
  txSig: string | null
  lateWatch: boolean
  canSimulate: boolean
  rate: number
  rateSource: 'live' | 'last-known' | 'fixed'
  invoice: string
  paymentHash: string
  createdAt: number
  expiresAt: number
  demo: boolean
  note: string | null
}

export type Rail = 'UPI' | 'USDT' | 'SOL'

export type PayInfo = {
  group: { name: string; emoji: string; currency: CurrencyCode }
  from: { name: string; avatar: string | null; joined: boolean }
  to: { name: string; avatar: string | null; joined: boolean; upi: string | null; rails: Record<Rail, boolean> }
  owed: number
  claim: Claim | null
  lastPaid: Quote | null
  pending: Quote | null
  quoteSeconds: number
  solana: { cluster: 'mainnet-beta' | 'devnet' | 'testnet'; stableLabel: string }
}

export type ServerInfo = {
  demo: boolean
  quoteSeconds: number
  tip: { upi: string; name: string } | null
  offsite: boolean
  solana: { enabled: boolean; cluster: 'mainnet-beta' | 'devnet' | 'testnet'; stableMint: string; stableDecimals: number; stableLabel: string; priorityMicroLamports: string }
}

export type ChatMessage = {
  id: number
  by: string | null
  kind: 'text' | 'event'
  text: string
  meta: EventMeta | null
  at: number
  deleted: boolean
  reactions: { by: string; emoji: string }[]
  /** still sending (local only) */
  pending?: boolean
}

export type EventMeta =
  | { t: 'expense'; id: string; desc: string; amount: number; paidBy: string; kitty?: boolean }
  | { t: 'void'; id: string; desc: string }
  | { t: 'paid'; from: string; to: string; amount: number; method: string }
  | { t: 'claim'; id: string; from: string; to: string; amount: number; method: string; s?: 'confirmed' | 'rejected' | 'cancelled' }
  | { t: 'join'; member: string }
  | { t: 'added'; member: string }
  | { t: 'nudge'; from: string; to: string; amount: number }
  | { t: 'kitty'; holder: string | null; target: number | null }

export type Recurring = {
  id: string
  groupId: string
  groupName: string
  emoji: string
  currency: CurrencyCode
  every: 'week' | 'month'
  nextAt: number
  due: boolean
  template: { description: string; category: string; amount: number; paidBy: string; split: unknown; kitty: boolean }
}

export type ActivityItem =
  | {
      kind: 'expense'
      id: string
      groupId: string
      groupName: string
      groupEmoji: string
      currency: CurrencyCode
      at: number
      description: string
      category: string
      amount: number
      paidBy: string
      paidByMe: boolean
      myShare: number
      voided: boolean
      kitty: boolean
    }
  | {
      kind: 'settlement'
      id: string
      groupId: string
      groupName: string
      groupEmoji: string
      currency: CurrencyCode
      at: number
      amount: number
      from: string
      to: string
      fromMe: boolean
      toMe: boolean
      method: SettlementMethod
      note: string | null
      ref: string | null
      sats: number | null
      asset: Asset | null
      base: string | null
      txSig: string | null
      demo: boolean
    }
