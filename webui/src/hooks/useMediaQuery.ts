/** 响应式断点 hook（单一实现，禁止各页面自己监听 resize） */
import { useEffect, useState } from 'react'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/** 与 global.css 中 @media (max-width: 768px) 保持一致 */
export const useIsMobile = () => useMediaQuery('(max-width: 768px)')
