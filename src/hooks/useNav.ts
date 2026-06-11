// A thin wrapper that preserves the prototype's nav(screen, params) call sites
// while driving real react-router URLs underneath.
import { useNavigate } from 'react-router-dom'

export interface NavParams {
  drillId?: string
  sessionId?: string
  corner?: string
  programmeId?: string
}

export function useNav() {
  const navigate = useNavigate()
  return (screen: string, params: NavParams = {}) => {
    switch (screen) {
      case 'home':
        navigate('/')
        break
      case 'library':
        navigate(params.corner ? `/library?corner=${params.corner}` : '/library')
        break
      case 'drill':
        navigate(`/drill/${params.drillId}`)
        break
      case 'sessions':
        navigate('/sessions')
        break
      case 'planner':
        navigate(params.sessionId ? `/planner?sessionId=${params.sessionId}` : '/planner')
        break
      case 'templates':
        navigate('/templates')
        break
      case 'englandFootball':
        navigate('/england-football')
        break
      case 'programmes':
        navigate('/programmes')
        break
      case 'programme':
        navigate(`/programmes/${params.programmeId}`)
        break
      case 'media':
        navigate('/media')
        break
      case 'live':
        navigate(`/live/${params.sessionId}`)
        break
      case 'sessionDay':
        navigate(`/session-day/${params.sessionId}`)
        break
      default:
        navigate('/')
    }
    window.scrollTo(0, 0)
  }
}
