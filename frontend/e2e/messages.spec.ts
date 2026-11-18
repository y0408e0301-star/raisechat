import { expect, test } from '@playwright/test'
import {
  closeContexts, composer, createChannel, createWorkspace, join, messageAction, messageItem, openConversation, postMessage, postReply,
  runId, send, sendFrom, sidebar, signup, subscribed, toast, user, USER_QUEUE,
} from './helpers.ts'

test.afterEach(closeContexts)

// FN-07 メッセージ・FN-11 メンション・FN-13 検索・FN-14 通知を、2 人分のブラウザで確かめる

test('編集・削除が相手の画面に開き直さずに出て、オーナーはほかの人のメッセージも削除できる', async ({ browser }) => {
  const taro = user('ea', 'たろう')
  const hana = user('eb', 'はなこ')
  const page = await signup(browser, taro)
  const hanaPage = await signup(browser, hana)
  const workspace = await createWorkspace(page, 'メッセージ')
  await join(page, workspace, hanaPage)
  const general = workspace.generalConversationId
  await openConversation(page, workspace, general)
  await openConversation(hanaPage, workspace, general)

  // MS-9 編集すると「（編集済み）」を付けて相手にも出す
  await sendFrom(composer(hanaPage), '明日は 10 時に集合')
  const mine = messageItem(hanaPage, hana, '明日は 10 時に集合')
  await expect(messageItem(page, hana, '明日は 10 時に集合')).toBeVisible()
  await messageAction(mine, '編集')
  const editor = hanaPage.getByRole('textbox', { name: 'メッセージを編集' })
  await editor.fill('明日は 11 時に集合')
  await editor.press('Enter')
  const edited = messageItem(page, hana, '明日は 11 時に集合')
  await expect(edited).toContainText('（編集済み）')

  // MS-10 本人の削除。確認ダイアログ（G-18）を出し、相手の画面からも消える
  await sendFrom(composer(hanaPage), '送り間違い')
  await expect(messageItem(page, hana, '送り間違い')).toBeVisible()
  await messageAction(messageItem(hanaPage, hana, '送り間違い'), '削除')
  const dialog = hanaPage.getByRole('dialog', { name: 'メッセージの削除' })
  await expect(dialog).toContainText('このメッセージを削除しますか？元に戻せません。')
  await dialog.getByRole('button', { name: '削除' }).click()
  await expect(messageItem(page, hana, '送り間違い')).toHaveCount(0)

  // U-2 オーナーはほかの人のメッセージを削除できる（編集はできない）
  await messageAction(edited, '削除')
  await expect(edited.getByRole('button', { name: '編集', exact: true })).toHaveCount(0)
  const ownerDialog = page.getByRole('dialog', { name: 'メッセージの削除' })
  await expect(ownerDialog).toContainText(`${hana.displayName}さんのメッセージを削除しますか？`)
  await ownerDialog.getByRole('button', { name: '削除' }).click()
  await expect(messageItem(hanaPage, hana, '11 時に集合')).toHaveCount(0)
})

test('Markdown を飾りにし、HTML とスクリプトは文字のまま出す', async ({ browser }) => {
  const taro = user('ec', 'たろう')
  const page = await signup(browser, taro)
  const workspace = await createWorkspace(page, 'Markdown')
  let dialogs = 0
  page.on('dialog', (dialog) => {
    dialogs++
    void dialog.dismiss()
  })
  await openConversation(page, workspace, workspace.generalConversationId)
  const body = '**太字** <img src=x onerror="alert(1)"><script>alert(2)</script> [リンク](javascript:alert(3)) https://example.com'
  await sendFrom(composer(page), body)
  const item = messageItem(page, taro, '太字')
  // MS-6・N-21
  await expect(item.locator('strong')).toHaveText('太字')
  await expect(item.getByText('<img src=x onerror="alert(1)">', { exact: false })).toBeVisible()
  await expect(item.locator('img[src="x"], script')).toHaveCount(0)
  await expect(item.getByRole('link', { name: 'リンク' })).toHaveCount(0)
  await expect(item.getByRole('link', { name: 'https://example.com' })).toHaveAttribute('target', '_blank')
  expect(dialogs).toBe(0)
})

test('メンションと未読が開き直さずに一覧・サイドバーに出て、メンションの一覧からその位置を開ける', async ({ browser }) => {
  const taro = user('ed', 'たろう')
  const hana = user('ee', 'はなこ')
  const page = await signup(browser, taro)
  const hanaPage = await signup(browser, hana)
  const workspace = await createWorkspace(page, '通知')
  await join(page, workspace, hanaPage)
  const general = workspace.generalConversationId
  const old = await postMessage(page, general, '前のメッセージ')
  await send(hanaPage, 'POST', `/api/conversations/${general}/read`, { lastMessageId: old.id })

  // NT-3・NT-6 G-3 の一覧で、未読とメンションの件数が変わる
  await hanaPage.goto('/')
  await subscribed(hanaPage, USER_QUEUE)
  await openConversation(page, workspace, general)
  // MN-1 「@」で候補を出し、選ぶと「@ユーザー ID 」を入れる
  const input = composer(page)
  await input.fill(`@${hana.username.slice(0, 8)}`)
  await page.getByRole('listbox', { name: 'メンションの候補' }).getByRole('option', { name: new RegExp(hana.displayName) }).click()
  await expect(input).toHaveValue(`@${hana.username} `)
  await input.pressSequentially(`確認お願いします ${runId()}`)
  await input.press('Enter')
  const row = hanaPage.getByRole('link', { name: new RegExp(workspace.name) })
  await expect(row.getByLabel('メンション 1 件')).toBeVisible()

  // NT-1・NT-2 サイドバーとヘッダーにメンションの件数。行を押すと general が開いて読んだことになり、件数がすぐ消えるので、
  // 自分で作ったほかのチャンネルを開いて確かめる
  const other = await createChannel(hanaPage, workspace, `other-${runId()}`)
  await openConversation(hanaPage, workspace, other.id)
  await expect(hanaPage.getByRole('banner').getByRole('link', { name: 'メンション 1 件' })).toBeVisible()
  await expect((await sidebar(hanaPage)).getByRole('link', { name: /general/ }).getByLabel('メンション 1 件')).toBeVisible()
  // NT-5 G-7 から押すと、その会話を開いてメッセージを目立たせ、件数が消える
  await hanaPage.goto(`/w/${workspace.id}/mentions`)
  await hanaPage.getByRole('button', { name: /確認お願いします/ }).click()
  const mention = messageItem(hanaPage, taro, '確認お願いします')
  await expect(mention).toBeVisible()
  // MN-3 記録したメンションは「@ユーザー ID」を目立たせる
  await expect(mention.getByText(`@${hana.username}`, { exact: true })).toBeVisible()
  await expect(hanaPage.getByRole('banner').getByRole('link', { name: 'メンション 1 件' })).toHaveCount(0)
})

test('検索した結果を押すと、そのメッセージ（スレッドの返信は親とスレッド）の位置を開く', async ({ browser }) => {
  const taro = user('ef', 'たろう')
  const page = await signup(browser, taro)
  const workspace = await createWorkspace(page, '検索')
  const general = workspace.generalConversationId
  const word = `ゆうえんち${runId()}`
  const parent = await postMessage(page, general, `${word} に行きたい`)
  for (let i = 0; i < 60; i++) await postMessage(page, general, `うめるメッセージ ${i}`)
  await postReply(page, parent.id, `${word} の返信`)
  await page.goto(`/w/${workspace.id}/c/${general}`)

  // SR-7 空なら M-43
  const box = page.getByRole('searchbox', { name: 'メッセージを検索' })
  await box.fill('  ')
  await box.press('Enter')
  await expect(toast(page)).toContainText('検索する言葉を入力してください。')

  // SR-1・SR-3 新しい順（返信が先）。一致した言葉を目立たせる
  await box.fill(word)
  await box.press('Enter')
  const results = page.getByRole('main').getByRole('listitem')
  await expect(results).toHaveCount(2)
  await expect(results.first()).toContainText('スレッドの返信')
  await expect(results.first().locator('mark')).toHaveText(word)

  // MS-14 古いメッセージ（最新の 50 件の外）も、その前後を読み込んで開く
  await results.nth(1).getByRole('button').click()
  await expect(messageItem(page, taro, `${word} に行きたい`)).toBeInViewport()

  // スレッドの返信は、親の位置を開いてスレッドも開く
  await box.fill(word)
  await box.press('Enter')
  await page.getByRole('main').getByRole('listitem').first().getByRole('button').click()
  await expect(page.getByRole('complementary', { name: 'スレッド' })).toContainText(`${word} の返信`)

  // SR-8 見つからないときは M-44
  await box.fill('ないことば')
  await box.press('Enter')
  await expect(page.getByText('「ないことば」に一致するメッセージは見つかりませんでした。')).toBeVisible()
  await expect(await sidebar(page)).toBeVisible()
})

// NT-7・NT-9 ブラウザの通知を、本物のブラウザの Service Worker で出す（#71。Android の Chrome は Service Worker でしか出せない）。
// Playwright で通知を許可できるのは Chromium 系（Edge・Chrome）だけ。通知を押したときの動きは src/notifications/sw.test.ts
test('ブラウザの通知をオンにすると、Service Worker でメンションの通知を出す', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'Firefox・WebKit は Playwright で通知を許可できない')
  const taro = user('eh', 'たろう')
  const hana = user('ei', 'はなこ')
  const page = await signup(browser, taro)
  const hanaPage = await signup(browser, hana)
  const workspace = await createWorkspace(page, 'ブラウザの通知')
  await join(page, workspace, hanaPage)

  await hanaPage.context().grantPermissions(['notifications'])
  await hanaPage.goto('/settings/profile')
  const toggle = hanaPage.getByRole('switch', { name: 'ブラウザの通知' })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await hanaPage.evaluate(() => navigator.serviceWorker.ready)
  await subscribed(hanaPage, USER_QUEUE)

  const sent = await postMessage(page, workspace.generalConversationId, `@${hana.username} 土曜の **集合** は駅前で`)
  const shown = () => hanaPage.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    return (await registration.getNotifications()).map((n) => ({ title: n.title, body: n.body, data: n.data as unknown }))
  })
  await expect.poll(shown, { message: 'Service Worker の通知' }).toEqual([{
    title: `${taro.displayName}（#general）`,
    body: `@${hana.username} 土曜の 集合 は駅前で`,
    data: { path: `/w/${workspace.id}/c/${workspace.generalConversationId}?message=${sent.id}` },
  }])
})
