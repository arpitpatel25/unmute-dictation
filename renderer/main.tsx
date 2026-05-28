import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App'
import WidgetApp from './widget/WidgetApp'
import './styles.css'

const hash = window.location.hash

function RootApp() {
  if (hash === '#/widget') return <WidgetApp />
  return <App />
}

const root = document.getElementById('root')!
createRoot(root).render(
  <StrictMode>
    <RootApp />
  </StrictMode>
)
