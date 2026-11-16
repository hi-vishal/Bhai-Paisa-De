import { createHash, randomBytes } from 'node:crypto'

export { newId } from '../shared/canon'

export const newToken = (bytes = 24) => randomBytes(bytes).toString('base64url')
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex')
