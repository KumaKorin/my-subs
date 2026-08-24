/**
 * Cloudflare Workers HTTP / HTTPS 上游代理抓取客户端
 *
 * 核心支持模式：
 * 1. Web Proxy 网关模式 (推荐方案，完美解决自签 IP 证书与 CF 互联限制)
 *    格式: https://user:pass@vps-gateway:port/?url=%s 或 https://vps-gateway:port/fetch?url=
 * 2. 标准 HTTP / HTTPS 代理模式
 *    格式: http://user:pass@ip:port 或 https://user:pass@domain:port
 */
import { connect } from 'cloudflare:sockets'

export interface ProxyFetchOptions {
    headers?: HeadersInit
    redirect?: 'manual' | 'follow'
    timeoutMs?: number
}

/**
 * 判断是否为 Web Proxy 网关格式 (包含 %s 或 ?url= 等)
 */
export function isWebGatewayProxy(proxyUrl: string): boolean {
    const trimmed = (proxyUrl || '').trim()
    return trimmed.includes('%s') || trimmed.includes('?url=') || trimmed.endsWith('=')
}

/**
 * 格式化 Web Proxy 网关 URL 并提取 Basic Auth 凭据
 */
export function formatWebGatewayUrl(gatewayUrl: string, targetUrl: string): { url: string; authHeader?: string } {
    let rawGateway = gatewayUrl.trim()
    let authHeader: string | undefined

    try {
        const parsed = new URL(rawGateway)
        if (parsed.username || parsed.password) {
            const user = decodeURIComponent(parsed.username)
            const pass = decodeURIComponent(parsed.password)
            authHeader = 'Basic ' + btoa(`${user}:${pass}`)
            parsed.username = ''
            parsed.password = ''
            rawGateway = parsed.toString()
        }
    } catch {}

    if (rawGateway.includes('%s')) {
        return { url: rawGateway.replace('%s', encodeURIComponent(targetUrl)), authHeader }
    }
    if (rawGateway.endsWith('=') || rawGateway.includes('?url=')) {
        return { url: `${rawGateway}${encodeURIComponent(targetUrl)}`, authHeader }
    }
    const separator = rawGateway.includes('?') ? '&' : '?'
    return { url: `${rawGateway}${separator}url=${encodeURIComponent(targetUrl)}`, authHeader }
}

function findHeaderEnd(buf: Uint8Array): number {
    for (let i = 0; i < buf.length - 3; i++) {
        if (buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 && buf[i + 3] === 10) {
            return i
        }
    }
    return -1
}

/**
 * 解析 HTTP 响应头及流式正文
 */
async function parseSocketHttpResponse(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Response> {
    const textDecoder = new TextDecoder()
    let buffer = new Uint8Array(0)
    let headerEndIndex = -1

    while (true) {
        const { value, done } = await reader.read()
        if (done) break
        if (value) {
            const newBuf = new Uint8Array(buffer.length + value.length)
            newBuf.set(buffer, 0)
            newBuf.set(value, buffer.length)
            buffer = newBuf

            headerEndIndex = findHeaderEnd(buffer)
            if (headerEndIndex !== -1) break
        }
    }

    if (headerEndIndex === -1) {
        throw new Error('Incomplete HTTP response from proxy: missing headers terminator')
    }

    const headerBytes = buffer.subarray(0, headerEndIndex)
    const rawHeadersText = textDecoder.decode(headerBytes)
    const remainingBodyBytes = buffer.subarray(headerEndIndex + 4)

    const lines = rawHeadersText.split(/\r?\n/)
    const statusLine = lines[0] || 'HTTP/1.1 502 Bad Gateway'
    const statusMatch = statusLine.match(/HTTP\/\d\.\d\s+(\d{3})(?:\s+(.*))?/i)
    const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 502
    const statusText = statusMatch && statusMatch[2] ? statusMatch[2].trim() : 'Proxy Error'

    const responseHeaders = new Headers()
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue
        const colonIdx = line.indexOf(':')
        if (colonIdx > 0) {
            const key = line.slice(0, colonIdx).trim()
            const val = line.slice(colonIdx + 1).trim()
            responseHeaders.append(key, val)
        }
    }

    const isChunked = (responseHeaders.get('transfer-encoding') || '').toLowerCase().includes('chunked')
    const contentLengthHeader = responseHeaders.get('content-length')
    const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : -1

    const bodyStream = new ReadableStream<Uint8Array>({
        async start(controller) {
            try {
                if (!isChunked) {
                    let bytesPushed = 0
                    if (remainingBodyBytes.length > 0) {
                        const len =
                            contentLength >= 0
                                ? Math.min(remainingBodyBytes.length, contentLength)
                                : remainingBodyBytes.length
                        controller.enqueue(remainingBodyBytes.subarray(0, len))
                        bytesPushed += len
                    }

                    if (contentLength >= 0 && bytesPushed >= contentLength) {
                        controller.close()
                        return
                    }

                    while (true) {
                        const { value, done } = await reader.read()
                        if (done) break
                        if (value) {
                            if (contentLength >= 0) {
                                const needed = contentLength - bytesPushed
                                if (needed <= 0) break
                                const toPush = value.length > needed ? value.subarray(0, needed) : value
                                controller.enqueue(toPush)
                                bytesPushed += toPush.length
                                if (bytesPushed >= contentLength) break
                            } else {
                                controller.enqueue(value)
                            }
                        }
                    }
                    controller.close()
                } else {
                    let chunkBuf = remainingBodyBytes
                    let isDone = false

                    async function readMore() {
                        const { value, done } = await reader.read()
                        if (done) return false
                        if (value) {
                            const combined = new Uint8Array(chunkBuf.length + value.length)
                            combined.set(chunkBuf, 0)
                            combined.set(value, chunkBuf.length)
                            chunkBuf = combined
                        }
                        return true
                    }

                    while (!isDone) {
                        const crlfIdx = findCrlf(chunkBuf)
                        if (crlfIdx === -1) {
                            const hasMore = await readMore()
                            if (!hasMore) break
                            continue
                        }

                        const lineStr = textDecoder.decode(chunkBuf.subarray(0, crlfIdx)).trim()
                        const chunkSizeHex = lineStr.split(';')[0].trim()
                        const chunkSize = parseInt(chunkSizeHex, 16)

                        if (isNaN(chunkSize) || chunkSize < 0) break
                        if (chunkSize === 0) {
                            isDone = true
                            break
                        }

                        const chunkStart = crlfIdx + 2
                        const chunkEnd = chunkStart + chunkSize
                        const totalNeeded = chunkEnd + 2

                        while (chunkBuf.length < totalNeeded) {
                            const hasMore = await readMore()
                            if (!hasMore) break
                        }

                        if (chunkBuf.length >= chunkEnd) {
                            controller.enqueue(chunkBuf.subarray(chunkStart, chunkEnd))
                            chunkBuf = chunkBuf.subarray(Math.min(chunkBuf.length, totalNeeded))
                        } else {
                            break
                        }
                    }
                    controller.close()
                }
            } catch (err) {
                controller.error(err)
            }
        }
    })

    return new Response(bodyStream, {
        status: statusCode,
        statusText,
        headers: responseHeaders
    })
}

function findCrlf(buf: Uint8Array): number {
    for (let i = 0; i < buf.length - 1; i++) {
        if (buf[i] === 13 && buf[i + 1] === 10) {
            return i
        }
    }
    return -1
}

/**
 * 发起代理请求
 */
export async function fetchViaProxy(
    targetUrl: string,
    proxyConfig: string,
    options: ProxyFetchOptions = {}
): Promise<Response> {
    const trimmedProxy = proxyConfig.trim()
    if (!trimmedProxy) {
        return fetch(targetUrl, {
            headers: options.headers,
            redirect: options.redirect || 'manual'
        })
    }

    // 1. Web Proxy 网关模式 (包含 %s 或 ?url= 等，推荐方案)
    if (isWebGatewayProxy(trimmedProxy)) {
        const { url: gatewayUrl, authHeader } = formatWebGatewayUrl(trimmedProxy, targetUrl)
        const reqHeaders = new Headers(options.headers || {})
        if (authHeader) {
            reqHeaders.set('Proxy-Authorization', authHeader)
            reqHeaders.set('Authorization', authHeader)
        }
        return fetch(gatewayUrl, {
            headers: reqHeaders,
            redirect: options.redirect || 'manual'
        })
    }

    // 2. 标准 HTTP / HTTPS 代理模式
    let proxyUrlObj: URL
    try {
        proxyUrlObj = new URL(trimmedProxy)
    } catch {
        throw new Error(`Invalid proxy URL format: ${trimmedProxy}`)
    }

    const isHttpsProxy = proxyUrlObj.protocol === 'https:'
    const proxyHost = proxyUrlObj.hostname
    const proxyPort = parseInt(proxyUrlObj.port, 10) || (isHttpsProxy ? 443 : 80)

    let proxyAuthHeader: string | null = null
    if (proxyUrlObj.username || proxyUrlObj.password) {
        const user = decodeURIComponent(proxyUrlObj.username)
        const pass = decodeURIComponent(proxyUrlObj.password)
        proxyAuthHeader = 'Basic ' + btoa(`${user}:${pass}`)
    }

    const targetUrlObj = new URL(targetUrl)
    const isTargetHttps = targetUrlObj.protocol === 'https:'
    const targetHost = targetUrlObj.hostname
    const targetPort = parseInt(targetUrlObj.port, 10) || (isTargetHttps ? 443 : 80)
    const targetPath = `${targetUrlObj.pathname || '/'}${targetUrlObj.search || ''}`

    // 如果目标是 HTTPS 且代理也是 HTTPS 代理：由于 CF Workers 不支持嵌套 TLS 握手且无法忽略自签 IP 证书，提示转为网关模式
    if (isHttpsProxy && isTargetHttps) {
        throw new Error(
            `无法直连自签 IP 目标: Cloudflare Workers 沙箱环境不支持在 HTTPS 代理隧道内嵌套建立二级 TLS 握手，且原生 TLS 强制校验公共 CA 证书。` +
                `请使用 Web Proxy 网关格式（如: http://${proxyUrlObj.username ? `${proxyUrlObj.username}:*****@` : ''}${proxyHost}:端口/?url=%s），由服务端代为拉取自签 IP 订阅源。`
        )
    }

    const socket = connect(
        { hostname: proxyHost, port: proxyPort },
        {
            secureTransport: isHttpsProxy ? 'on' : 'off',
            allowHalfOpen: false
        }
    )

    const writer = socket.writable.getWriter()
    const reader = socket.readable.getReader()
    const textEncoder = new TextEncoder()

    try {
        if (!isTargetHttps) {
            const reqLines = [
                `GET ${targetUrl} HTTP/1.1`,
                `Host: ${targetHost}${targetUrlObj.port ? `:${targetUrlObj.port}` : ''}`,
                `Connection: close`,
                `Accept: */*`
            ]
            if (proxyAuthHeader) {
                reqLines.push(`Proxy-Authorization: ${proxyAuthHeader}`)
            }

            if (options.headers) {
                const headersObj = new Headers(options.headers)
                for (const [k, v] of headersObj.entries()) {
                    const lk = k.toLowerCase()
                    if (lk !== 'host' && lk !== 'connection' && lk !== 'proxy-authorization') {
                        reqLines.push(`${k}: ${v}`)
                    }
                }
            }

            const reqPayload = reqLines.join('\r\n') + '\r\n\r\n'
            await writer.write(textEncoder.encode(reqPayload))
            writer.releaseLock()

            return await parseSocketHttpResponse(reader)
        } else {
            // 明文 HTTP 代理 + HTTPS 目标: CONNECT 隧道 + startTls
            const connectLines = [
                `CONNECT ${targetHost}:${targetPort} HTTP/1.1`,
                `Host: ${targetHost}:${targetPort}`,
                `Proxy-Connection: Keep-Alive`
            ]
            if (proxyAuthHeader) {
                connectLines.push(`Proxy-Authorization: ${proxyAuthHeader}`)
            }
            const connectPayload = connectLines.join('\r\n') + '\r\n\r\n'
            await writer.write(textEncoder.encode(connectPayload))

            let connectBuf = new Uint8Array(0)
            const textDecoder = new TextDecoder()
            let connectEndIdx = -1

            while (true) {
                const { value, done } = await reader.read()
                if (done) break
                if (value) {
                    const newBuf = new Uint8Array(connectBuf.length + value.length)
                    newBuf.set(connectBuf, 0)
                    newBuf.set(value, connectBuf.length)
                    connectBuf = newBuf

                    connectEndIdx = findHeaderEnd(connectBuf)
                    if (connectEndIdx !== -1) break
                }
            }

            if (connectEndIdx === -1) {
                throw new Error('HTTP Proxy CONNECT failed: no response received')
            }

            const connectHeader = textDecoder.decode(connectBuf.subarray(0, connectEndIdx))
            const connectStatusMatch = connectHeader.match(/HTTP\/\d\.\d\s+(\d{3})/i)
            const connectStatusCode = connectStatusMatch ? parseInt(connectStatusMatch[1], 10) : 502

            if (connectStatusCode !== 200) {
                throw new Error(`HTTP Proxy CONNECT failed [${connectStatusCode}]: ${connectHeader.split('\r\n')[0]}`)
            }

            writer.releaseLock()
            reader.releaseLock()

            const tlsSocket = socket.startTls({
                expectedServerHostname: targetHost
            })

            const tlsWriter = tlsSocket.writable.getWriter()
            const tlsReader = tlsSocket.readable.getReader()

            const innerReqLines = [
                `GET ${targetPath} HTTP/1.1`,
                `Host: ${targetHost}${targetUrlObj.port ? `:${targetUrlObj.port}` : ''}`,
                `Connection: close`,
                `Accept: */*`
            ]

            if (options.headers) {
                const headersObj = new Headers(options.headers)
                for (const [k, v] of headersObj.entries()) {
                    const lk = k.toLowerCase()
                    if (lk !== 'host' && lk !== 'connection' && lk !== 'proxy-authorization') {
                        innerReqLines.push(`${k}: ${v}`)
                    }
                }
            }

            const innerPayload = innerReqLines.join('\r\n') + '\r\n\r\n'
            await tlsWriter.write(textEncoder.encode(innerPayload))
            tlsWriter.releaseLock()

            return await parseSocketHttpResponse(tlsReader)
        }
    } catch (err) {
        try {
            socket.close()
        } catch {}
        throw err
    }
}
