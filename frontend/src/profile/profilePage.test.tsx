import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MyProfile } from '../api'
import { M } from '../messages'
import { json, mockFetch, sentJson, type Handler } from '../test/fetchMock'
import { me, renderComponent } from '../test/render'
import ProfilePage from './ProfilePage'

// G-10 プロフィールの設定画面（PF-1〜PF-6、画面設計書 12 章）

// 絵文字の一覧（emoji-picker-element）は jsdom では動かないので、選ぶボタンだけの偽物にする
vi.mock('../components/EmojiPicker', () => ({
  default: ({ onSelect }: { onSelect: (emoji: string) => void }) => (
    <dialog open aria-label="絵文字の一覧">
      <button type="button" onClick={() => onSelect('👍️')}>👍</button>
    </dialog>
  ),
}))

const profile = (extra: Partial<MyProfile> = {}): MyProfile => ({
  ...me, statusExpiresAt: null, ...extra,
})

const saved = (extra: object = {}) => ({ ...me, ...extra })

function open(routes: Record<string, Handler | Handler[]> = {}, initial: MyProfile = profile()) {
  const fetch = mockFetch({ 'GET /api/me/profile': () => json(200, initial), ...routes })
  const signedIn = vi.fn()
  renderComponent(<ProfilePage />, { path: '/settings/profile', auth: { signedIn } })
  return { fetch, signedIn }
}

const nameInput = () => screen.getByRole('textbox', { name: '表示名' })
const textInput = () => screen.getByRole('textbox', { name: 'ステータス' })
const saveButton = () => screen.getByRole('button', { name: '保存する' })
const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]')!

const image = (name: string, type: string, size = 100) => new File([new Uint8Array(size)], name, { type })

beforeEach(() => {
  // jsdom には選んだ画像の見本の URL を作る機能がない
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('表示名とステータス', () => {
  it('何も変えていないときは「保存する」を押せない（PF-1）', async () => {
    open()
    await screen.findByRole('heading', { level: 1, name: 'プロフィールの設定' })
    expect(screen.getByText('@taro_y（変えられません）')).toBeInTheDocument()
    expect(nameInput()).toHaveValue('たろう')
    expect(saveButton()).toBeDisabled()
  })

  it('表示名とステータスを変えて保存すると、送って M-10 を出し、ヘッダーにも反映する（PF-1・PF-5）', async () => {
    const after = profile({ displayName: 'たろう2', statusEmoji: '👍', statusText: '休暇中' })
    const { fetch, signedIn } = open({
      'GET /api/me/profile': [() => json(200, profile()), () => json(200, after)],
      'PATCH /api/me/profile': () => json(200, saved({ displayName: 'たろう2', statusEmoji: '👍', statusText: '休暇中' })),
    })
    const user = userEvent.setup()
    await screen.findByRole('heading', { level: 1, name: 'プロフィールの設定' })

    await user.clear(nameInput())
    await user.type(nameInput(), ' たろう2 ')
    await user.click(screen.getByRole('button', { name: 'ステータスの絵文字を選ぶ' }))
    // 絵文字の一覧は初めて開くときに読み込むので、初回（変換のキャッシュがないとき）は時間がかかることがある
    await user.click(await screen.findByRole('button', { name: '👍' }, { timeout: 5000 }))
    await user.type(textInput(), '休暇中')
    await user.click(saveButton())

    expect(await screen.findByText(M[10])).toBeInTheDocument()
    // 表示名の前後の空白は取る。消す時刻は「消さない」なので送らない（null）
    expect(sentJson(fetch, fetch.keys().indexOf('PATCH /api/me/profile')))
      .toEqual({ displayName: 'たろう2', statusEmoji: '👍️', statusText: '休暇中' })
    expect(signedIn).toHaveBeenCalledWith(saved({ displayName: 'たろう2', statusEmoji: '👍', statusText: '休暇中' }))
    // 保存した値に入力欄を作り直すので、また押せなくなる
    expect(saveButton()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'ステータスの絵文字 👍（変える）' })).toBeInTheDocument()
  })

  it('表示名が空なら M-5 を出し、送らない（PF-4）', async () => {
    const { fetch } = open()
    const user = userEvent.setup()
    await screen.findByRole('heading', { level: 1, name: 'プロフィールの設定' })

    await user.clear(nameInput())
    await user.type(nameInput(), '   ')
    await user.click(saveButton())

    expect(screen.getByText(M[5])).toBeInTheDocument()
    expect(fetch.keys()).not.toContain('PATCH /api/me/profile')
  })

  // TC-02-4・TC-02-5
  it('表示名は 30 文字、ステータスの文は 100 文字までしか入らない', async () => {
    open()
    await screen.findByRole('heading', { level: 1, name: 'プロフィールの設定' })

    fireEvent.change(nameInput(), { target: { value: 'あ'.repeat(31) } })
    fireEvent.change(textInput(), { target: { value: '😀'.repeat(101) } })

    expect(nameInput()).toHaveValue('あ'.repeat(30))
    expect(textInput()).toHaveValue('😀'.repeat(100))
  })

  it('消す時刻を選ぶと、その日時を送る（PF-5）', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-14T01:00:00Z'), shouldAdvanceTime: true })
    const { fetch } = open({ 'PATCH /api/me/profile': () => json(200, saved()) })
    const user = userEvent.setup()
    await screen.findByRole('heading', { level: 1, name: 'プロフィールの設定' })

    await user.type(textInput(), '会議中')
    await user.selectOptions(screen.getByRole('combobox', { name: '消す時刻' }), '今日の終わり')
    await user.click(saveButton())

    await screen.findByText(M[10])
    expect(sentJson(fetch, fetch.keys().indexOf('PATCH /api/me/profile')))
      .toMatchObject({ statusText: '会議中', statusExpiresAt: '2026-11-14T14:59:00.000Z' })
  })

  it('消す時刻があれば「（時刻）まで（今のまま）」を選んでおき、そのまま送る', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-14T01:00:00Z'), shouldAdvanceTime: true })
    const { fetch } = open({ 'PATCH /api/me/profile': () => json(200, saved()) },
      profile({ statusEmoji: '🏖️', statusText: '休暇中', statusExpiresAt: '2026-11-15T03:00:00Z' }))
    const user = userEvent.setup()
    await screen.findByRole('heading', { level: 1, name: 'プロフィールの設定' })

    expect(screen.getByRole('combobox', { name: '消す時刻' })).toHaveDisplayValue('11月15日 12:00 まで（今のまま）')
    await user.type(nameInput(), '2')
    await user.click(saveButton())

    await screen.findByText(M[10])
    expect(sentJson(fetch, fetch.keys().indexOf('PATCH /api/me/profile'))).toEqual({
      displayName: 'たろう2', statusEmoji: '🏖️', statusText: '休暇中', statusExpiresAt: '2026-11-15T03:00:00Z',
    })
  })

  it('「ステータスを消す」で絵文字・文・消す時刻をなくす（PF-6）', async () => {
    const { fetch } = open({ 'PATCH /api/me/profile': () => json(200, saved()) },
      profile({ statusEmoji: '🏖️', statusText: '休暇中', statusExpiresAt: '2026-11-15T03:00:00Z' }))
    const user = userEvent.setup()
    await screen.findByRole('heading', { level: 1, name: 'プロフィールの設定' })

    await user.click(screen.getByRole('button', { name: 'ステータスを消す' }))

    expect(textInput()).toHaveValue('')
    expect(screen.getByRole('button', { name: 'ステータスを消す' })).toBeDisabled()
    await user.click(saveButton())
    await screen.findByText(M[10])
    expect(sentJson(fetch, fetch.keys().indexOf('PATCH /api/me/profile'))).toEqual({ displayName: 'たろう' })
  })
})

describe('アバター（PF-2・PF-3）', () => {
  // TC-02-1
  it('JPEG・PNG・WebP でない画像や 5MB を超える画像は M-9 を出し、選ばない', async () => {
    open()
    await screen.findByRole('heading', { level: 1, name: 'プロフィールの設定' })

    fireEvent.change(fileInput(), { target: { files: [image('a.gif', 'image/gif')] } })
    expect(screen.getByRole('alert')).toHaveTextContent(M[9])
    fireEvent.change(fileInput(), { target: { files: [image('a.png', 'image/png', 5 * 1024 * 1024 + 1)] } })
    expect(screen.getByRole('alert')).toHaveTextContent(M[9])
    expect(saveButton()).toBeDisabled()
  })

  it('選んだ画像を見本に出し、保存するとアバターだけを送る', async () => {
    const after = saved({ avatarUrl: 'https://s3.example/avatars/new.png' })
    const { fetch, signedIn } = open({
      'GET /api/me/profile': [() => json(200, profile()), () => json(200, profile({ avatarUrl: after.avatarUrl }))],
      'PUT /api/me/avatar': () => json(200, after),
    })
    const user = userEvent.setup()
    await screen.findByRole('heading', { level: 1, name: 'プロフィールの設定' })

    fireEvent.change(fileInput(), { target: { files: [image('a.png', 'image/png', 5 * 1024 * 1024)] } })
    expect(screen.getByRole('img', { name: 'たろうのアバター' })).toHaveAttribute('src', 'blob:preview')
    await user.click(saveButton())

    expect(await screen.findByText(M[10])).toBeInTheDocument()
    const sent = fetch.calls.find((c) => c.key === 'PUT /api/me/avatar')!.init!.body as FormData
    expect((sent.get('file') as File).name).toBe('a.png')
    expect(fetch.keys()).not.toContain('PATCH /api/me/profile')
    expect(signedIn).toHaveBeenCalledWith(after)
    expect(screen.getByRole('img', { name: 'たろうのアバター' })).toHaveAttribute('src', after.avatarUrl)
  })

  it('アバターと表示名を変えたら、アバター → 表示名の順に送る。表示名に失敗したら M-49 を出し、アバターは残す', async () => {
    const after = saved({ avatarUrl: 'https://s3.example/avatars/new.png' })
    const { fetch, signedIn } = open({
      'PUT /api/me/avatar': () => json(200, after),
      'PATCH /api/me/profile': () => json(500, { code: 'INTERNAL_ERROR', message: M[49] }),
    })
    const user = userEvent.setup()
    await screen.findByRole('heading', { level: 1, name: 'プロフィールの設定' })

    fireEvent.change(fileInput(), { target: { files: [image('a.webp', 'image/webp')] } })
    await user.type(nameInput(), '2')
    await user.click(saveButton())

    expect(await screen.findByText(M[49])).toBeInTheDocument()
    expect(fetch.keys().filter((k) => k !== 'GET /api/me/profile')).toEqual(['PUT /api/me/avatar', 'PATCH /api/me/profile'])
    expect(signedIn).toHaveBeenCalledWith(after)
    // アバターは保存できたので、見本は保存したものに替わり、表示名はもう一度送れる
    expect(screen.getByRole('img', { name: 'たろう2のアバター' })).toHaveAttribute('src', after.avatarUrl)
    expect(saveButton()).toBeEnabled()
  })

  it('API が画像を読めなければ M-9 を出す', async () => {
    open({ 'PUT /api/me/avatar': () => json(400, { code: 'AVATAR_INVALID', message: M[9], field: 'file' }) })
    const user = userEvent.setup()
    await screen.findByRole('heading', { level: 1, name: 'プロフィールの設定' })

    fireEvent.change(fileInput(), { target: { files: [image('a.png', 'image/png')] } })
    await user.click(saveButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(M[9])
  })

  // TC-02-3
  it('「アバターを外す」で頭文字の丸にし、保存すると外す', async () => {
    const { fetch } = open({ 'DELETE /api/me/avatar': () => json(200, saved()) },
      profile({ avatarUrl: 'https://s3.example/avatars/old.png' }))
    const user = userEvent.setup()
    await screen.findByRole('heading', { level: 1, name: 'プロフィールの設定' })

    await user.click(screen.getByRole('button', { name: 'アバターを外す' }))

    expect(screen.queryByRole('img', { name: 'たろうのアバター' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'アバターを外す' })).not.toBeInTheDocument()
    await user.click(saveButton())
    await screen.findByText(M[10])
    expect(fetch.keys()).toContain('DELETE /api/me/avatar')
  })
})

it('読み込めなければ M-48 と「再読み込み」を出す', async () => {
  open({ 'GET /api/me/profile': [() => json(500, {}), () => json(200, profile())] })
  const user = userEvent.setup()

  await user.click(await screen.findByRole('button', { name: '再読み込み' }))

  expect(await screen.findByRole('heading', { level: 1, name: 'プロフィールの設定' })).toBeInTheDocument()
})

it('「キャンセル」で、入力を捨てて前の画面に戻る（直接開いたときは G-3）', async () => {
  open()
  const user = userEvent.setup()
  await screen.findByRole('heading', { level: 1, name: 'プロフィールの設定' })

  await user.click(screen.getByRole('button', { name: 'キャンセル' }))

  expect(screen.getByRole('status', { name: '今の URL' })).toHaveTextContent(/^\/$/)
})
