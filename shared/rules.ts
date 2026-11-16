// Small rules the browser and the server must apply identically, because the browser signs
// the result and the server rebuilds it to check the signature.

import { cleanText } from './canon'

/** A new group's members: you first, then everyone else once (case-insensitive), in the order typed. */
export function startingMembers(myName: string, others: string[]): string[] {
  const me = cleanText(myName)
  const seen = new Set([me.toLowerCase()])
  const out = [me]
  for (const raw of others) {
    const n = cleanText(raw)
    if (!n || seen.has(n.toLowerCase())) continue
    seen.add(n.toLowerCase())
    out.push(n)
  }
  return out
}

/** Joining as someone new: your name, or "Ria 4" if a Ria is already in the group. */
export function joinName(myName: string, existing: string[]) {
  const n = cleanText(myName)
  return existing.some((x) => x.toLowerCase() === n.toLowerCase()) ? `${n} ${existing.length + 1}` : n
}

export const nextPosition = (positions: number[]) => Math.max(-1, ...positions) + 1
