/**
 * fetch 封装：统一解包 {code, message, data}，code!==0 抛带中文 message 的 ApiError。
 * VITE_API_MODE=mock 时全部请求转由 mock.ts 处理（形状与真实接口一致）。
 */
import type { ApiResponse } from './types'
import { ApiError } from './errors'
import { mockRequest } from './mock'

export type ApiMode = 'mock' | 'real'

export const API_MODE: ApiMode =
  import.meta.env.VITE_API_MODE === 'mock' ? 'mock' : 'real'

export const IS_MOCK = API_MODE === 'mock'

export { ApiError }

export type HttpMethod = 'GET' | 'POST' | 'DELETE'

interface RequestOptions {
  signal?: AbortSignal
}

async function realRequest<T>(
  method: HttpMethod,
  path: string,
  body: unknown,
  opts?: RequestOptions,
): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: opts?.signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiError(0, '网络错误，无法连接服务器')
  }

  let envelope: ApiResponse<T> | null = null
  try {
    envelope = (await res.json()) as ApiResponse<T>
  } catch {
    // 非 JSON 响应（如反代错误页）
    throw new ApiError(res.status, `服务响应异常（HTTP ${res.status}）`)
  }

  if (!res.ok || envelope.code !== 0) {
    throw new ApiError(
      envelope.code || res.status,
      envelope.message || `请求失败（HTTP ${res.status}）`,
    )
  }
  return envelope.data
}

/** 统一请求入口：页面禁止直接 fetch，一律走此函数 */
export function apiRequest<T>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  opts?: RequestOptions,
): Promise<T> {
  if (API_MODE === 'mock') {
    return mockRequest<T>(method, path, body, opts?.signal)
  }
  return realRequest<T>(method, path, body, opts)
}

export function apiGet<T>(path: string, opts?: RequestOptions): Promise<T> {
  return apiRequest<T>('GET', path, undefined, opts)
}

export function apiPost<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
  return apiRequest<T>('POST', path, body, opts)
}

export function apiDelete<T>(path: string, opts?: RequestOptions): Promise<T> {
  return apiRequest<T>('DELETE', path, undefined, opts)
}
