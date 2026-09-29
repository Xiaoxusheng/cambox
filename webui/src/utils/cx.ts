/** 极简 className 组合：过滤空值后用空格连接（项目不引 clsx，保持零新依赖） */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
