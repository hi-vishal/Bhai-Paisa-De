import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Keypair, PublicKey, Transaction, SystemProgram, ComputeBudgetProgram } from '@solana/web3.js'
import { getAssociatedTokenAddressSync, createTransferCheckedInstruction, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { canon } from './canon'
import { identityFromMnemonic, isMnemonic, newMnemonic, slip10 } from './keys'
import * as S from './solana'
import { minorToBase, baseToMinor, minorToSats } from './money'

test('SLIP-10 ed25519 matches the spec test vector', () => {
  const seed = hexToBytes('000102030405060708090a0b0c0d0e0f')
  const m = slip10(seed, [])
  assert.equal(bytesToHex(m.key), '2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7')
  assert.equal(bytesToHex(m.chain), '90046a93de5380a72b5e45010748567d5ea02bbf6522f979e05c0d8d8ca9fffb')
  const c = slip10(seed, [0])
  assert.equal(bytesToHex(c.key), '68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3')
  assert.equal(bytesToHex(c.chain), '8b59aa11380b624e81507a27fedda59fea6d0b779a778918a2fd3590e16e9c69')
})

test('NIP-06 identity matches the spec test vector; Solana key is a real keypair', async () => {
  const id = await identityFromMnemonic('leader monkey parrot ring guide accident before fence cannon height naive bean')
  assert.equal(bytesToHex(id.nostrSecret), '7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a')
  assert.equal(id.nostrPubkey, '17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6eec3ca5cd917')
  assert.equal(Keypair.fromSeed(id.solSecret).publicKey.toBase58(), id.solAddress)
  const again = await identityFromMnemonic('  LEADER monkey parrot ring guide accident before fence cannon height naive   bean ')
  assert.equal(again.solAddress, id.solAddress)
  assert.ok(isMnemonic(newMnemonic()))
  assert.equal(isMnemonic('leader monkey parrot ring guide accident before fence cannon height naive naive'), false)
})

test('associated token addresses match spl-token for 300 random wallets', () => {
  for (let i = 0; i < 300; i++) {
    const owner = Keypair.generate().publicKey
    const mint = i % 3 ? Keypair.generate().publicKey : new PublicKey(S.USDT_MAINNET)
    assert.equal(S.associatedTokenAddress(owner.toBase58(), mint.toBase58()), getAssociatedTokenAddressSync(mint, owner, true).toBase58())
  }
})

test('transactions decode in web3.js with the same instructions and valid signatures', () => {
  const payer = Keypair.generate()
  const to = Keypair.generate().publicKey.toBase58()
  const ref = S.newReference()
  const blockhash = Keypair.generate().publicKey.toBase58()
  const mint = S.USDT_MAINNET

  const ixs = [
    S.setComputeUnitLimit(60_000),
    S.setComputeUnitPrice(25_000n),
    S.createAtaIdempotent(payer.publicKey.toBase58(), to, mint),
    S.transferChecked(S.associatedTokenAddress(payer.publicKey.toBase58(), mint), mint, S.associatedTokenAddress(to, mint), payer.publicKey.toBase58(), 1_234_567n, 6, [ref]),
    S.transferSol(payer.publicKey.toBase58(), to, 5_000_000_001n, [ref]),
  ]
  const { wire, signature } = S.signTransaction(S.compileMessage(payer.publicKey.toBase58(), ixs, blockhash), { [payer.publicKey.toBase58()]: payer.secretKey.slice(0, 32) })

  const tx = Transaction.from(wire)
  assert.ok(tx.verifySignatures(), 'signature verifies')
  assert.equal(tx.feePayer?.toBase58(), payer.publicKey.toBase58())
  assert.equal(tx.recentBlockhash, blockhash)
  assert.equal(S.toAddress(tx.signature!), signature)

  const refKey = { pubkey: new PublicKey(ref), isSigner: false, isWritable: false }
  const ataIx = createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(to)), new PublicKey(to), new PublicKey(mint))
  const tokIx = createTransferCheckedInstruction(
    getAssociatedTokenAddressSync(new PublicKey(mint), payer.publicKey),
    new PublicKey(mint),
    getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(to)),
    payer.publicKey,
    1_234_567n,
    6,
  )
  tokIx.keys.push(refKey)
  const solIx = SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: new PublicKey(to), lamports: 5_000_000_001n })
  solIx.keys.push(refKey)
  const expected = [ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 25_000 }), ataIx, tokIx, solIx]

  // a key's flags in the message are the union of how every instruction uses it
  const merged = (pk: string) => {
    const uses = expected.flatMap((ix) => ix.keys).filter((k) => k.pubkey.toBase58() === pk)
    const payerKey = pk === payer.publicKey.toBase58()
    return { signer: payerKey || uses.some((k) => k.isSigner), writable: payerKey || uses.some((k) => k.isWritable) }
  }
  assert.equal(tx.instructions.length, expected.length)
  tx.instructions.forEach((got, i) => {
    const want = expected[i]
    assert.equal(got.programId.toBase58(), want.programId.toBase58(), `program #${i}`)
    assert.equal(bytesToHex(got.data), bytesToHex(want.data), `data #${i}`)
    // web3.js re-derives signer/writable from the message header, so compare what the runtime will see
    assert.deepEqual(
      got.keys.map((k) => k.pubkey.toBase58()),
      want.keys.map((k) => k.pubkey.toBase58()),
      `keys #${i}`,
    )
    got.keys.forEach((k, j) => {
      const pk = k.pubkey.toBase58()
      assert.equal(k.isSigner, merged(pk).signer, `signer #${i}.${j}`)
      assert.equal(k.isWritable, merged(pk).writable, `writable #${i}.${j}`)
    })
  })
})

test('decimal amounts and Solana Pay URLs', () => {
  assert.equal(S.toDecimal(1_234_500n, 6), '1.2345')
  assert.equal(S.toDecimal(5n, 9), '0.000000005')
  assert.equal(S.toDecimal(2_000_000_000n, 9), '2')
  assert.equal(S.fromDecimal('1.2345', 6), 1_234_500n)
  assert.equal(S.fromDecimal('0.0000001', 6), null)
  assert.equal(S.fromDecimal('1e5', 6), null)
  const url = S.solanaPayUrl({ recipient: 'A'.repeat(32), amount: 1_500_000n, decimals: 6, splToken: S.USDT_MAINNET, reference: 'B'.repeat(32), label: 'Bhai Paise De', message: 'Goa trip: Om → Ria' })
  assert.equal(url, `solana:${'A'.repeat(32)}?amount=1.5&spl-token=${S.USDT_MAINNET}&reference=${'B'.repeat(32)}&label=Bhai%20Paise%20De&message=Goa%20trip%3A%20Om%20%E2%86%92%20Ria`)
})

test('fiat ⇄ asset conversions round in the payee’s favour', () => {
  // ₹1,000 at ₹88/USDT = 11.363636… USDT → rounds up to 11.363637
  assert.equal(minorToBase(100_000, 'INR', 'USDT', 88), 11_363_637n)
  // $10 at $200/SOL = 0.05 SOL exactly
  assert.equal(minorToBase(1000, 'USD', 'SOL', 200), 50_000_000n)
  assert.equal(minorToSats(100, 'USD', 100_000), 1000)
  // and back: 11.363637 USDT at ₹88 is ₹1,000.00 (floored)
  assert.equal(baseToMinor(11_363_637n, 'INR', 'USDT', 88), 100_000)
})

test('reading a payment out of a jsonParsed transaction', () => {
  const me = 'Me1111111111111111111111111111111111111111'.slice(0, 44)
  const tx: S.RpcTransaction = {
    slot: 1,
    blockTime: 1,
    meta: {
      err: null,
      fee: 5000,
      preBalances: [10_000_000, 1_000, 1],
      postBalances: [4_995_000, 5_001_000, 1],
      preTokenBalances: [{ accountIndex: 3, mint: S.USDT_MAINNET, owner: me, uiTokenAmount: { amount: '100', decimals: 6 } }],
      postTokenBalances: [{ accountIndex: 3, mint: S.USDT_MAINNET, owner: me, uiTokenAmount: { amount: '2500100', decimals: 6 } }],
    },
    transaction: { signatures: ['x'], message: { accountKeys: [{ pubkey: 'payer' }, { pubkey: me }, 'ref'] } },
  }
  assert.equal(S.amountReceived(tx, me), 5_000_000n)
  assert.equal(S.amountReceived(tx, me, S.USDT_MAINNET), 2_500_000n)
  assert.equal(S.amountReceived(tx, 'someone-else'), 0n)
  assert.equal(S.amountReceived({ ...tx, meta: { ...tx.meta!, err: { InstructionError: [0, 'x'] } } }, me), 0n)
})

test('canonical JSON ignores key order and undefined', () => {
  assert.equal(canon({ b: 1, a: { d: [1, { y: 2, x: undefined }], c: 'x' } }), '{"a":{"c":"x","d":[1,{"y":2}]},"b":1}')
})
