const TOKEN_KEY = 'bpd.token'

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  },
  set(t: string | null) {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t)
      else localStorage.removeItem(TOKEN_KEY)
    } catch {
      // storage blocked: the session lives only as long as this tab
    }
  },
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  const token = tokenStore.get()
  if (opts.auth !== false && token) headers.authorization = `Bearer ${token}`
  let res: Response
  try {
    res = await fetch(`/api${path}`, { method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined })
  } catch {
    throw new ApiError(0, 'offline', "can't reach the server. Check your internet.")
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'server_error', data.message ?? 'something broke')
  return data as T
}

/** Send a photo as-is (the server re-encodes it). */
export async function upload<T>(path: string, file: Blob, method = 'PUT'): Promise<T> {
  const token = tokenStore.get()
  let res: Response
  try {
    res = await fetch(`/api${path}`, { method, headers: { 'content-type': file.type || 'application/octet-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: file })
  } catch {
    throw new ApiError(0, 'offline', "can't reach the server. Check your internet.")
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'server_error', data.message ?? 'something broke')
  return data as T
}

/** An image that needs the session header (receipts), as an object URL. */
export async function authedImage(path: string): Promise<string> {
  const token = tokenStore.get()
  const res = await fetch(`/api${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} })
  if (!res.ok) throw new ApiError(res.status, 'not_found', 'no image')
  return URL.createObjectURL(await res.blob())
}
