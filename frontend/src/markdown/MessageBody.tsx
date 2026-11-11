import Markdown, { type Components, type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkChatSyntax from './remarkChatSyntax'
import styles from './MessageBody.module.css'

// 出してよい要素（MS-6・MS-7）。これ以外は中の文字だけを出す
const ALLOWED = ['p', 'strong', 'em', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'br']

// 取り消し線は「~~」だけ（「~」1 つは飾りにしない）
const REMARK_PLUGINS: Options['remarkPlugins'] = [[remarkGfm, { singleTilde: false }], remarkChatSyntax]

function isWebUrl(href: string | undefined): href is string {
  return href !== undefined && /^https?:\/\//i.test(href)
}

const COMPONENTS: Components = {
  // http・https の URL だけをリンクにし、新しいタブで開く。それ以外（javascript: など）は文字のまま（MS-7、N-21）
  a: ({ href, children }) => (isWebUrl(href)
    ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    : <>{children}</>),
}

// メッセージの本文（画面設計書 2.10）。本文は Markdown 記法のまま受け取り、React の部品に組み立てて出す。
// HTML の文字列は差し込まない（タグはそのまま文字として出る。FN-07 5 章の 2）
export default function MessageBody({ body }: { body: string }) {
  return (
    <div className={styles.body}>
      <Markdown remarkPlugins={REMARK_PLUGINS} allowedElements={ALLOWED} unwrapDisallowed skipHtml={false}
        components={COMPONENTS}>
        {body}
      </Markdown>
    </div>
  )
}
