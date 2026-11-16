import { expect, test } from '@playwright/test'
import {
  closeContexts, createChannel, createWorkspace, join, newContext, PASSWORD, postMessage, send, signup, status,
  submitLogin, toast, uploadImage, user, xsrfHeader,
} from './helpers.ts'

test.afterEach(closeContexts)

// 権限と安全（要件定義書 11.3）のうち、画面を通して確かめられるもの。
// API の層ごとの細かい確認は、API のテスト（*ApiTests）で行っている

test('ログインしていないと、どの画面も G-1 に移り、API も 401 を返す（N-13）', async ({ browser }) => {
  const page = await (await newContext(browser)).newPage()
  for (const path of ['/', '/settings/profile', '/w/1', '/w/1/c/1', '/w/1/d/1', '/w/1/search?q=a', '/w/1/mentions',
    '/w/1/channels', '/w/1/members', '/w/1/invites']) {
    await page.goto(path)
    await expect(page, path).toHaveURL(/\/login$/)
  }
  for (const path of ['/api/auth/me', '/api/workspaces', '/api/workspaces/1', '/api/conversations/1/messages',
    '/api/workspaces/1/search?q=a', '/api/messages/1']) {
    expect((await page.request.get(path)).status(), path).toBe(401)
  }
  // WebSocket もつなげない（つなぎ始めの HTTP で 401）
  expect((await page.request.get('/ws')).status()).toBe(401)
})

// N-14 入っていないワークスペース・プライベートチャンネル・ほかの人の DM は、API・検索・添付のどれからも取れない
test('見られる範囲の外のデータは、画面でも API でも取れない（N-14・N-16・N-17）', async ({ browser }) => {
  const taro = user('sa', 'たろう')
  const hana = user('sb', 'はなこ')
  const outsider = user('sc', 'よそもの')
  const page = await signup(browser, taro)
  const hanaPage = await signup(browser, hana)
  const outsiderPage = await signup(browser, outsider)
  const jiroPage = await signup(browser, user('se', 'じろう'))
  const workspace = await createWorkspace(page, '権限')
  await join(page, workspace, hanaPage, jiroPage)
  const general = workspace.generalConversationId
  const secret = await createChannel(page, workspace, 'secret-room', 'PRIVATE')
  const secretMessage = await postMessage(page, secret.id, 'ひみつのことば')
  const image = await uploadImage(page, secret.id, 'secret.png')
  await send(page, 'POST', `/api/conversations/${secret.id}/messages`,
    { body: '添付', clientId: crypto.randomUUID(), attachmentIds: [image.id] })
  // たろうとじろうの DM（はなこは見られない）
  const dm = await send<{ id: number }>(jiroPage, 'POST', `/api/workspaces/${workspace.id}/dms`, { username: taro.username })
  const dmMessage = await postMessage(page, dm.id, 'DM のひみつ')
  const generalMessage = await postMessage(page, general, 'たろうのメッセージ')

  await test.step('入っていないワークスペースは、名前も含めて何も取れない', async () => {
    for (const path of [`/api/workspaces/${workspace.id}`, `/api/workspaces/${workspace.id}/conversations`,
      `/api/workspaces/${workspace.id}/members`, `/api/conversations/${general}/messages`,
      `/api/messages/${generalMessage.id}`, `/api/workspaces/${workspace.id}/search?q=${encodeURIComponent('たろう')}`]) {
      expect(await status(outsiderPage, 'GET', path), path).toBe(404)
    }
    expect(await status(outsiderPage, 'POST', `/api/conversations/${general}/messages`,
      { body: '割り込み', clientId: crypto.randomUUID() })).toBe(404)
    await outsiderPage.goto(`/w/${workspace.id}/c/${general}`)
    await expect(toast(outsiderPage)).toContainText('このワークスペースは見つからないか、参加していません。')
    await expect(outsiderPage.getByText(workspace.name)).toHaveCount(0)
  })

  await test.step('入っていないプライベートチャンネル・ほかの人の DM は、メンバーでも取れない', async () => {
    for (const path of [`/api/conversations/${secret.id}`, `/api/conversations/${secret.id}/messages`,
      `/api/messages/${secretMessage.id}`, `/api/messages/${dmMessage.id}`]) {
      expect(await status(hanaPage, 'GET', path), path).toBe(404)
    }
    // 検索にも出ない
    const found = await (await hanaPage.request.get(
      `/api/workspaces/${workspace.id}/search?q=${encodeURIComponent('ひみつ')}`)).json() as { items: unknown[] }
    expect(found.items).toEqual([])
    // 画面で開いても M-27 で general に移る
    await hanaPage.goto(`/w/${workspace.id}/c/${secret.id}`)
    await expect(toast(hanaPage)).toContainText('このチャンネルは見つからないか、参加していません。')
    await expect(hanaPage.getByText('ひみつのことば')).toHaveCount(0)
  })

  await test.step('オーナーだけの操作と、ほかの人のものの変更は、API を直接呼んでも断る', async () => {
    expect(await status(hanaPage, 'POST', `/api/workspaces/${workspace.id}/invites`)).toBe(403)
    expect(await status(hanaPage, 'DELETE', `/api/workspaces/${workspace.id}/members/${taro.username}`)).toBe(403)
    expect(await status(hanaPage, 'DELETE', `/api/workspaces/${workspace.id}`, { confirmName: workspace.name })).toBe(403)
    expect(await status(hanaPage, 'PATCH', `/api/messages/${generalMessage.id}`, { body: '書き換え' })).toBe(403)
    expect(await status(hanaPage, 'DELETE', `/api/messages/${generalMessage.id}`)).toBe(403)
    const public1 = await createChannel(page, workspace, 'public-room')
    expect(await status(hanaPage, 'DELETE', `/api/conversations/${public1.id}`)).toBe(403)
    // 画面にも操作を出さない
    await hanaPage.goto(`/w/${workspace.id}/members`)
    await expect(hanaPage.getByRole('button', { name: /をキック$/ })).toHaveCount(0)
    await expect((await hanaPage.request.get(`/api/messages/${generalMessage.id}`)).json())
      .resolves.toMatchObject({ body: 'たろうのメッセージ' })
  })
})

test('CSRF のトークンがない書き込みは断る（N-25）', async ({ browser }) => {
  const page = await signup(browser, user('sd', 'たろう'))
  const res = await page.request.post('/api/workspaces', { data: { name: 'CSRF' } })
  expect(res.status()).toBe(403)
  const ok = await page.request.post('/api/workspaces', { data: { name: 'CSRF' }, headers: await xsrfHeader(page) })
  expect(ok.status()).toBe(201)
})

// A-7・N-19
test('5 回続けてパスワードを間違えると、正しいパスワードでもログインできない', async ({ browser }) => {
  const saburo = user('sl', 'さぶろう')
  const page = await signup(browser, saburo)
  await page.getByRole('button', { name: 'ログアウト' }).click()
  await expect(page).toHaveURL(/\/login$/)

  const alert = page.getByRole('alert')
  for (let i = 1; i <= 4; i++) {
    await submitLogin(page, saburo.username, 'wrong-pass1')
    await expect(alert).toHaveText('ユーザー ID かパスワードが違います。')
  }
  await submitLogin(page, saburo.username, 'wrong-pass1')
  await expect(alert).toHaveText('ログインに続けて失敗したため、15 分間ログインできません。')
  await submitLogin(page, saburo.username, PASSWORD)
  await expect(alert).toHaveText('ログインに続けて失敗したため、15 分間ログインできません。')
  await expect(page).toHaveURL(/\/login$/)
})
