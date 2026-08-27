import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { applyStandaloneTheme } from '@promax/promax-ui-brand'
import { PromaxConsole } from './components/PromaxConsole.tsx'

import './standalone.css'

applyStandaloneTheme()

const root = document.getElementById('root')
if (root === null) throw new Error('Promax root element is missing')

createRoot(root).render(
  <StrictMode>
    <PromaxConsole standalone />
  </StrictMode>,
)
