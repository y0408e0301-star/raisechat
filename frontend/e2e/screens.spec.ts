import { AxeBuilder } from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import {
  closeContexts, composer, createChannel, createWorkspace, isNarrow, join, messageAction, messageItem, newContext,
  postMessage, postReply, postWithAttachments, runId, send, sidebar, signup, thread, uploadImage, user,
} from './helpers.ts'

test.afterEach(closeContexts)

// すべての画面（G-1〜G-18）を、データを入れた状態で開いて確かめる。pc（1280px）と mobile（375px）の両方で動かす。
// (1) アクセシビリティ：axe-core で WCAG 2.1 の A・AA に違反がない（コントラスト比 N-27 を含む）
// (2) 画面の幅：横にスクロールしない（N-29）。長い表示名・ワークスペース名と、区切りのない長いメッセージも入れておく

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

async function check(page: Page, ready: Locator, firefoxExclude?: string): Promise<void> {
  await expect(ready).toBeVisible()
  // 絵文字の一覧（emoji-picker-element）は外の部品なので除く
  let axe = new AxeBuilder({ page }).withTags(WCAG).exclude('emoji-picker')
  if (firefoxExclude && test.info().project.use.browserName === 'firefox') axe = axe.exclude(firefoxExclude)
  const { violations } = await axe.analyze()
  const found = violations.map((v) => `${v.id}（${v.help}）: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
  expect.soft(found, 'アクセシビリティの違反').toEqual([])
  // 375px の画面では、ページの幅（レイアウトの幅）が画面より広がると横にスクロールする
  // （はみ出したときは、画面の右端を超えた要素を、原因を探す手がかりとしてメッセージに出す）
  const width = page.viewportSize()!.width
  const { scrollWidth, wide } = await page.evaluate((w) => ({
    scrollWidth: document.documentElement.scrollWidth,
    wide: [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > w + 1)
      .slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${e.className}`),
  }), width)
  expect.soft(scrollWidth, `横にスクロールしない（はみ出した要素：${wide.join('、')}）`).toBeLessThanOrEqual(width)
}

// N-27（axe のコントラスト比）、N-29（mobile の 375px）
test('すべての画面に、アクセシビリティの違反と横のスクロールがない', async ({ browser }) => {
  // 18 の画面を回るので、Firefox・WebKit では 1 分近くかかる。時間の上限を 3 倍にする
  test.slow()
  // 表示名は 30 文字まで
  const taro = user('ga', 'とてもながいなまえのユーザーです')
  const hana = user('gb', 'はなこ')
  const page = await signup(browser, taro)
  const hanaPage = await signup(browser, hana)

  // ワークスペース名は 50 文字まで（runId の 7 文字と空白を足して 50 文字）
  const workspace = await createWorkspace(page, 'とても長い名前のワークスペースです。ヘッダーで省かれるはずの長さにしておき')
  await join(page, workspace, hanaPage)
  const general = workspace.generalConversationId
  const channel = await createChannel(page, workspace, `random-${runId()}`, 'PUBLIC', 'チャンネルの説明です')
  await createChannel(hanaPage, workspace, `secret-${runId()}`, 'PRIVATE')
  await postMessage(page, general, 'あ'.repeat(1000))
  await postMessage(page, general, '**太字** と `コード` と [リンク](https://example.com)\n> 引用\n```\nコードブロック\n```')
  const image = await uploadImage(page, general, 'photo.png')
  const withImage = await postWithAttachments(page, general, `画像つき ${runId()}`, [image])
  await postReply(hanaPage, withImage.id, 'スレッドの返信')
  await send(hanaPage, 'PUT', `/api/messages/${withImage.id}/reactions/${encodeURIComponent('👍')}`)
  await postMessage(hanaPage, general, `@${taro.username} メンションです ${runId()}`)
  await send(hanaPage, 'POST', `/api/conversations/${channel.id}/join`)
  await postMessage(hanaPage, channel.id, '未読のメッセージ')
  await send(page, 'PATCH', '/api/me/profile', {
    displayName: taro.displayName, statusEmoji: '🏠', statusText: `${'在宅勤務'.repeat(25)}`,
  })
  const dm = await send<{ id: number }>(hanaPage, 'POST', `/api/workspaces/${workspace.id}/dms`, { username: taro.username })
  await postMessage(hanaPage, dm.id, 'DM のメッセージ')
  const { url: inviteUrl } = await send<{ url: string }>(page, 'POST', `/api/workspaces/${workspace.id}/invites`)

  await test.step('G-1 ログイン・G-2 ユーザー登録（エラーを出した状態も）', async () => {
    const guest = await (await newContext(browser)).newPage()
    await guest.goto('/login')
    await check(guest, guest.getByRole('button', { name: 'ログイン' }))
    await guest.goto('/signup')
    await guest.getByRole('button', { name: '登録する' }).click()
    await check(guest, guest.getByText('表示名を入力してください。'))
    await test.step('G-4 招待（ログインしていない）', async () => {
      await guest.goto(new URL(inviteUrl).pathname)
      await check(guest, guest.getByRole('button', { name: 'アカウントを作る' }))
    })
  })

  await test.step('G-3 ワークスペースの一覧（オーナー・メンションの印）', async () => {
    await page.goto('/')
    await check(page, page.getByRole('link', { name: new RegExp(`メンション \\d+ 件`) }))
  })

  await test.step('G-12 ワークスペースの作成（エラーを出した状態）', async () => {
    await page.getByRole('button', { name: 'ワークスペースを作る' }).click()
    const dialog = page.getByRole('dialog', { name: 'ワークスペースを作る' })
    await dialog.getByRole('button', { name: '作る' }).click()
    await check(page, dialog.getByText('ワークスペースの名前を入力してください。'))
    await page.keyboard.press('Escape')
  })

  await test.step('G-5 チャット画面（長い本文・Markdown・画像・リアクション・返信・メンション）', async () => {
    await page.goto(`/w/${workspace.id}/c/${general}`)
    await check(page, messageItem(page, hana, 'メンションです'))
  })

  await test.step('G-17 画像の拡大', async () => {
    await page.getByRole('button', { name: 'photo.pngを大きく見る' }).click()
    await check(page, page.getByRole('dialog').getByRole('img', { name: 'photo.png' }))
    await page.keyboard.press('Escape')
  })

  await test.step('G-5 スレッドのパネル', async () => {
    await messageItem(page, taro, '画像つき').getByRole('button', { name: /1 件の返信/ }).click()
    await check(page, messageItem(thread(page), hana, 'スレッドの返信'))
    await page.goto(`/w/${workspace.id}/c/${general}`)
  })

  await test.step('G-18 メッセージの削除の確認', async () => {
    await messageAction(messageItem(page, taro, '画像つき'), '削除')
    await check(page, page.getByRole('dialog', { name: 'メッセージの削除' }))
    await page.keyboard.press('Escape')
  })

  await test.step('G-16 プロフィール', async () => {
    await messageItem(page, hana, 'メンションです').getByRole('button', { name: `${hana.displayName}のプロフィール` }).click()
    await check(page, page.getByRole('button', { name: 'メッセージを送る' }))
    await page.keyboard.press('Escape')
  })

  await test.step('G-14 チャンネルの詳細・G-13 チャンネルの作成', async () => {
    await page.goto(`/w/${workspace.id}/c/${channel.id}`)
    await page.getByRole('button', { name: 'チャンネルの詳細' }).click()
    await check(page, page.getByRole('dialog').getByRole('button', { name: 'チャンネルを削除' }))
    await page.keyboard.press('Escape')
    await (await sidebar(page)).getByRole('button', { name: 'チャンネルを作る' }).click()
    await check(page, page.getByRole('dialog', { name: 'チャンネルを作る' }))
    await page.keyboard.press('Escape')
  })

  await test.step('G-5 サイドバー（未読・DM・件数）', async () => {
    const nav = await sidebar(page)
    await check(page, nav.getByRole('link', { name: new RegExp(hana.displayName) }))
    if (isNarrow(page)) await nav.getByRole('link', { name: `random-${runId()}` }).click()
  })

  await test.step('G-15 DM を始める・DM の会話', async () => {
    await (await sidebar(page)).getByRole('button', { name: 'ダイレクトメッセージを始める' }).click()
    await check(page, page.getByRole('dialog', { name: 'ダイレクトメッセージを始める' }).getByRole('button', { name: new RegExp(hana.displayName) }))
    await page.keyboard.press('Escape')
    await page.goto(`/w/${workspace.id}/d/${dm.id}`)
    await check(page, composer(page))
  })

  await test.step('G-6 検索結果', async () => {
    await page.goto(`/w/${workspace.id}/search?q=${encodeURIComponent('メンション')}`)
    await check(page, page.getByRole('heading', { name: '「メンション」の検索結果' }))
  })

  await test.step('G-7 メンション', async () => {
    await page.goto(`/w/${workspace.id}/mentions`)
    await check(page, page.getByText(`メンションです ${runId()}`))
  })

  await test.step('G-8 チャンネルを探す', async () => {
    await page.goto(`/w/${workspace.id}/channels`)
    await check(page, page.getByRole('main').getByRole('link', { name: `random-${runId()}` }))
  })

  await test.step('G-9 メンバー・ワークスペースの削除', async () => {
    await page.goto(`/w/${workspace.id}/members`)
    await check(page, page.getByRole('button', { name: `${hana.displayName}をキック` }))
    await page.getByRole('button', { name: 'ワークスペースを削除' }).click()
    await check(page, page.getByRole('dialog', { name: 'ワークスペースの削除' }))
    await page.keyboard.press('Escape')
    await hanaPage.goto(`/w/${workspace.id}/members`)
    await check(hanaPage, hanaPage.getByRole('button', { name: 'ワークスペースから退出' }))
  })

  await test.step('G-11 招待リンク・取り消しの確認', async () => {
    await page.goto(`/w/${workspace.id}/invites`)
    await check(page, page.getByRole('button', { name: 'コピー' }).first())
    await page.getByRole('button', { name: '取り消す' }).first().click()
    await check(page, page.getByRole('dialog', { name: '招待リンクの取り消し' }))
    await page.keyboard.press('Escape')
  })

  await test.step('G-4 招待（ログインしている・期限切れ）', async () => {
    const other = await signup(browser, user('gc', 'じろう'))
    await other.goto(new URL(inviteUrl).pathname)
    await check(other, other.getByRole('button', { name: '参加する' }))
    await other.goto('/invite/nothing-such-token')
    await check(other, other.getByRole('alert'))
  })

  await test.step('G-10 プロフィールの設定', async () => {
    await page.goto('/settings/profile')
    // Playwright の Firefox は、axe の button-name の検査でこのスイッチ（role="switch" の button）を調べると、
    // ページごと落ちる（Page crashed）。画面を使う人には関係しないので、Firefox だけスイッチを axe から外す
    //（ほかのブラウザでは調べている。テスト仕様書 3.2）
    await check(page, page.getByRole('switch', { name: 'ブラウザの通知' }), '[role="switch"]')
  })
})
