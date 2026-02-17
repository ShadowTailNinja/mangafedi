import { generateMnemonic, mnemonicToSeed, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import * as ed from '@noble/ed25519'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export function generateUserMnemonic(): string {
  return generateMnemonic(wordlist, 128) // 12 words
}

export function isValidMnemonic(mnemonic: string): boolean {
  return validateMnemonic(mnemonic, wordlist)
}

export async function derivePortableKeypair(mnemonic: string): Promise<{
  publicKey: string
  fingerprint: string
}> {
  const seed = await mnemonicToSeed(mnemonic)
  const privateKeyBytes = seed.slice(0, 32)
  const publicKeyBytes = await ed.getPublicKey(privateKeyBytes)
  const fingerprint = bytesToHex(sha256(publicKeyBytes).slice(0, 16))
  return {
    publicKey: bytesToHex(publicKeyBytes),
    fingerprint,
  }
}

export async function signWithPortableKey(mnemonic: string, message: Uint8Array): Promise<string> {
  const seed = await mnemonicToSeed(mnemonic)
  const privateKeyBytes = seed.slice(0, 32)
  return bytesToHex(await ed.sign(message, privateKeyBytes))
}

export async function verifyPortableSignature(
  publicKeyHex: string,
  message: Uint8Array,
  signatureHex: string
): Promise<boolean> {
  return ed.verify(signatureHex, message, publicKeyHex)
}

export function encryptPrivateKey(pem: string, secret: string): string {
  const iv = randomBytes(16)
  const key = Buffer.from(secret, 'hex').subarray(0, 32)
  const cipher = createCipheriv('aes-256-cbc', key, iv)
  const encrypted = Buffer.concat([cipher.update(pem, 'utf8'), cipher.final()])
  return iv.toString('hex') + ':' + encrypted.toString('hex')
}

export function decryptPrivateKey(encrypted: string, secret: string): string {
  const colonIdx = encrypted.indexOf(':')
  const ivHex = encrypted.slice(0, colonIdx)
  const dataHex = encrypted.slice(colonIdx + 1)
  const iv = Buffer.from(ivHex, 'hex')
  const key = Buffer.from(secret, 'hex').subarray(0, 32)
  const decipher = createDecipheriv('aes-256-cbc', key, iv)
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final()
  ]).toString('utf8')
}
