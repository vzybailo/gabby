import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Tailwind is configured via postcss.config.js and imported in your CSS entry
// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react()
  ],
})
