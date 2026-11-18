// ブラウザの通知（FN-14 NT-7・NT-8）を出すための Service Worker。
// Android の Chrome は new Notification() を受け付けず、Service Worker の showNotification() でしか通知を出せないため、
// 通知はここに登録したもので出す（src/notifications/browserNotifications.ts）。画面のファイルの読み込み（fetch）には手を出さない

// 新しい版を、開いているタブを閉じるのを待たずに使う（通知の出し方しか持たないので、入れ替えても困らない）
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// 通知を押したら、アプリのタブを前に出し、そのメッセージの位置を開くよう画面に知らせる。
// タブがなければ（通知の後に閉じた）、そのメッセージの位置を新しいタブで開く
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const path = event.notification.data && event.notification.data.path
  event.waitUntil((async () => {
    // 並びは最後に前にあったタブから（Chrome・Edge・Firefox）
    const [tab] = await self.clients.matchAll({ type: 'window' })
    if (tab) {
      // 先に位置を知らせる（前に出せなかったときも、タブを開いた人にはその位置が出ているように）
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Client の postMessage は同じオリジンのタブにだけ届き、targetOrigin はない
      tab.postMessage({ type: 'open-message', path })
      await tab.focus()
    } else if (path) {
      await self.clients.openWindow(path)
    }
  })())
})
