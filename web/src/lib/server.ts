import { api } from './api'
import type { ServerInfo } from './types'

// What this server offers (crypto on or off, the tip jar), fetched once per visit.
let info: Promise<ServerInfo> | null = null
export const serverInfo = () => (info ??= api<ServerInfo>('/server', { auth: false }).catch((e) => ((info = null), Promise.reject(e))))
