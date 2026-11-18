import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { messagePath } from '../api'
import { useRealtime } from '../realtime/RealtimeContext'
import { isPageVisible } from '../visibility'
import {
  notificationBody, notificationsEnabled, onNotificationOpen, registerNotificationWorker, showNotification,
} from './browserNotifications'

// メンション・DM が届いたら、ブラウザの通知（OS の通知欄に出るもの）を出す（FN-14 NT-7・NT-8）。
// アプリをどこかのタブで開いている間だけ動く（ログインしていて WebSocket でつながっている間）。
// その会話を開いていて画面が見えているときは出さない。押すと、アプリのタブを前に出してそのメッセージの位置を開く。
// 同じブラウザで複数のタブを開いていても、tag にメッセージの ID を入れて 1 つだけにする（5 章の 5）
export default function BrowserNotifier() {
  const { subscribeUser } = useRealtime()
  const navigate = useNavigate()
  const location = useLocation()
  // 通知の受け取りを付け直さないよう、いまの URL は ref に持つ
  const path = useRef(location.pathname)
  useEffect(() => {
    path.current = location.pathname
  }, [location.pathname])

  useEffect(() => {
    registerNotificationWorker()
  }, [])

  useEffect(() => onNotificationOpen((target) => navigate(target)), [navigate])

  useEffect(() => subscribeUser((event) => {
    if (event.type !== 'notify' || !notificationsEnabled()) return
    const { kind, message, conversationName } = event.payload
    const conversation = {
      workspaceId: event.workspaceId, id: message.conversationId, type: kind === 'DM' ? 'DM' as const : 'CHANNEL' as const,
    }
    const opened = new RegExp(`^/w/${event.workspaceId}/[cd]/${message.conversationId}$`).test(path.current)
    if (opened && isPageVisible()) return
    showNotification(`${message.author.displayName}（${conversationName}）`, {
      body: notificationBody(message),
      tag: String(message.id),
      path: messagePath(conversation, message.id),
    }, (target) => navigate(target))
  }), [subscribeUser, navigate])

  return null
}
