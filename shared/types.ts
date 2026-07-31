/** Types shared between the Worker API and the React app. */

export type RailId = 'nim' | 'usdt'

export interface Kitty {
  id: string
  title: string
  note: string | null
  emoji: string
  rail: RailId
  chainId: number | null
  /** Base units, decimal string. */
  targetAmount: string
  payoutAddress: string
  organizerName: string | null
  settledAt: number | null
  settleTx: string | null
  settleTo: string | null
  createdAt: number
}

export interface Contribution {
  id: number
  txHash: string
  fromAddress: string
  /** Base units, decimal string. */
  amount: string
  displayName: string | null
  message: string | null
  status: 'pending' | 'confirmed' | 'failed'
  createdAt: number
}

export interface KittyView {
  kitty: Kitty
  contributions: Contribution[]
  /** Base units, decimal string. Confirmed + pending, so the bar moves instantly. */
  raisedTotal: string
  /** Base units, decimal string. Confirmed only — the trustworthy number. */
  confirmedTotal: string
  contributorCount: number
  /** True when the caller's device id matches the organizer. */
  isOrganizer: boolean
}

export interface LeaderboardEntry {
  displayName: string
  contributionCount: number
  kittyCount: number
  rank: number
}

export interface CreateKittyRequest {
  title: string
  note?: string
  emoji?: string
  rail: RailId
  chainId?: number
  targetAmount: string
  payoutAddress: string
  organizerName?: string
}

export interface RecordContributionRequest {
  txHash: string
  fromAddress: string
  amount: string
  displayName?: string
  message?: string
}

export interface SettleRequest {
  txHash: string
  settleTo: string
}

export interface ApiError {
  error: string
  /** Machine-readable so the UI can localise the message. */
  code:
    | 'not_found'
    | 'validation'
    | 'rate_limited'
    | 'forbidden'
    | 'duplicate'
    | 'already_settled'
    | 'server'
}
