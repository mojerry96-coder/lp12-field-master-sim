import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Honour PORT so a second dev server can be told which port to take rather
  // than silently drifting to the next free one, which leaves whoever launched
  // it pointed at a port nothing is listening on.
  server: { port: Number(process.env.PORT) || 5173 },
})
