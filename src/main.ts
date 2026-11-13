import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
const app = createApp(App)
app.config.errorHandler = (error) => {
  console.error(error)
  const message = document.createElement('div')
  message.setAttribute('role', 'alert')
  message.className = 'error'
  message.textContent = 'Не удалось показать сцену: ' + String(error)
  document.body.appendChild(message)
}
app.mount('#app')
