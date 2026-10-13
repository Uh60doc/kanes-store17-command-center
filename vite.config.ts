import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { commandCenterMiddleware } from './server/gate.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), '')
  const gate = commandCenterMiddleware({
    password: process.env.COMMAND_CENTER_PASSWORD ?? fileEnv.COMMAND_CENTER_PASSWORD ?? '',
    sheetCsvUrl: process.env.COMMAND_CENTER_SHEET_CSV_URL ?? fileEnv.COMMAND_CENTER_SHEET_CSV_URL ?? '',
  })

  return {
    plugins: [
      react(),
      {
        name: 'command-center-gate',
        configureServer(server) {
          server.middlewares.use(gate)
        },
        configurePreviewServer(server) {
          server.middlewares.use(gate)
        },
      },
    ],
  }
})
