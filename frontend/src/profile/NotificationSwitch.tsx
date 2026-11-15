import { useId, useState } from 'react'
import { M } from '../messages'
import {
  disableNotifications, enableNotifications, useNotificationSetting,
} from '../notifications/browserNotifications'
import styles from './ProfilePage.module.css'

// G-10 の「ブラウザの通知」（画面設計書 12 章、NT-7・NT-9）。押すとすぐ切り替わり、「保存する」は要らない。
// オンにするときにブラウザがまだ許可していなければ許可を求め、許可されなければ M-46 を出してオフのままにする
export default function NotificationSwitch() {
  const on = useNotificationSetting()
  const [denied, setDenied] = useState(false)
  const [asking, setAsking] = useState(false)
  const hintId = useId()
  const errorId = useId()

  async function toggle() {
    if (on) {
      disableNotifications()
      return
    }
    setAsking(true)
    const allowed = await enableNotifications()
    setAsking(false)
    setDenied(!allowed)
  }

  return (
    <div className={styles.field}>
      <h2 className={styles.section}>通知</h2>
      <div className={styles.switchRow}>
        <span className={styles.label} id={`${hintId}-label`}>ブラウザの通知</span>
        <button type="button" role="switch" aria-checked={on} aria-labelledby={`${hintId}-label`}
          aria-describedby={denied ? `${hintId} ${errorId}` : hintId} disabled={asking}
          className={`${styles.switch} ${on ? styles.switchOn : ''}`} onClick={toggle}>
          <span className={styles.switchText}>{on ? 'オン' : 'オフ'}</span>
          <span className={styles.knob} aria-hidden="true" />
        </button>
      </div>
      <p id={hintId} className={styles.hint}>メンションと DM が届いたときに通知します。このブラウザだけの設定です。</p>
      {denied && <p id={errorId} className={styles.error} role="alert">{M[46]}</p>}
    </div>
  )
}
