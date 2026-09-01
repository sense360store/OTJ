import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './styles.css'
import { App } from './App'
import { AuthProvider } from './hooks/useAuth'
import { QueryIdentityScope } from './components/QueryIdentityScope'
import { ThemeProvider } from './hooks/useTheme'

// AuthProvider sits ABOVE the query layer, because each signed in identity
// gets its own QueryClient and the identity is what decides which one is
// current. See src/lib/queryIdentity.ts. There is deliberately no module
// level client: one that outlived a sign out is the whole defect.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <QueryIdentityScope>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryIdentityScope>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
)
