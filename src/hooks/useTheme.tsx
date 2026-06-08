// Dark mode toggle. Mirrors the prototype: flips .theme-dark on <html> and
// persists to localStorage under otj_dark.
import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

interface ThemeState {
  dark: boolean
  setDark: (v: boolean) => void
}

const ThemeContext = createContext<ThemeState | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState<boolean>(() => localStorage.getItem('otj_dark') === '1')

  useEffect(() => {
    localStorage.setItem('otj_dark', dark ? '1' : '0')
    document.documentElement.classList.toggle('theme-dark', dark)
  }, [dark])

  return <ThemeContext.Provider value={{ dark, setDark }}>{children}</ThemeContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
