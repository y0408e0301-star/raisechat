import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AttachmentView, MessageView } from '../api'
import { M } from '../messages'
import { json, mockFetch, sentJson, type Handler } from '../test/fetchMock'
import { me } from '../test/render'
import { opened, renderAt } from '../test/workspace'
import { checkFiles } from './uploads'

// 画像・動画の添付（FN-09）の画面：入力欄の添付（AT-1〜AT-4）、メッセージの添付（AT-5〜AT-8）、G-17、編集で外す（AT-9）、
// URL の期限切れ（AT-10）

// S3 への PUT（XMLHttpRequest）の偽物。送ったものを覚え、テストから成功・失敗・進み具合を起こす
class FakeXhr {
  static all: FakeXhr[] = []
  method = ''
  url = ''
  headers: Record<string, string> = {}
  body: unknown = null
  status = 0
  private listeners = new Map<string, () => void>()
  private uploadListeners = new Map<string, (e: ProgressEvent) => void>()
  upload = {
    addEventListener: (type: string, listener: (e: ProgressEvent) => void) => this.uploadListeners.set(type, listener),
  }

  constructor() {
    FakeXhr.all.push(this)
  }

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }

  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, listener)
  }

  send(body: unknown) {
    this.body = body
  }

  abort() {
    this.listeners.get('abort')?.()
  }

  progress(loaded: number, total: number) {
    this.uploadListeners.get('progress')?.({ lengthComputable: true, loaded, total } as ProgressEvent)
  }

  succeed() {
    this.status = 200
    this.listeners.get('load')?.()
  }

  fail() {
    this.listeners.get('error')?.()
  }

  static latest(): FakeXhr {
    const xhr = FakeXhr.all.at(-1)
    if (!xhr) throw new Error('PUT していません')
    return xhr
  }
}

const attachment = (id: number, extra: Partial<AttachmentView> = {}): AttachmentView => ({
  id, kind: 'IMAGE', contentType: 'image/png', fileName: `${id}.png`, size: 2048, width: 1600, height: 1200,
  url: `https://s3.example/${id}.png?sig=1`, thumbnailUrl: `https://s3.example/${id}-thumb.png?sig=1`,
  downloadUrl: `https://s3.example/${id}.png?download=1`, expiresAt: '2026-11-14T10:00:00Z', ...extra,
})

const message = (id: number, attachments: AttachmentView[], extra: Partial<MessageView> = {}): MessageView => ({
  id, conversationId: 10, parentId: null, author: me, body: '', attachments, reactions: [], replyCount: 0, lastReplyAt: null, replyUsers: [],
  createdAt: '2026-11-11T01:00:00Z', editedAt: null, deleted: false, mine: true, canDelete: true, ...extra,
})

const page = (items: MessageView[]) => () => json(200, { items, hasMoreBefore: false, hasMoreAfter: false })

const ticket = (uploadId: number) => json(201, {
  uploadId, putUrl: `https://s3.example/put/${uploadId}`, headers: { 'Content-Type': 'image/png' },
  expiresAt: '2026-11-14T10:00:00Z',
})

// 後から応答を返す（受け付けを待つ間の操作を確かめる）
function deferred<T>() {
  let resolve: ((value: T) => void) | undefined
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve: (value: T) => resolve?.(value) }
}

const png = (name = 'photo.png', size = 100) => new File([new Uint8Array(size)], name, { type: 'image/png' })

function open(routes: Record<string, Handler | Handler[]> = {}) {
  const fetch = mockFetch({ ...opened, ...routes })
  renderAt('/w/3/c/10')
  return fetch
}

const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]')!
const sendButton = () => screen.getByRole('button', { name: '送信 ➤' })
const previews = () => screen.getByRole('list', { name: '添付' })

beforeEach(() => {
  FakeXhr.all = []
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

describe('添付するファイルの確かめ（AT-2）', () => {
  it('形式・大きさが合わないものは M-39、5 個目以降は M-38 で、どちらも添付しない', () => {
    const pdf = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    const svg = new File(['x'], 'a.svg', { type: 'image/svg+xml' })
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' })
    expect(checkFiles(0, [pdf, png()])).toEqual({ accepted: [expect.any(File)], message: M[39] })
    expect(checkFiles(0, [svg]).message).toBe(M[39])
    expect(checkFiles(0, [big]).message).toBe(M[39])
    const video = new File([new Uint8Array(10)], 'a.mp4', { type: 'video/mp4' })
    expect(checkFiles(0, [video]).accepted).toHaveLength(1)
    const result = checkFiles(2, [png('1.png'), png('2.png'), png('3.png')])
    expect(result.accepted.map((f) => f.name)).toEqual(['1.png', '2.png'])
    expect(result.message).toBe(M[38])
  })
})

describe('入力欄の添付（AT-1・AT-3・AT-4）', () => {
  it('選ぶとすぐにアップロードし、終わるまで送れない。終わったら添付を付けて送る', async () => {
    const fetch = open({
      'POST /api/conversations/10/uploads': () => ticket(77),
      'POST /api/uploads/77/complete': () => json(200, attachment(77)),
      'POST /api/conversations/10/messages': () => json(201, message(5, [attachment(77)])),
    })
    const user = userEvent.setup()
    await screen.findByRole('textbox', { name: 'メッセージ' })

    fireEvent.change(fileInput(), { target: { files: [png()] } })

    await waitFor(() => expect(FakeXhr.all).toHaveLength(1))
    const xhr = FakeXhr.latest()
    expect(xhr.method).toBe('PUT')
    expect(xhr.url).toBe('https://s3.example/put/77')
    expect(xhr.headers).toEqual({ 'Content-Type': 'image/png' })
    expect(sentJson(fetch, fetch.keys().indexOf('POST /api/conversations/10/uploads')))
      .toEqual({ fileName: 'photo.png', contentType: 'image/png', size: 100 })
    act(() => xhr.progress(80, 100))
    expect(within(previews()).getByText('80%')).toBeInTheDocument()
    expect(sendButton()).toBeDisabled()

    act(() => xhr.succeed())

    await waitFor(() => expect(sendButton()).toBeEnabled())
    // 本文がなくても、添付があれば送れる
    await user.click(sendButton())
    expect(await screen.findByRole('button', { name: '77.pngを大きく見る' })).toBeInTheDocument()
    expect(sentJson(fetch, fetch.keys().indexOf('POST /api/conversations/10/messages')))
      .toMatchObject({ body: '', attachmentIds: [77] })
    expect(screen.queryByRole('list', { name: '添付' })).not.toBeInTheDocument()
  })

  // TC-09-4
  it('アップロードに失敗したら M-40 と「もう一度」を出し、もう一度は受け付けからやり直す', async () => {
    const fetch = open({
      'POST /api/conversations/10/uploads': [() => ticket(77), () => ticket(78)],
      'DELETE /api/uploads/77': () => json(204),
      'POST /api/uploads/78/complete': () => json(200, attachment(78)),
    })
    const user = userEvent.setup()
    await screen.findByRole('textbox', { name: 'メッセージ' })
    fireEvent.change(fileInput(), { target: { files: [png()] } })
    await waitFor(() => expect(FakeXhr.all).toHaveLength(1))

    act(() => FakeXhr.latest().fail())

    expect(await screen.findByText(M[40])).toBeInTheDocument()
    expect(sendButton()).toBeDisabled()
    await user.click(within(previews()).getByRole('button', { name: 'もう一度' }))
    await waitFor(() => expect(FakeXhr.all).toHaveLength(2))
    act(() => FakeXhr.latest().succeed())
    await waitFor(() => expect(fetch.keys()).toContain('POST /api/uploads/78/complete'))
    // 前に受け付けてもらったものは外してもらう
    expect(fetch.keys()).toContain('DELETE /api/uploads/77')
  })

  it('受け付けを待つ間に「×」で外したら、受け付けられた後で外してもらう', async () => {
    const accepted = deferred<Response>()
    const fetch = open({
      'POST /api/conversations/10/uploads': () => accepted.promise,
      'DELETE /api/uploads/77': () => json(204),
    })
    const user = userEvent.setup()
    await screen.findByRole('textbox', { name: 'メッセージ' })
    fireEvent.change(fileInput(), { target: { files: [png()] } })
    await waitFor(() => expect(fetch.keys()).toContain('POST /api/conversations/10/uploads'))

    await user.click(within(previews()).getByRole('button', { name: 'photo.pngを外す' }))
    await act(async () => accepted.resolve(ticket(77)))

    await waitFor(() => expect(fetch.keys()).toContain('DELETE /api/uploads/77'))
    expect(FakeXhr.all).toHaveLength(0)
  })

  it('描き直す前に続けて足しても 4 個までにする', async () => {
    open({ 'POST /api/conversations/10/uploads': () => new Promise<Response>(() => {}) })
    const textbox = await screen.findByRole('textbox', { name: 'メッセージ' })

    act(() => {
      fireEvent.paste(textbox, { clipboardData: { files: [png('1.png'), png('2.png'), png('3.png')] } })
      fireEvent.paste(textbox, { clipboardData: { files: [png('4.png'), png('5.png')] } })
    })

    expect(within(previews()).getAllByRole('listitem')).toHaveLength(4)
    expect(screen.getByText(M[38])).toBeInTheDocument()
  })

  // TC-09-12
  it('「×」で外すと、API に外してもらう', async () => {
    const fetch = open({
      'POST /api/conversations/10/uploads': () => ticket(77),
      'POST /api/uploads/77/complete': () => json(200, attachment(77)),
      'DELETE /api/uploads/77': () => json(204),
    })
    const user = userEvent.setup()
    await screen.findByRole('textbox', { name: 'メッセージ' })
    fireEvent.change(fileInput(), { target: { files: [png()] } })
    await waitFor(() => expect(FakeXhr.all).toHaveLength(1))
    act(() => FakeXhr.latest().succeed())
    await waitFor(() => expect(fetch.keys()).toContain('POST /api/uploads/77/complete'))

    await user.click(within(previews()).getByRole('button', { name: 'photo.pngを外す' }))

    expect(screen.queryByRole('list', { name: '添付' })).not.toBeInTheDocument()
    await waitFor(() => expect(fetch.keys()).toContain('DELETE /api/uploads/77'))
    expect(sendButton()).toBeDisabled()
  })

  // TC-09-3
  it('5 個目は M-38 を出して添付しない', async () => {
    open({ 'POST /api/conversations/10/uploads': () => new Promise<Response>(() => {}) })
    await screen.findByRole('textbox', { name: 'メッセージ' })

    fireEvent.change(fileInput(), { target: { files: ['1', '2', '3', '4', '5'].map((n) => png(`${n}.png`)) } })

    expect(await screen.findByText(M[38])).toBeInTheDocument()
    expect(within(previews()).getAllByRole('listitem')).toHaveLength(4)
  })

  // TC-09-1
  it('添付できないファイルは M-39 を出して添付しない', async () => {
    open()
    await screen.findByRole('textbox', { name: 'メッセージ' })
    fireEvent.change(fileInput(), { target: { files: [new File(['x'], 'a.heic', { type: 'image/heic' })] } })
    expect(await screen.findByText(M[39])).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '添付' })).not.toBeInTheDocument()
  })

  // TC-09-5
  it('貼り付けとドラッグ＆ドロップでも添付できる', async () => {
    open({ 'POST /api/conversations/10/uploads': () => new Promise<Response>(() => {}) })
    const textbox = await screen.findByRole('textbox', { name: 'メッセージ' })

    fireEvent.paste(textbox, { clipboardData: { files: [png('pasted.png')] } })
    expect(within(previews()).getByRole('img', { name: 'pasted.png' })).toBeInTheDocument()

    // 会話とスレッドのパネルを並べる枠の中の、会話の画面
    const area = textbox.closest('main')!.firstElementChild!.firstElementChild!
    fireEvent.dragOver(area, { dataTransfer: { types: ['Files'], files: [] } })
    expect(screen.getByText('ドロップして添付')).toBeInTheDocument()
    fireEvent.drop(area, { dataTransfer: { types: ['Files'], files: [png('dropped.png')] } })
    expect(screen.queryByText('ドロップして添付')).not.toBeInTheDocument()
    expect(within(previews()).getByRole('img', { name: 'dropped.png' })).toBeInTheDocument()
  })

  it('画面の確かめをすり抜けた形式の違いは M-39 を出して外す', async () => {
    open({
      'POST /api/conversations/10/uploads': () => ticket(77),
      'POST /api/uploads/77/complete': () => json(400, { code: 'ATTACHMENT_TYPE_INVALID', message: M[39] }),
    })
    await screen.findByRole('textbox', { name: 'メッセージ' })
    fireEvent.change(fileInput(), { target: { files: [png()] } })
    await waitFor(() => expect(FakeXhr.all).toHaveLength(1))

    act(() => FakeXhr.latest().succeed())

    expect(await screen.findByText(M[39])).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '添付' })).not.toBeInTheDocument()
  })
})

describe('メッセージの添付（AT-5〜AT-8）と G-17', () => {
  it('画像 1 つは縮小した画像を幅・高さの分の場所を取って出す', async () => {
    open({ 'GET /api/conversations/10/messages': page([message(1, [attachment(77)])]) })

    const img = await screen.findByRole('img', { name: '77.png' })

    expect(img).toHaveAttribute('src', 'https://s3.example/77-thumb.png?sig=1')
    // 1600×1200 を 360px に収める（AT-8）
    expect(img.closest('button')).toHaveStyle({ width: '360px', aspectRatio: '1600 / 1200' })
  })

  // TC-09-6
  it('画像を押すと G-17 に元の画像を出し、左右で移れて、Esc で閉じる', async () => {
    open({
      'GET /api/conversations/10/messages': page([message(1, [attachment(77), attachment(78), attachment(79)])]),
    })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: '78.pngを大きく見る' }))

    const viewer = screen.getByRole('dialog', { name: '78.png' })
    expect(within(viewer).getByRole('img', { name: '78.png' })).toHaveAttribute('src', 'https://s3.example/78.png?sig=1')
    expect(within(viewer).getByText('2/3')).toBeInTheDocument()
    expect(within(viewer).getByRole('link', { name: 'ダウンロード' }))
      .toHaveAttribute('href', 'https://s3.example/78.png?download=1')
    await user.click(within(viewer).getByRole('button', { name: '次の画像' }))
    expect(screen.getByRole('dialog', { name: '79.png' })).toBeInTheDocument()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('dialog', { name: '77.png' })).toBeInTheDocument()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('dialog', { name: '79.png' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '78.pngを大きく見る' })).toHaveFocus()
  })

  it('動画は再生の部品とファイル名・大きさ・「ダウンロード」を出す。再生できない形式は M-41', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockImplementation((type) => (type === 'video/mp4' ? 'maybe' : ''))
    const mp4 = attachment(80, { kind: 'VIDEO', contentType: 'video/mp4', fileName: 'movie.mp4', size: 86_400_000,
      width: null, height: null, thumbnailUrl: null, url: 'https://s3.example/80.mp4' })
    const webm = attachment(81, { kind: 'VIDEO', contentType: 'video/webm', fileName: 'clip.webm', size: 1000,
      width: null, height: null, thumbnailUrl: null })
    open({ 'GET /api/conversations/10/messages': page([message(1, [mp4, webm])]) })

    expect(await screen.findByText('movie.mp4 · 82.4MB')).toBeInTheDocument()
    const video = document.querySelector('video')!
    expect(video).toHaveAttribute('src', 'https://s3.example/80.mp4')
    expect(video).toHaveAttribute('controls')
    expect(video).not.toHaveAttribute('autoplay')
    expect(screen.getByText(M[41])).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'ダウンロード' })).toHaveLength(2)
  })

  // TC-09-10（AT-10）
  it('画像を表示できなければメッセージを 1 回だけ読み直して新しい URL に替える', async () => {
    const fetch = open({
      'GET /api/conversations/10/messages': page([message(1, [attachment(77)])]),
      'GET /api/messages/1': () => json(200, message(1, [attachment(77, { thumbnailUrl: 'https://s3.example/new' })])),
    })
    const img = await screen.findByRole('img', { name: '77.png' })

    fireEvent.error(img)

    await waitFor(() => expect(screen.getByRole('img', { name: '77.png' })).toHaveAttribute('src', 'https://s3.example/new'))
    fireEvent.error(screen.getByRole('img', { name: '77.png' }))
    expect(fetch.keys().filter((k) => k === 'GET /api/messages/1')).toHaveLength(1)
  })

  // TC-09-11（AT-9）
  it('編集で「×」を押した添付を外して保存する', async () => {
    const fetch = open({
      'GET /api/conversations/10/messages': page([message(1, [attachment(77), attachment(78)], { body: '写真' })]),
      'PATCH /api/messages/1': () => json(200, message(1, [attachment(78)], { body: '写真', editedAt: '2026-11-11T02:00:00Z' })),
    })
    const user = userEvent.setup()
    await screen.findByText('写真')

    await user.click(screen.getByRole('button', { name: '編集' }))
    await user.click(screen.getByRole('button', { name: '77.pngを外す' }))
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('（編集済み）')).toBeInTheDocument()
    expect(sentJson(fetch, fetch.keys().indexOf('PATCH /api/messages/1'))).toEqual({ body: '写真', keepAttachmentIds: [78] })
    expect(screen.queryByRole('button', { name: '77.pngを大きく見る' })).not.toBeInTheDocument()
  })

  it('本文が空なら、添付をすべて外すと保存できない', async () => {
    open({ 'GET /api/conversations/10/messages': page([message(1, [attachment(77)])]) })
    const user = userEvent.setup()
    await screen.findByRole('img', { name: '77.png' })

    await user.click(screen.getByRole('button', { name: '編集' }))
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '77.pngを外す' }))

    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })
})
