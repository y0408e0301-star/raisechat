import { useId, useRef, useState } from 'react'
import type { ReactionView } from '../api'
import { reactionLabel, reactorNames } from './reactionState'
import styles from './Reactions.module.css'

// 長押しとみなす時間（スマートフォンで付けた人を出す。RE-4）
const LONG_PRESS_MS = 500

type Props = {
  reactions: ReactionView[]
  // 付けられるか（送れる会話の、削除されていないメッセージ。RE-7）。付けられないときは見るだけ
  canReact: boolean
  onToggle: (emoji: string) => void
  // 「＋」で絵文字の一覧を出す（RE-1）
  onOpenPicker: (anchor: HTMLElement) => void
}

// メッセージの下のリアクション（画面設計書 2.11、RE-2〜RE-5）。絵文字と件数を、最初に付けられた順に並べる
export default function Reactions({ reactions, canReact, onToggle, onOpenPicker }: Props) {
  if (reactions.length === 0) return null
  return (
    <ul className={styles.reactions} aria-label="リアクション">
      {reactions.map((r) => (
        <li key={r.emoji}>
          <ReactionChip reaction={r} canReact={canReact} onToggle={() => onToggle(r.emoji)} />
        </li>
      ))}
      {canReact && (
        <li>
          <button type="button" className={styles.chip} aria-label="リアクションを付ける" title="リアクションを付ける"
            onClick={(e) => onOpenPicker(e.currentTarget)}>
            <span className={styles.emoji} aria-hidden="true">😀</span>＋
          </button>
        </li>
      )}
    </ul>
  )
}

// 1 つの絵文字。押すと付ける・外す（RE-3）。重ねる・カーソルを移す・長押しで、付けた人を出す（RE-4）
function ReactionChip({ reaction, canReact, onToggle }: { reaction: ReactionView, canReact: boolean, onToggle: () => void }) {
  const tooltipId = useId()
  const [showing, setShowing] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  // 長押しで出したときは、指を離したときの押す操作を付ける・外すにしない
  const longPressed = useRef(false)

  function startPress() {
    longPressed.current = false
    timer.current = window.setTimeout(() => {
      longPressed.current = true
      setShowing(true)
    }, LONG_PRESS_MS)
  }

  function endPress() {
    window.clearTimeout(timer.current)
  }

  function handleClick() {
    if (longPressed.current) {
      longPressed.current = false
      return
    }
    if (canReact) onToggle()
  }

  return (
    <span className={styles.wrap}>
      <button type="button" className={`${styles.chip} ${reaction.reactedByMe ? styles.mine : ''}`}
        aria-label={reactionLabel(reaction)} aria-pressed={reaction.reactedByMe} aria-disabled={!canReact}
        aria-describedby={showing ? tooltipId : undefined} onClick={handleClick}
        onMouseEnter={() => setShowing(true)} onMouseLeave={() => setShowing(false)}
        onFocus={() => setShowing(true)} onBlur={() => setShowing(false)}
        onTouchStart={startPress} onTouchEnd={endPress} onTouchMove={endPress}
        onContextMenu={(e) => e.preventDefault()}>
        <span className={styles.emoji} aria-hidden="true">{reaction.emoji}</span>
        <span aria-hidden="true">{reaction.count}</span>
      </button>
      {showing && (
        <span id={tooltipId} role="tooltip" className={styles.tooltip}>{reactorNames(reaction)}</span>
      )}
    </span>
  )
}
