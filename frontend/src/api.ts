import type { components } from './api-schema'
import { M } from './messages'

// API が返す形・受け取る形は、API の仕様書（docs/api/openapi.yaml）から作った api-schema.d.ts の型を使う。
// API を変えたら、backend の mvnw verify で仕様書を書き直し、npm run gen:api で型を作り直す（README）
type Schemas = components['schemas']

// ユーザー（機能定義書 3.5）。ログインしている自分（GET /api/auth/me などが返す）もこの形
export type UserSummary = Schemas['UserSummary']
export type Me = UserSummary

export type WorkspaceSummary = Schemas['WorkspaceSummary']
export type WorkspaceDetail = Schemas['WorkspaceDetail']
export type ConversationSummary = Schemas['ConversationSummary']
export type ConversationDetail = Schemas['ConversationDetail']
export type MessageView = Schemas['MessageView']
export type MessagePage = Schemas['MessagePage']
export type ChannelListItem = Schemas['ChannelListItem']
export type ChannelPage = Schemas['ChannelPage']
export type MemberPage = Schemas['MemberPage']
export type Visibility = ChannelListItem['visibility']
export type InviteView = Schemas['InviteView']
export type MemberView = Schemas['MemberView']
export type WorkspaceMemberPage = Schemas['WorkspaceMemberPage']
export type InvitePage = Schemas['InvitePage']
export type InvitePreview = Schemas['InvitePreview']
export type MyProfile = Schemas['MyProfile']

// API がエラーを返したとき（機能定義書 3.3）。message は画面にそのまま出せる文、
// field があればその入力欄の下に出す
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly field: string | null

  constructor(status: number, code: string, message: string, field: string | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.field = field
  }
}

// 200 番台以外なら ApiError にする。本文が API のエラーの形でなければ（API サーバーが止まっているなど）M-49 を出す
export async function ensureOk(res: Response): Promise<Response> {
  if (res.ok) return res
  let body: { code?: unknown, message?: unknown, field?: unknown } = {}
  try {
    body = await res.json()
  } catch {
    // 本文が JSON でない
  }
  const code = typeof body.code === 'string' ? body.code : 'UNKNOWN'
  const message = typeof body.message === 'string' && body.message ? body.message : M[49]
  throw new ApiError(res.status, code, message, typeof body.field === 'string' ? body.field : null)
}

// ---------------------------------------------------------------- JWT の取り直し（機能定義書 FN-01 3.3）

let onSessionExpired: () => void = () => {}

// 取り直しに失敗したとき（14 日たった・ログアウトした）に呼ぶ処理を決める。画面は M-8 を出して G-1 に移す
export function setSessionExpiredHandler(handler: () => void): void {
  onSessionExpired = handler
}

let refreshing: Promise<boolean> | null = null

// 取り直しを終えた回数（成功・失敗の両方）と、最後の取り直しの結果。
// API を送ったときの回数と比べて、送った後にほかの API の 401 で取り直しが済んでいたかを知る
let refreshCount = 0
let lastRefreshOk = false

// M-8 を出す処理を最後に呼んだときの refreshCount。1 回の失敗につき 1 回だけ呼ぶ
let notifiedAt = -1

// 同時に複数の API が 401 になっても、取り直しは 1 回だけにする。
// 2 回送ると、2 回目は無効にしたリフレッシュトークンを使ったことになり、全部のログインが切れるため（FN-01 5 章の 5）
function refreshOnce(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', headers: csrfHeader() })
    .then((res) => res.ok, () => false)
    .then((ok) => {
      refreshCount++
      lastRefreshOk = ok
      return ok
    })
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

// 取り直しを試さない API。ログイン・登録の 401 はパスワードの間違いなどで、取り直しでは直らない
const NO_REFRESH = ['/api/auth/login', '/api/auth/signup', '/api/auth/refresh']

// ---------------------------------------------------------------- 呼び出し

// Cookie の XSRF-TOKEN を X-XSRF-TOKEN ヘッダーで送り返す（CSRF 対策。機能定義書 3.2）
function csrfHeader(): Record<string, string> {
  const token = document.cookie
    .split('; ')
    .find((c) => c.startsWith('XSRF-TOKEN='))
    ?.slice('XSRF-TOKEN='.length)
  return token ? { 'X-XSRF-TOKEN': decodeURIComponent(token) } : {}
}

// body があれば JSON で送る。FormData（アバター。FN-02）なら multipart で送る（Content-Type はブラウザが境界の文字列と一緒に付ける）。
// 添付のファイルは API を通さず、ブラウザから S3 へ直接送る（機能定義書 FN-09）
async function call(method: string, url: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = method === 'GET' ? {} : csrfHeader()
  const form = body instanceof FormData
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json'
  try {
    return await fetch(url, { method, headers, body: body === undefined ? undefined : form ? body : JSON.stringify(body) })
  } catch {
    // つながらない
    throw new ApiError(0, 'NETWORK_ERROR', M[49])
  }
}

// API を呼ぶ。ログインの 401 のときは JWT を取り直して 1 回だけやり直す。
// access_token の Cookie は JWT と同じ 15 分で消えるので、期限切れでも TOKEN_EXPIRED ではなく
// UNAUTHENTICATED（Cookie がない）が返ることがある。そのため 401 ならどちらでも取り直しを試す（FN-01 3.3）。
// notifyExpired が false なら、取り直しに失敗しても M-8 を出さない
async function request(method: string, url: string, body?: unknown, notifyExpired = true): Promise<Response> {
  const sentAt = refreshCount
  const res = await call(method, url, body)
  if (res.status !== 401 || NO_REFRESH.includes(url)) return ensureOk(res)
  // 送った後に、ほかの API の 401 で取り直しが済んでいたら、取り直さずにその結果を使う。
  // 失敗していたときにもう一度取り直すと、無駄な取り直しと 2 回目の M-8 になるため
  const ok = refreshCount === sentAt ? await refreshOnce() : lastRefreshOk
  if (!ok) {
    if (notifyExpired && notifiedAt !== refreshCount) {
      notifiedAt = refreshCount
      onSessionExpired()
    }
    return ensureOk(res)
  }
  return ensureOk(await call(method, url, body))
}

async function requestJson<T>(method: string, url: string, body?: unknown, notifyExpired = true): Promise<T> {
  const res = await request(method, url, body, notifyExpired)
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------- FN-01 ユーザー登録・ログイン

// ログインしている自分。ログインしていなければ（取り直しにも失敗したら）null
// 画面を開いたときに呼ぶ。もともとログインしていない人もいるので M-8 は出さない（FN-01 6 章）
export async function fetchMe(): Promise<Me | null> {
  try {
    return await requestJson<Me>('GET', '/api/auth/me', undefined, false)
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null
    throw e
  }
}

// WebSocket をつなぎ直す前に、ログインが続いているかを確かめる。JWT の期限が切れていれば取り直し、
// 取り直せなければ（ログインの期限が切れていれば）M-8 を出して G-1 に移す（機能定義書 4.1）
export async function checkSession(): Promise<void> {
  await request('GET', '/api/auth/me')
}

// ユーザー ID が使えるか（入力欄から離れたとき）
export async function isUsernameAvailable(username: string): Promise<boolean> {
  const res = await requestJson<Schemas['UsernameAvailability']>(
    'GET', `/api/auth/username-availability?username=${encodeURIComponent(username)}`)
  return res.available
}

export function signup(username: string, displayName: string, password: string): Promise<Me> {
  return requestJson<Me>('POST', '/api/auth/signup', { username, displayName, password } satisfies Schemas['SignupRequest'])
}

export function login(username: string, password: string): Promise<Me> {
  return requestJson<Me>('POST', '/api/auth/login', { username, password } satisfies Schemas['LoginRequest'])
}

// ログアウトする。ログインが切れていても G-1 に戻るだけなので M-8 は出さない
export async function logout(): Promise<void> {
  await request('POST', '/api/auth/logout', undefined, false)
}

// ---------------------------------------------------------------- FN-03 ワークスペース

export function fetchWorkspaces(): Promise<WorkspaceSummary[]> {
  return requestJson<WorkspaceSummary[]>('GET', '/api/workspaces')
}

export function createWorkspace(name: string): Promise<WorkspaceDetail> {
  return requestJson<WorkspaceDetail>('POST', '/api/workspaces', { name } satisfies Schemas['CreateWorkspaceRequest'])
}

export function fetchWorkspace(workspaceId: number): Promise<WorkspaceDetail> {
  return requestJson<WorkspaceDetail>('GET', `/api/workspaces/${workspaceId}`)
}

// オーナーだけ。confirmName はワークスペースの名前と同じ文字（W-6）
export async function deleteWorkspace(workspaceId: number, confirmName: string): Promise<void> {
  await request('DELETE', `/api/workspaces/${workspaceId}`, { confirmName } satisfies Schemas['DeleteWorkspaceRequest'])
}

// ---------------------------------------------------------------- FN-05 メンバー管理

// G-9 のメンバーの一覧（オーナーが先頭、表示名の順に 50 人ずつ）
export function fetchMembers(workspaceId: number, q: string, cursor?: string | null): Promise<WorkspaceMemberPage> {
  return requestJson<WorkspaceMemberPage>('GET', `/api/workspaces/${workspaceId}/members${queryString({ q, cursor })}`)
}

export async function kickMember(workspaceId: number, username: string): Promise<void> {
  await request('DELETE', `/api/workspaces/${workspaceId}/members/${encodeURIComponent(username)}`)
}

export async function leaveWorkspace(workspaceId: number): Promise<void> {
  await request('POST', `/api/workspaces/${workspaceId}/leave`)
}

// ---------------------------------------------------------------- FN-04 招待

// G-11 の招待リンクの一覧（オーナーだけ。作った新しい順に 50 件ずつ）
export function fetchInvites(workspaceId: number, cursor?: string | null): Promise<InvitePage> {
  return requestJson<InvitePage>('GET', `/api/workspaces/${workspaceId}/invites${queryString({ cursor })}`)
}

export function createInvite(workspaceId: number): Promise<InviteView> {
  return requestJson<InviteView>('POST', `/api/workspaces/${workspaceId}/invites`)
}

export async function revokeInvite(workspaceId: number, inviteId: number): Promise<void> {
  await request('DELETE', `/api/workspaces/${workspaceId}/invites/${inviteId}`)
}

// G-4 に出す中身。ログインしていなければワークスペースの名前だけ。
// ログインしていない人も開くので、取り直しに失敗しても M-8 は出さない
export function fetchInvitePreview(token: string, signedIn: boolean): Promise<InvitePreview> {
  return requestJson<InvitePreview>('GET', `/api/invites/${encodeURIComponent(token)}`, undefined, signedIn)
}

export function acceptInvite(token: string): Promise<WorkspaceDetail> {
  return requestJson<WorkspaceDetail>('POST', `/api/invites/${encodeURIComponent(token)}/accept`)
}

// ---------------------------------------------------------------- FN-06 会話・FN-14 既読

// サイドバーに出す会話（自分が入っているチャンネルと、DM）
export function fetchConversations(workspaceId: number): Promise<ConversationSummary[]> {
  return requestJson<ConversationSummary[]>('GET', `/api/workspaces/${workspaceId}/conversations`)
}

export function fetchConversation(conversationId: number): Promise<ConversationDetail> {
  return requestJson<ConversationDetail>('GET', `/api/conversations/${conversationId}`)
}

// 会話を開いた・読んだ。lastMessageId は画面に出したいちばん新しいメッセージ（メッセージを作る 1-4 までは 0）
export async function markRead(conversationId: number, lastMessageId: number): Promise<void> {
  await request('POST', `/api/conversations/${conversationId}/read`,
    { lastMessageId } satisfies Schemas['ReadRequest'])
}

// ---------------------------------------------------------------- FN-06 チャンネル

// クエリを組み立てる（値がないものは付けない）
function queryString(params: Record<string, string | null | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value)
  const text = search.toString()
  return text ? `?${text}` : ''
}

// G-8 のチャンネルの一覧（公開と、入っているプライベート。名前の順に 50 件ずつ）
export function fetchChannels(workspaceId: number, q: string, cursor?: string | null): Promise<ChannelPage> {
  return requestJson<ChannelPage>('GET', `/api/workspaces/${workspaceId}/channels${queryString({ q, cursor })}`)
}

export function createChannel(workspaceId: number, name: string, description: string,
  visibility: Visibility): Promise<ConversationDetail> {
  return requestJson<ConversationDetail>('POST', `/api/workspaces/${workspaceId}/channels`,
    { name, description, visibility } satisfies Schemas['CreateChannelRequest'])
}

// 会話のメンバー（表示名の順に 50 人ずつ）
export function fetchConversationMembers(conversationId: number, q: string, cursor?: string | null): Promise<MemberPage> {
  return requestJson<MemberPage>('GET', `/api/conversations/${conversationId}/members${queryString({ q, cursor })}`)
}

// プライベートチャンネルに招待できる人（そのチャンネルにいないワークスペースのメンバー）
export function fetchInviteCandidates(conversationId: number, q: string): Promise<UserSummary[]> {
  return requestJson<UserSummary[]>('GET', `/api/conversations/${conversationId}/candidates${queryString({ q })}`)
}

export function joinChannel(conversationId: number): Promise<ConversationDetail> {
  return requestJson<ConversationDetail>('POST', `/api/conversations/${conversationId}/join`)
}

export async function leaveChannel(conversationId: number): Promise<void> {
  await request('POST', `/api/conversations/${conversationId}/leave`)
}

// 招待する。足した人を返す（もう入っていた人は含まない）
export function inviteToChannel(conversationId: number, usernames: string[]): Promise<UserSummary[]> {
  return requestJson<UserSummary[]>('POST', `/api/conversations/${conversationId}/members`,
    { usernames } satisfies Schemas['InviteRequest'])
}

export async function deleteChannel(conversationId: number): Promise<void> {
  await request('DELETE', `/api/conversations/${conversationId}`)
}

// ---------------------------------------------------------------- FN-02 プロフィール

export function fetchMyProfile(): Promise<MyProfile> {
  return requestJson<MyProfile>('GET', '/api/me/profile')
}

// 4 つとも毎回送る。statusExpiresAt は null で「消さない」
export function updateProfile(input: Schemas['UpdateProfileRequest']): Promise<Me> {
  return requestJson<Me>('PATCH', '/api/me/profile', input)
}

export function changeAvatar(file: File): Promise<Me> {
  const form = new FormData()
  form.append('file', file)
  return requestJson<Me>('PUT', '/api/me/avatar', form)
}

export function removeAvatar(): Promise<Me> {
  return requestJson<Me>('DELETE', '/api/me/avatar')
}

// G-16 の 1 人のメンバー。ワークスペースにいなければ 404 USER_NOT_FOUND（PF-9）
export function fetchMember(workspaceId: number, username: string): Promise<MemberView> {
  return requestJson<MemberView>('GET', `/api/workspaces/${workspaceId}/members/${encodeURIComponent(username)}`)
}

// ---------------------------------------------------------------- FN-12 DM

// 相手との DM を開く。なければ作る（DM-2）
export function startDm(workspaceId: number, username: string): Promise<ConversationDetail> {
  return requestJson<ConversationDetail>('POST', `/api/workspaces/${workspaceId}/dms`,
    { username } satisfies Schemas['StartDmRequest'])
}

// ---------------------------------------------------------------- FN-07 メッセージ

// 会話のメッセージ（親メッセージだけ）を古い順に。before（その ID より前）か、なし（最新）
export function fetchMessages(conversationId: number, before?: number): Promise<MessagePage> {
  const query = before === undefined ? '' : `?before=${before}`
  return requestJson<MessagePage>('GET', `/api/conversations/${conversationId}/messages${query}`)
}

// clientId は送信ごとに作る UUID。もう一度送るときは同じものを使い、2 回追加されないようにする（FN-07 5 章の 8）
export function sendMessage(conversationId: number, body: string, clientId: string): Promise<MessageView> {
  return requestJson<MessageView>('POST', `/api/conversations/${conversationId}/messages`,
    { body, clientId } satisfies Schemas['PostMessageRequest'])
}

export function editMessage(messageId: number, body: string): Promise<MessageView> {
  return requestJson<MessageView>('PATCH', `/api/messages/${messageId}`, { body } satisfies Schemas['EditMessageRequest'])
}

// データごと消したときは null、「削除されました」にしたときはそのメッセージを返す（MS-11）
export async function deleteMessage(messageId: number): Promise<MessageView | null> {
  const res = await request('DELETE', `/api/messages/${messageId}`)
  return res.status === 204 ? null : res.json() as Promise<MessageView>
}

// ---------------------------------------------------------------- 画面の URL（画面一覧 1 章）

// G-5 チャット画面。ワークスペースだけなら、最後に開いた会話（なければ general）を開く（W-4）
export const workspaceUrl = (workspaceId: number) => `/w/${workspaceId}`
export const conversationUrl = (workspaceId: number, conversationId: number) =>
  `/w/${workspaceId}/c/${conversationId}`
// G-5 の DM
export const dmUrl = (workspaceId: number, conversationId: number) => `/w/${workspaceId}/d/${conversationId}`
// 会話の種類で URL を分ける
export const conversationPath = (c: { workspaceId: number, id: number, type: ConversationSummary['type'] }) =>
  (c.type === 'DM' ? dmUrl(c.workspaceId, c.id) : conversationUrl(c.workspaceId, c.id))
// G-8 チャンネル一覧画面
export const channelsUrl = (workspaceId: number) => `/w/${workspaceId}/channels`
// G-9 メンバー一覧画面
export const membersUrl = (workspaceId: number) => `/w/${workspaceId}/members`
// G-11 招待リンクの管理画面
export const invitesUrl = (workspaceId: number) => `/w/${workspaceId}/invites`
// G-10 プロフィールの設定画面
export const PROFILE_URL = '/settings/profile'
