import { Suspense, lazy, useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { ApiError, changeAvatar, fetchMyProfile, removeAvatar, updateProfile, type Me, type MyProfile } from '../api'
import { useAuth } from '../auth/AuthContext'
import Avatar from '../components/Avatar'
import { useToast } from '../components/ToastContext'
import ui from '../components/ui.module.css'
import { formatUntil } from '../dates'
import { M } from '../messages'
import { DISPLAY_NAME_MAX, STATUS_TEXT_MAX, isValidDisplayName, limitChars } from '../validation'
import styles from './ProfilePage.module.css'
import { EXPIRY_LABELS, expiresAt, type Expiry } from './status'

// 絵文字の一覧（emoji-picker-element）は大きいので、初めて開くときに読み込む
const EmojiPicker = lazy(() => import('../components/EmojiPicker'))

// アバターに使える画像（FN-02 4 章）。形式は画面ではファイルの種類で確かめ、中身は API が確かめる
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const AVATAR_MAX_BYTES = 5 * 1024 * 1024

// アバターをどうするか。new は選んだ画像（見本の URL つき）、remove は外す
type AvatarChange = { kind: 'keep' } | { kind: 'new', file: File, preview: string } | { kind: 'remove' }

// 入力欄の値。G-10 を開いたとき・保存したときの値と比べて、変えたかを決める
type Form = { displayName: string, statusEmoji: string, statusText: string, expiry: Expiry }

function formOf(profile: MyProfile): Form {
  return {
    displayName: profile.displayName,
    statusEmoji: profile.statusEmoji ?? '',
    statusText: profile.statusText ?? '',
    expiry: profile.statusExpiresAt ? 'keep' : 'never',
  }
}

function sameForm(a: Form, b: Form): boolean {
  return a.displayName === b.displayName && a.statusEmoji === b.statusEmoji && a.statusText === b.statusText
    && a.expiry === b.expiry
}

// G-10 プロフィールの設定画面（PF-1〜PF-6、画面設計書 12 章）。
// アバターは表示名・ステータスと別の API で、アバター → 表示名・ステータスの順に送る。
// どちらかに失敗したら M-49 を出し、成功した分はそのまま残す（FN-02 3.1）。
// ブラウザの通知の設定は通知（開発計画書 1-15）で足す
export default function ProfilePage() {
  // undefined：読み込み中、null：読み込みに失敗
  const [profile, setProfile] = useState<MyProfile | null | undefined>(undefined)
  // 保存し終えたら、入力欄を保存した値で作り直す
  const [saves, setSaves] = useState(0)

  const load = useCallback(async () => {
    setProfile(undefined)
    setProfile(await fetchMyProfile().catch(() => null))
  }, [])

  useEffect(() => {
    let active = true
    fetchMyProfile().then((loaded) => active && setProfile(loaded), () => active && setProfile(null))
    return () => {
      active = false
    }
  }, [])

  if (profile === null) {
    return (
      <div className={ui.empty}>
        <p>{M[48]}</p>
        <button type="button" className={ui.secondary} onClick={load}>再読み込み</button>
      </div>
    )
  }
  if (profile === undefined) return null
  return (
    <ProfileForm key={saves} profile={profile}
      onAvatarSaved={(avatarUrl) => setProfile({ ...profile, avatarUrl })}
      onSaved={(next) => {
        setProfile(next)
        setSaves((n) => n + 1)
      }} />
  )
}

type FormProps = {
  profile: MyProfile
  // アバターだけ保存できた（表示名・ステータスの保存に失敗しても、アバターは残す）
  onAvatarSaved: (avatarUrl: string | null) => void
  // 全部保存できた。保存した後のプロフィール
  onSaved: (profile: MyProfile) => void
}

function ProfileForm({ profile, onAvatarSaved, onSaved }: FormProps) {
  const { signedIn } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const nameId = useId()
  const textId = useId()
  const expiryId = useId()
  const [form, setForm] = useState<Form>(() => formOf(profile))
  const [avatar, setAvatar] = useState<AvatarChange>({ kind: 'keep' })
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // 選んだ画像の見本の URL は、替えたとき・画面を離れたときに捨てる
  useEffect(() => {
    if (avatar.kind !== 'new') return
    return () => URL.revokeObjectURL(avatar.preview)
  }, [avatar])

  // 「←」「キャンセル」：前の画面に戻る。この画面を直接開いたときは G-3 へ
  function back() {
    if ((window.history.state as { idx?: number } | null)?.idx) navigate(-1)
    else navigate('/')
  }

  const initial = formOf(profile)
  const changed = avatar.kind !== 'keep' || !sameForm(form, initial)
  const hasStatus = form.statusEmoji !== '' || form.statusText.trim() !== ''
  const shownAvatarUrl = avatar.kind === 'new' ? avatar.preview : avatar.kind === 'remove' ? null : profile.avatarUrl

  function change(next: Partial<Form>) {
    setForm((current) => ({ ...current, ...next }))
  }

  // 画像を選んだ（PF-2）。条件に合わなければ M-9 を出し、選ばなかったことにする
  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // 同じファイルをもう一度選べるよう、選んだものを空にする
    e.target.value = ''
    if (!file) return
    if (!AVATAR_TYPES.includes(file.type) || file.size > AVATAR_MAX_BYTES) {
      setAvatarError(M[9])
      return
    }
    setAvatarError(null)
    setAvatar({ kind: 'new', file, preview: URL.createObjectURL(file) })
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (saving || !changed) return
    const displayName = form.displayName.trim()
    if (!isValidDisplayName(displayName)) {
      setNameError(M[5])
      return
    }
    setNameError(null)
    setSaving(true)
    let saved: Me | null = null
    try {
      if (avatar.kind === 'new') saved = await changeAvatar(avatar.file)
      else if (avatar.kind === 'remove') saved = await removeAvatar()
      if (saved) {
        onAvatarSaved(saved.avatarUrl ?? null)
        setAvatar({ kind: 'keep' })
      }
      if (!sameForm(form, initial)) {
        const now = new Date()
        const until = expiresAt(form.expiry, profile.statusExpiresAt ?? null, now)
        // 開いていた間に、今のままの消す時刻を過ぎた。ステータスはもう出ていないので消す
        const expired = form.expiry === 'keep' && until !== null && new Date(until) <= now
        saved = await updateProfile({
          displayName,
          statusEmoji: expired ? undefined : form.statusEmoji || undefined,
          statusText: expired ? undefined : form.statusText.trim() || undefined,
          statusExpiresAt: expired ? undefined : until ?? undefined,
        })
      }
      toast(M[10])
      // 消す時刻を入力欄に出し直すため、保存した後のプロフィールを読み直す
      const reloaded = await fetchMyProfile().catch(() => null)
      if (reloaded) onSaved(reloaded)
    } catch (err) {
      const error = err instanceof ApiError ? err : null
      if (error?.code === 'AVATAR_INVALID' || error?.code === 'AVATAR_TOO_LARGE') setAvatarError(error.message)
      else if (error?.code === 'DISPLAY_NAME_REQUIRED') setNameError(error.message)
      else toast(error?.message ?? M[49])
    } finally {
      // ヘッダーの自分のアバター・表示名にも反映する
      if (saved) signedIn(saved)
      setSaving(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <button type="button" className={styles.back} onClick={back} aria-label="戻る">←</button>
        <h1 className={styles.title}>プロフィールの設定</h1>
      </div>
      <form onSubmit={handleSubmit} noValidate>
        <div className={styles.avatarRow}>
          <Avatar displayName={form.displayName || profile.displayName} avatarUrl={shownAvatarUrl} size={128} />
          <div>
            <div className={styles.buttons}>
              <button type="button" className={ui.secondary} onClick={() => fileInput.current?.click()}>画像を選ぶ</button>
              {shownAvatarUrl && (
                <button type="button" className={ui.secondary}
                  onClick={() => { setAvatarError(null); setAvatar({ kind: 'remove' }) }}>
                  アバターを外す
                </button>
              )}
            </div>
            <p className={styles.hint}>JPEG・PNG・WebP、5MB まで</p>
            {avatarError && <p className={styles.error} role="alert">{avatarError}</p>}
            <input ref={fileInput} type="file" accept={AVATAR_TYPES.join(',')} className={styles.file}
              onChange={handleFile} tabIndex={-1} aria-hidden="true" />
          </div>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>ユーザー ID</span>
          <span className={styles.sub}>@{profile.username}（変えられません）</span>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={nameId}>表示名</label>
          <input id={nameId} className={`${styles.input} ${nameError ? styles.invalid : ''}`} value={form.displayName}
            onChange={(e) => change({ displayName: limitChars(e.target.value, DISPLAY_NAME_MAX) })}
            aria-invalid={nameError ? true : undefined} aria-describedby={nameError ? `${nameId}-error` : undefined} />
          {nameError && <p className={styles.error} id={`${nameId}-error`}>{nameError}</p>}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={textId}>ステータス</label>
          <div className={styles.status}>
            <button type="button" className={styles.emoji}
              aria-label={form.statusEmoji ? `ステータスの絵文字 ${form.statusEmoji}（変える）` : 'ステータスの絵文字を選ぶ'}
              onClick={(e) => setPickerAnchor(e.currentTarget)}>
              {form.statusEmoji || <span className={styles.placeholder} aria-hidden="true">😀</span>}
            </button>
            <input id={textId} className={styles.input} value={form.statusText} placeholder="いまどうしているか"
              onChange={(e) => change({ statusText: limitChars(e.target.value, STATUS_TEXT_MAX) })} />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={expiryId}>消す時刻</label>
          <div className={styles.status}>
            <select id={expiryId} className={styles.select} value={form.expiry}
              onChange={(e) => change({ expiry: e.target.value as Expiry })}>
              {profile.statusExpiresAt && (
                <option value="keep">{formatUntil(profile.statusExpiresAt)} まで（今のまま）</option>
              )}
              {Object.entries(EXPIRY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <button type="button" className={ui.secondary} disabled={!hasStatus}
              onClick={() => change({ statusEmoji: '', statusText: '', expiry: 'never' })}>
              ステータスを消す
            </button>
          </div>
        </div>

        <div className={styles.actions}>
          <button type="button" className={ui.secondary} onClick={back}>キャンセル</button>
          <button type="submit" className={ui.primary} disabled={!changed || saving}>
            {saving ? '保存中…' : '保存する'}
          </button>
        </div>
      </form>
      {pickerAnchor && (
        <Suspense fallback={null}>
          <EmojiPicker anchor={pickerAnchor} onClose={() => setPickerAnchor(null)}
            onSelect={(emoji) => { change({ statusEmoji: emoji }); setPickerAnchor(null) }} />
        </Suspense>
      )}
    </div>
  )
}
