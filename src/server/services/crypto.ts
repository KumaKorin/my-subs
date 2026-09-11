/**
 * Web Crypto AES-256-GCM 与 HMAC-SHA256 密码学工具服务
 */

function strToU8(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

function u8ToStr(u8: Uint8Array): string {
  return new TextDecoder().decode(u8)
}

function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToBuffer(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

async function getAesKey(rawSecret: string): Promise<CryptoKey> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', strToU8(rawSecret) as unknown as BufferSource)
  return crypto.subtle.importKey('raw', hashBuffer, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

/**
 * AES-256-GCM 对称加密
 */
export async function encryptAesGcm(plainText: string, secretKey: string): Promise<string> {
  if (!secretKey) return plainText
  if (typeof plainText !== 'string') {
    plainText = JSON.stringify(plainText)
  }
  const key = await getAesKey(secretKey)
  const iv = crypto.getRandomValues(new Uint8Array(12)) // 96 位 IV
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    strToU8(plainText) as unknown as BufferSource
  )

  return `${bufferToBase64(iv)}:${bufferToBase64(encrypted)}`
}

/**
 * AES-256-GCM 对称解密
 */
export async function decryptAesGcm(encryptedString: string, secretKey: string): Promise<string> {
  if (!secretKey) return encryptedString
  if (!encryptedString || !encryptedString.includes(':')) {
    return encryptedString
  }
  try {
    const [ivBase64, dataBase64] = encryptedString.split(':')
    const iv = base64ToBuffer(ivBase64)
    const data = base64ToBuffer(dataBase64)
    const key = await getAesKey(secretKey)

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      data as unknown as BufferSource
    )

    return u8ToStr(new Uint8Array(decrypted))
  } catch {
    return encryptedString
  }
}

/**
 * HMAC-SHA256 数据签名
 */
export async function hmacSign(message: string, secretKey: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secretKey) as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(message) as unknown as BufferSource)
  return bufferToBase64(signature)
}

/**
 * HMAC-SHA256 签名验证 (常数时间比对，防时序侧信道攻击)
 */
export async function hmacVerify(message: string, signatureBase64: string, secretKey: string): Promise<boolean> {
  try {
    const expectedSig = await hmacSign(message, secretKey)
    return timingSafeEqual(expectedSig, signatureBase64)
  } catch {
    return false
  }
}

/**
 * 生成安全的随机十六进制 Token
 */
export function generateRandomHexToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * 常数时间字符串比对
 */
export function timingSafeEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const charA = i < a.length ? a.charCodeAt(i) : 0
    const charB = i < b.length ? b.charCodeAt(i) : 0
    diff |= charA ^ charB
  }
  return diff === 0
}
