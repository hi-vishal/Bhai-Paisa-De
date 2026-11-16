// One recovery phrase, two keys.
//
//   12 words ──BIP39──▶ seed ─┬─ SLIP-10 ed25519  m/44'/501'/0'/0'  ─▶ Solana wallet (SOL + USDT)
//                             └─ BIP32 secp256k1  m/44'/1237'/0'/0/0 ─▶ Nostr identity (login, signs ledger entries)
//
// Both paths are the ones Phantom/Solflare (Solana) and NIP-06 (Nostr) use, so the same
// words open the same wallet in those apps. Hardened derivation keeps the branches apart:
// leaking the Nostr key reveals nothing about the Solana key.

import { generateMnemonic, mnemonicToSeedSync, mnemonicToSeedWebcrypto, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { HDKey } from '@scure/bip32'
import { hmac } from '@noble/hashes/hmac.js'
import { sha512 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { ed25519 } from '@noble/curves/ed25519.js'
import { base58 } from '@scure/base'
import { getPublicKey } from 'nostr-tools/pure'

export const WORDLIST = wordlist
export const newMnemonic = () => generateMnemonic(wordlist, 128)
export const normalizeMnemonic = (m: string) => m.trim().toLowerCase().split(/\s+/).join(' ')
export const isMnemonic = (m: string) => validateMnemonic(normalizeMnemonic(m), wordlist)

const HARDENED = 0x80000000

/** SLIP-0010 for ed25519: every level hardened. Returns the 32-byte private key and chain code. */
export function slip10(seed: Uint8Array, path: number[]) {
  let I = hmac(sha512, utf8ToBytes('ed25519 seed'), seed)
  let key = I.slice(0, 32)
  let chain = I.slice(32)
  for (const index of path) {
    const data = new Uint8Array(37)
    data.set(key, 1)
    new DataView(data.buffer).setUint32(33, (index | HARDENED) >>> 0, false)
    I = hmac(sha512, chain, data)
    key = I.slice(0, 32)
    chain = I.slice(32)
  }
  return { key, chain }
}

export type Identity = {
  /** Nostr secret key (32 bytes) */
  nostrSecret: Uint8Array
  /** hex x-only pubkey */
  nostrPubkey: string
  /** ed25519 seed (32 bytes); the Solana "secret key" is this + the pubkey */
  solSecret: Uint8Array
  /** base58 Solana address */
  solAddress: string
}

export function identityFromSeed(seed: Uint8Array, account = 0): Identity {
  const nostrSecret = HDKey.fromMasterSeed(seed).derive(`m/44'/1237'/${account}'/0/0`).privateKey
  if (!nostrSecret) throw new Error('could not derive identity key')
  const { key: solSecret } = slip10(seed, [44, 501, account, 0])
  return {
    nostrSecret,
    nostrPubkey: getPublicKey(nostrSecret),
    solSecret,
    solAddress: base58.encode(ed25519.getPublicKey(solSecret)),
  }
}

/** Browser: PBKDF2 runs in WebCrypto (fast). Falls back to the JS version anywhere else. */
export async function identityFromMnemonic(m: string, passphrase = '', account = 0): Promise<Identity> {
  const words = normalizeMnemonic(m)
  if (!validateMnemonic(words, wordlist)) throw new Error('those words are not a valid recovery phrase')
  let seed: Uint8Array
  try {
    seed = await mnemonicToSeedWebcrypto(words, passphrase)
  } catch {
    seed = mnemonicToSeedSync(words, passphrase)
  }
  return identityFromSeed(seed, account)
}

export const hex = bytesToHex
