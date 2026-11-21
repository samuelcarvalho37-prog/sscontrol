import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import './styles/global.css'
import './styles/manager-operator-theme.css'
import '../../frontend/src/styles/interface-polish.css'
import '../../frontend/src/styles/theme-preference.css'

const root = document.getElementById('root')
if (!root) throw new Error('Elemento #root nao encontrado.')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
