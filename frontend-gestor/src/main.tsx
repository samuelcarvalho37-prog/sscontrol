import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import './styles/global.css'
import './styles/manager-operator-theme.css'
import './styles/visual-polish.css'

const root = document.getElementById('root')
if (!root) throw new Error('Elemento #root nao encontrado.')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
