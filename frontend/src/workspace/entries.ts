import type { AttachmentView, MessageView, UserSummary } from '../api'

// メッセージの一覧の 1 件。送ったもの（sent）と、送っている途中・送れなかったもの（pending）
export type Entry =
  | { kind: 'sent', message: MessageView }
  | {
    kind: 'pending', clientId: string, author: UserSummary, body: string, attachments: AttachmentView[],
    createdAt: string, failed: boolean,
  }

export const entryKey = (e: Entry) => (e.kind === 'sent' ? `m${e.message.id}` : `p${e.clientId}`)
