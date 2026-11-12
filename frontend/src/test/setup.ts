// テストの共通の準備（vite.config.ts の setupFiles）
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { Client } from './fakeStomp'

// WebSocket（STOMP）は本物につながず、偽物（fakeStomp.ts）に替える
vi.mock('@stomp/stompjs', () => import('./fakeStomp'))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Client.reset()
})
