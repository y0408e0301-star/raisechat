import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

function isVisible() {
  return document.visibilityState === 'visible'
}

// 画面が見えているか（ブラウザのタブが前にあるか）。見えている間だけ読んだことにする（FN-14 NT-4）・
// 見ている会話のブラウザの通知を出さない（NT-8）のに使う
export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribe, isVisible)
}

export { isVisible as isPageVisible }
