import type {
  ApiError,
  CreateKittyRequest,
  Kitty,
  KittyView,
  LeaderboardEntry,
  RecordContributionRequest,
  SettleRequest,
} from '../../shared/types'
import { peekDeviceId } from './device'

export class ApiFailure extends Error {
  constructor(
    message: string,
    readonly code: ApiError['code'],
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiFailure'
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json')

  // Sent on every call so the server can tell the organizer from a visitor.
  const deviceId = peekDeviceId()
  if (deviceId) headers.set('X-Device-Id', deviceId)

  let res: Response
  try {
    res = await fetch(path, { ...init, headers })
  } catch (err) {
    throw new ApiFailure('You appear to be offline', 'server', 0)
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null
    throw new ApiFailure(
      body?.error ?? 'Request failed',
      body?.code ?? 'server',
      res.status,
    )
  }

  return (await res.json()) as T
}

export const api = {
  createKitty: (body: CreateKittyRequest) =>
    request<{ kitty: Kitty }>('/api/kitties', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getKitty: (id: string) => request<KittyView>(`/api/kitties/${encodeURIComponent(id)}`),

  recordContribution: (id: string, body: RecordContributionRequest) =>
    request<{ ok: true }>(`/api/kitties/${encodeURIComponent(id)}/contributions`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  settle: (id: string, body: SettleRequest) =>
    request<{ ok: true }>(`/api/kitties/${encodeURIComponent(id)}/settle`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  myKitties: () => request<{ kitties: Kitty[] }>('/api/my/kitties'),

  leaderboard: () => request<{ entries: LeaderboardEntry[] }>('/api/leaderboard'),
}
