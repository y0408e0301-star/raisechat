/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, searchForWorkspaceRoot } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // /api へのリクエストと WebSocket（/ws）は Spring Boot（backend）へ転送する。
    // 画面と API が同じオリジン（localhost:5173）に見えるので、Cookie がそのまま使える。
    // WebSocket の Origin（http://localhost:5173）はそのまま渡り、API が画面の URL か確かめる（インフラ設計書 4 章）
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
    // リポジトリの docs/api（サーバーが書き出した通知の JSON の見本）を、画面のテストから読む（src/realtime/events.test.ts）
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd()), '../docs/api'],
    },
  },
  // ユニットテスト（npm test）。画面の部品を表示するテストがあるので jsdom で動かす
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
  },
})
