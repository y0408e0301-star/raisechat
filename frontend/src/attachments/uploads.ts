import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError, cancelUpload, completeUpload, createUpload, putToStorage, type AttachmentView,
} from '../api'
import { M } from '../messages'

// 添付できる形式（FN-09 4 章）と大きさ
const KINDS: Record<string, 'IMAGE' | 'VIDEO'> = {
  'image/jpeg': 'IMAGE',
  'image/png': 'IMAGE',
  'image/gif': 'IMAGE',
  'image/webp': 'IMAGE',
  'video/mp4': 'VIDEO',
  'video/webm': 'VIDEO',
}
export const ACCEPT = Object.keys(KINDS).join(',')
const MAX_BYTES = { IMAGE: 10 * 1024 * 1024, VIDEO: 100 * 1024 * 1024 }
export const MAX_ATTACHMENTS = 4

// 入力欄に並べる添付 1 つ（AT-1〜AT-4）。ready になったら attachment に complete の結果が入る
export type Upload = {
  localId: string
  name: string
  kind: 'IMAGE' | 'VIDEO'
  // 画像の見本（選んだファイルの URL か、取り消して戻したときは縮小した画像の URL）
  preview: string | null
  // 0〜1
  progress: number
  status: 'uploading' | 'ready' | 'failed'
  attachment: AttachmentView | null
}

// 選んだファイルのうち、添付するもの。形式・大きさが合わないものは M-39、5 個目以降は M-38 で、どちらも添付しない（AT-2）
export function checkFiles(current: number, files: File[]): { accepted: File[], message: string | null } {
  const accepted: File[] = []
  let message: string | null = null
  for (const file of files) {
    const kind = KINDS[file.type]
    if (!kind || file.size === 0 || file.size > MAX_BYTES[kind]) {
      message ??= M[39]
      continue
    }
    if (current + accepted.length >= MAX_ATTACHMENTS) {
      message = M[38]
      break
    }
    accepted.push(file)
  }
  return { accepted, message }
}

// 入力欄の添付（FN-09 3.1）。選んだらすぐに、受け付け → S3 へ PUT → complete の順にアップロードする。
// 失敗したら failed にして「もう一度」を待つ（AT-4）。送る前に外したもの・送らずに画面を離れたものは API に外してもらう
export function useUploads(conversationId: number, notify: (message: string) => void) {
  const [uploads, setUploads] = useState<Upload[]>([])
  const files = useRef(new Map<string, File>())
  const controllers = useRef(new Map<string, AbortController>())
  // 受け付けてもらった uploadId（送っていないもの）。外したとき・画面を離れたときに API に外してもらう
  const uploadIds = useRef(new Map<string, number>())
  const notifyRef = useRef(notify)
  useEffect(() => {
    notifyRef.current = notify
  }, [notify])

  const update = useCallback((localId: string, change: Partial<Upload>) => {
    setUploads((list) => list.map((u) => (u.localId === localId ? { ...u, ...change } : u)))
  }, [])

  const forget = useCallback((localId: string, cancel: boolean) => {
    controllers.current.get(localId)?.abort()
    controllers.current.delete(localId)
    const uploadId = uploadIds.current.get(localId)
    if (cancel && uploadId !== undefined) cancelUpload(uploadId).catch(() => {})
    uploadIds.current.delete(localId)
    files.current.delete(localId)
  }, [])

  const run = useCallback(async (localId: string) => {
    const file = files.current.get(localId)
    if (!file) return
    // もう一度のときは、前に受け付けてもらったものを外してから、受け付けからやり直す
    forget(localId, true)
    files.current.set(localId, file)
    const controller = new AbortController()
    controllers.current.set(localId, controller)
    update(localId, { status: 'uploading', progress: 0 })
    try {
      const ticket = await createUpload(conversationId, file)
      uploadIds.current.set(localId, ticket.uploadId)
      await putToStorage(ticket, file, (progress) => update(localId, { progress }), controller.signal)
      const attachment = await completeUpload(ticket.uploadId)
      update(localId, { status: 'ready', progress: 1, attachment })
    } catch (e) {
      if (controller.signal.aborted) return
      // 中身が申告と違った・大きすぎた（画面の確かめをすり抜けたもの）は M-39 を出して外す
      if (e instanceof ApiError && (e.code === 'ATTACHMENT_TYPE_INVALID' || e.code === 'ATTACHMENT_TOO_LARGE')) {
        notifyRef.current(M[39])
        forget(localId, false)
        setUploads((list) => list.filter((u) => u.localId !== localId))
        return
      }
      notifyRef.current(M[40])
      update(localId, { status: 'failed' })
    } finally {
      if (controllers.current.get(localId) === controller) controllers.current.delete(localId)
    }
  }, [conversationId, forget, update])

  // ファイルを足す（📎・ドラッグ＆ドロップ・貼り付け）
  function add(selected: File[]) {
    const { accepted, message } = checkFiles(uploads.length, selected)
    if (message) notifyRef.current(message)
    const added = accepted.map((file): Upload => {
      const localId = crypto.randomUUID()
      files.current.set(localId, file)
      const kind = KINDS[file.type]
      return {
        localId, name: file.name, kind, preview: kind === 'IMAGE' ? URL.createObjectURL(file) : null,
        progress: 0, status: 'uploading', attachment: null,
      }
    })
    setUploads((list) => [...list, ...added])
    for (const u of added) void run(u.localId)
  }

  function retry(localId: string) {
    void run(localId)
  }

  // 「×」で外す
  function remove(localId: string) {
    const target = uploads.find((u) => u.localId === localId)
    if (target?.preview?.startsWith('blob:')) URL.revokeObjectURL(target.preview)
    forget(localId, true)
    setUploads((list) => list.filter((u) => u.localId !== localId))
  }

  // 送るときに取り出す。取り出したものは送るメッセージに付くので、API に外してもらわない
  function take(): AttachmentView[] {
    const ready = uploads.flatMap((u) => (u.attachment ? [u.attachment] : []))
    for (const u of uploads) {
      if (u.preview?.startsWith('blob:')) URL.revokeObjectURL(u.preview)
      forget(u.localId, false)
    }
    setUploads([])
    return ready
  }

  // 送れなかったメッセージを取り消したとき、添付を入力欄に戻す（MS-13）
  function restore(attachments: AttachmentView[]) {
    setUploads((list) => [...list, ...attachments.map((a): Upload => ({
      localId: crypto.randomUUID(), name: a.fileName, kind: a.kind, preview: a.thumbnailUrl,
      progress: 1, status: 'ready', attachment: a,
    }))])
  }

  // 送らずに画面を離れたら、アップロードを止め、受け付けてもらったものを API に外してもらう
  useEffect(() => {
    const ids = uploadIds.current
    const running = controllers.current
    return () => {
      for (const controller of running.values()) controller.abort()
      for (const id of ids.values()) cancelUpload(id).catch(() => {})
    }
  }, [])

  return {
    uploads,
    add,
    retry,
    remove,
    take,
    restore,
    // アップロード中か、失敗したものがあるときは送れない（AT-3・AT-4）
    busy: uploads.some((u) => u.status !== 'ready'),
    readyCount: uploads.filter((u) => u.status === 'ready').length,
  }
}

export type Uploads = ReturnType<typeof useUploads>
