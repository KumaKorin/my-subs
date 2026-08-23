/**
 * Web Crypto AES-GCM & SHA-256 Utility Functions
 */

// 将字符串编码为 Uint8Array
function strToU8(str) {
    return new TextEncoder().encode(str)
}

// 将 Uint8Array 解码为字符串
function u8ToStr(u8) {
    return new TextDecoder().decode(u8)
}

// ArrayBuffer 转 Base64
function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
}

// Base64 转 Uint8Array
function base64ToBuffer(base64) {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
    }
    return bytes
}

// 从 rawSecret (APP_SECRET) 派生 256 位 AES-GCM Key
async function getAesKey(rawSecret) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', strToU8(rawSecret))
    return crypto.subtle.importKey('raw', hashBuffer, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

/**
 * AES-GCM 加密
 * @param {string} plainText 明文字符串
 * @param {string} secretKey 密钥字符串 (APP_SECRET)
 * @returns {Promise<string>} 格式为 iv_base64:ciphertext_base64
 */
export async function encryptAesGcm(plainText, secretKey) {
    if (typeof plainText !== 'string') {
        plainText = JSON.stringify(plainText)
    }
    const key = await getAesKey(secretKey)
    const iv = crypto.getRandomValues(new Uint8Array(12)) // 96 位 IV
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, strToU8(plainText))

    return `${bufferToBase64(iv)}:${bufferToBase64(encrypted)}`
}

/**
 * AES-GCM 解密
 * @param {string} encryptedString 格式为 iv_base64:ciphertext_base64
 * @param {string} secretKey 密钥字符串 (APP_SECRET)
 * @returns {Promise<string>} 解密后的明文字符串
 */
export async function decryptAesGcm(encryptedString, secretKey) {
    if (!encryptedString || !encryptedString.includes(':')) {
        throw new Error('Invalid encrypted payload format')
    }
    const [ivBase64, dataBase64] = encryptedString.split(':')
    const iv = base64ToBuffer(ivBase64)
    const data = base64ToBuffer(dataBase64)
    const key = await getAesKey(secretKey)

    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)

    return u8ToStr(new Uint8Array(decrypted))
}

/**
 * HMAC-SHA256 签名
 */
export async function hmacSign(message, secretKey) {
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey('raw', enc.encode(secretKey), { name: 'HMAC', hash: 'SHA-256' }, false, [
        'sign'
    ])
    const signature = await crypto.subtle.sign('HMAC', key, enc.encode(message))
    return bufferToBase64(signature)
}

/**
 * HMAC-SHA256 验证 (常数时间比对)
 */
export async function hmacVerify(message, signatureBase64, secretKey) {
    try {
        const expectedSig = await hmacSign(message, secretKey)
        return timingSafeEqual(expectedSig, signatureBase64)
    } catch {
        return false
    }
}

/**
 * 生成 64 字符的随机 Hex 字符串 (32 字节高熵随机数)
 */
export function generateRandomHexToken(byteLength = 32) {
    const bytes = new Uint8Array(byteLength)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
}

/**
 * 常数时间字符串比对，防止时序攻击
 */
export function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false
    let diff = a.length ^ b.length
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const charA = i < a.length ? a.charCodeAt(i) : 0
        const charB = i < b.length ? b.charCodeAt(i) : 0
        diff |= charA ^ charB
    }
    return diff === 0
}
