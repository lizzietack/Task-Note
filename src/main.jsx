import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

let reloadingForUpdate = false

if ('serviceWorker' in navigator) {
  const checkForUpdate = () => navigator.serviceWorker.getRegistration('/')
    .then(registration => registration?.update())
    .catch(() => {})

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingForUpdate) return
    reloadingForUpdate = true
    window.location.reload()
  })
  window.addEventListener('load', checkForUpdate, { once: true })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate()
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
import './collaboration.css'
