/**
 * 统一错误类型 —— 独立成模块，避免 client.ts ↔ mock.ts 循环依赖。
 */

export class ApiError extends Error {
  /** 0 = 网络层错误；其余为后端返回的 code / HTTP 状态码 */
  readonly code: number

  constructor(code: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

/** 任意异常 → 可展示的中文文案 */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message || '未知错误'
  return String(e)
}

/** 用户主动取消（组件卸载 / 切换筛选）不应展示为错误 */
export function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError'
}
