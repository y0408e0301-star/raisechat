import { createContext, useContext, useMemo, type ReactNode } from 'react'
import Markdown, { type Components, type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { UserName } from '../api'
import ProfileButton from '../profile/ProfileButton'
import remarkChatSyntax from './remarkChatSyntax'
import remarkMentions from './remarkMentions'
import styles from './MessageBody.module.css'

// 出してよい要素（MS-6・MS-7）。これ以外は中の文字だけを出す
// span はメンション（remarkMentions が作る）だけ
const ALLOWED = ['p', 'strong', 'em', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'br', 'span']

// 取り消し線は「~~」だけ（「~」1 つは飾りにしない）
const REMARK_PLUGINS: NonNullable<Options['remarkPlugins']> = [[remarkGfm, { singleTilde: false }], remarkChatSyntax]

function isWebUrl(href: string | undefined): href is string {
  return href !== undefined && /^https?:\/\//i.test(href)
}

// 本文の中のメンションを出すのに使う、記録したメンションと見ている人
type MentionInfo = { mentions: UserName[], me: string | undefined }
const MentionContext = createContext<MentionInfo>({ mentions: [], me: undefined })

// メンション（MN-3）。主色の文字にし、自分あては背景の色も変える。押すと G-16（MN-7）
function Mention({ username, children }: { username: unknown, children: ReactNode }) {
  const { mentions, me } = useContext(MentionContext)
  const user = mentions.find((m) => m.username.toLowerCase() === username)
  if (!user) return <>{children}</>
  const mine = user.username.toLowerCase() === me?.toLowerCase()
  return (
    <ProfileButton user={{ ...user, avatarUrl: null }}>
      <span className={`${styles.mention} ${mine ? styles.toMe : ''}`}>{children}</span>
    </ProfileButton>
  )
}

const COMPONENTS: Components = {
  // http・https の URL だけをリンクにし、新しいタブで開く。それ以外（javascript: など）は文字のまま（MS-7、N-21）
  a: ({ href, children }) => (isWebUrl(href)
    ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    : <>{children}</>),
  // コードブロックは長い行を折り返さず横にスクロールするので、キーボードでもスクロールできるようフォーカスを受ける（WCAG 2.1.1）
  // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
  pre: ({ children }) => <pre tabIndex={0}>{children}</pre>,
  // span は remarkMentions が作るメンションだけ
  span: ({ children, ...props }) => (
    <Mention username={(props as Record<string, unknown>)['data-mention']}>{children}</Mention>
  ),
}

type Props = {
  body: string
  // 記録したメンション（MessageView の mentions）。この人の「@ユーザー ID」だけを目立たせる（MN-3）
  mentions?: UserName[]
  // 見ている人のユーザー ID。自分へのメンションは背景の色も変える
  me?: string
}

const NO_MENTIONS: UserName[] = []

// メッセージの本文（画面設計書 2.10）。本文は Markdown 記法のまま受け取り、React の部品に組み立てて出す。
// HTML の文字列は差し込まない（タグはそのまま文字として出る。FN-07 5 章の 2）
export default function MessageBody({ body, mentions = NO_MENTIONS, me }: Props) {
  const key = mentions.map((m) => m.username.toLowerCase()).join(' ')
  const plugins = useMemo(() => [...REMARK_PLUGINS, remarkMentions(new Set(key.split(' ').filter(Boolean)))], [key])
  const info = useMemo(() => ({ mentions, me }), [mentions, me])
  return (
    <MentionContext value={info}>
      <div className={styles.body}>
        <Markdown remarkPlugins={plugins} allowedElements={ALLOWED} unwrapDisallowed skipHtml={false}
          components={COMPONENTS}>
          {body}
        </Markdown>
      </div>
    </MentionContext>
  )
}
