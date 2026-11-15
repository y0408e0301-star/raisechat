import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { searchUrl } from '../api'
import { M } from '../messages'
import { MESSAGE_SEARCH_MAX, limitChars } from '../validation'
import styles from './SearchBox.module.css'
import { useToast } from './ToastContext'

type Props = { workspaceId: number }

// ヘッダーの検索欄（画面設計書 2.6、SR-1・SR-7）。G-6 では検索した文字を入れておく（URL が変わったら入れ直す）
export default function SearchBox({ workspaceId }: Props) {
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const current = location.pathname === `/w/${workspaceId}/search` ? (params.get('q') ?? '') : ''
  return <SearchField key={current} workspaceId={workspaceId} initial={current} />
}

function SearchField({ workspaceId, initial }: Props & { initial: string }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [text, setText] = useState(initial)
  // 画面の横幅が 600px 未満では虫めがねのボタンだけを出し、押すとヘッダーの全体を検索欄にする
  const [expanded, setExpanded] = useState(false)

  // Enter キーで G-6。トリムして 0 文字なら M-43（SR-7）
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const q = text.trim()
    if (!q) {
      toast(M[43])
      return
    }
    setExpanded(false)
    navigate(searchUrl(workspaceId, { q, conversationId: null, from: null }))
  }

  return (
    <>
      <button type="button" className={styles.open} aria-label="メッセージを検索" aria-expanded={expanded}
        onClick={() => setExpanded(true)}>🔍</button>
      <search className={`${styles.form} ${expanded ? styles.expanded : ''}`}>
        <form className={styles.inner} onSubmit={submit}>
        <input type="search" className={styles.input} aria-label="メッセージを検索" placeholder="🔍 メッセージを検索"
          value={text} onChange={(e) => setText(limitChars(e.target.value, MESSAGE_SEARCH_MAX))}
          onKeyDown={(e) => { if (e.key === 'Escape') setExpanded(false) }} />
        <button type="button" className={styles.close} aria-label="検索欄を閉じる" onClick={() => setExpanded(false)}>✕</button>
        </form>
      </search>
    </>
  )
}
