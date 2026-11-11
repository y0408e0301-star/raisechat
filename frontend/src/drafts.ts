// 送らずにほかの会話に移ったときの入力の文（MS-15）。会話ごとに、画面を開いている間だけ覚える。
// ほかの人が同じブラウザでログインしたときに見えないよう、ログアウトで消す（AuthProvider）
const drafts = new Map<number, string>()

export function loadDraft(conversationId: number): string {
  return drafts.get(conversationId) ?? ''
}

export function saveDraft(conversationId: number, text: string): void {
  if (text) drafts.set(conversationId, text)
  else drafts.delete(conversationId)
}

export function clearDrafts(): void {
  drafts.clear()
}
