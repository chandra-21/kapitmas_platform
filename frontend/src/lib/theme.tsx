import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export type Theme = 'dark' | 'light'

interface ThemeCtx { theme: Theme; toggle: () => void }

const Ctx = createContext<ThemeCtx>({ theme: 'dark', toggle: () => {} })

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('kaiis-theme') as Theme) ?? 'dark'
  )

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('kaiis-theme', theme)
  }, [theme])

  const toggle = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'))

  return <Ctx.Provider value={{ theme, toggle }}>{children}</Ctx.Provider>
}

export function useTheme() {
  return useContext(Ctx)
}

/* Colour tokens resolved at runtime — safe for Recharts & SVG props */
export const DARK  = { base: '#1A1F36', surface: '#242840', elevated: '#1E2240', border: '#2D3561', faint: '#3D4472', muted: '#A0A8C0', dim: '#7A82A0', primary: '#FFFFFF' }
export const LIGHT = { base: '#F2F4FA', surface: '#FFFFFF',  elevated: '#F7F8FD', border: '#D4D9F0', faint: '#9EA8CC', muted: '#5C6490', dim: '#7B83A8', primary: '#1A1F36' }

export function useColors() {
  const { theme } = useTheme()
  return theme === 'dark' ? DARK : LIGHT
}
