import { expect, test } from '@playwright/test'
import {
  closeContexts, closeThread, composer, fillSignup, messageAction, messageItem, newContext, runId, sendFrom, sidebar, signup, subscribed,
  thread, user, USER_QUEUE,
} from './helpers.ts'

test.afterEach(closeContexts)

// 主な流れ（要件定義書 2 章）を、2 人分のブラウザで続けて確かめる。pc（1280px）と mobile（375px）の両方で動かす。
// ワークスペースを作る → 招待リンクを作る → ログインしていない人がリンクを開いて登録し、参加する →
// メッセージ・スレッド・リアクション・DM が、相手の画面に開き直さずに出る（N-3・N-4）
test('ワークスペースを作って招待し、2 人でリアルタイムにやり取りする', async ({ browser }) => {
  const taro = user('ma', 'たろう')
  const hana = user('mb', 'はなこ')
  const name = `主な流れ ${runId()}`
  const page = await signup(browser, taro)

  await test.step('W-3 ワークスペースを作ると、general が開く', async () => {
    await page.getByRole('button', { name: 'ワークスペースを作る' }).click()
    const dialog = page.getByRole('dialog', { name: 'ワークスペースを作る' })
    await dialog.getByLabel('名前').fill(name)
    await dialog.getByRole('button', { name: '作る' }).click()
    await expect(composer(page)).toHaveAttribute('placeholder', '# general へのメッセージ')
  })

  let inviteUrl = ''
  await test.step('I-1 招待リンクを作る', async () => {
    await (await sidebar(page)).getByRole('button', { name: `${name}のメニュー` }).click()
    await page.getByRole('link', { name: '招待リンクの管理' }).click()
    await page.getByRole('button', { name: '招待リンクを作る' }).click()
    const shown = page.locator('[title*="/invite/"]').first()
    await expect(shown).toBeVisible()
    inviteUrl = new URL((await shown.getAttribute('title'))!).pathname
  })

  const hanaPage = await (await newContext(browser)).newPage()
  await test.step('I-4 ログインしていない人がリンクを開き、登録してから参加する', async () => {
    await hanaPage.goto(inviteUrl)
    await expect(hanaPage.getByText(`「${name}」に招待されています`)).toBeVisible()
    await hanaPage.getByRole('button', { name: 'アカウントを作る' }).click()
    await fillSignup(hanaPage, hana)
    // 登録した後は招待リンクの画面に戻る（A-10）
    await expect(hanaPage.getByText(`「${name}」に招待されています`)).toBeVisible()
    await hanaPage.getByRole('button', { name: '参加する' }).click()
    await expect(composer(hanaPage)).toHaveAttribute('placeholder', '# general へのメッセージ')
  })

  await test.step('MS-5 送ったメッセージが、開き直さずに相手に出る', async () => {
    await page.goto(new URL(hanaPage.url()).pathname)
    await expect(composer(page)).toBeVisible()
    await subscribed(page, '/topic/conversations/', 1)
    await subscribed(hanaPage, '/topic/conversations/', 1)
    await sendFrom(composer(hanaPage), 'はじめまして')
    await expect(messageItem(page, hana, 'はじめまして')).toBeVisible()
    await sendFrom(composer(page), 'ようこそ')
    await expect(messageItem(hanaPage, taro, 'ようこそ')).toBeVisible()
  })

  await test.step('TH-3 スレッドで返信すると、相手の親メッセージに件数が出る', async () => {
    await messageAction(messageItem(page, hana, 'はじめまして'), 'スレッドで返信')
    await sendFrom(thread(page).getByPlaceholder('返信する…'), 'スレッドの返信です')
    await expect(messageItem(thread(page), taro, 'スレッドの返信です')).toBeVisible()
    await expect(messageItem(hanaPage, hana, 'はじめまして').getByRole('button', { name: /1 件の返信/ })).toBeVisible()
    await closeThread(page)
  })

  await test.step('RE-1 絵文字の一覧からリアクションを付けると、相手にも出る', async () => {
    await messageAction(messageItem(hanaPage, taro, 'ようこそ'), 'リアクション')
    await hanaPage.locator('emoji-picker').getByRole('menuitem').first().click()
    const chip = (p: typeof page) => messageItem(p, taro, 'ようこそ').getByRole('list', { name: 'リアクション' })
      .getByRole('button', { name: /1 件/ })
    await expect(chip(hanaPage)).toHaveAttribute('aria-pressed', 'true')
    await expect(chip(page)).toHaveAttribute('aria-pressed', 'false')
  })

  await test.step('DM-2 DM を始めて送ると、相手のサイドバーに未読の件数が出る', async () => {
    await subscribed(hanaPage, USER_QUEUE)
    await (await sidebar(page)).getByRole('button', { name: 'ダイレクトメッセージを始める' }).click()
    const dialog = page.getByRole('dialog', { name: 'ダイレクトメッセージを始める' })
    await dialog.getByRole('searchbox', { name: '名前で探す' }).fill(hana.username)
    await dialog.getByRole('button', { name: new RegExp(hana.displayName) }).click()
    await expect(composer(page)).toHaveAttribute('placeholder', `${hana.displayName} へのメッセージ`)
    await sendFrom(composer(page), 'DM です')
    await expect(messageItem(page, taro, 'DM です')).toBeVisible()

    const dm = (await sidebar(hanaPage)).getByRole('link', { name: new RegExp(taro.displayName) })
    await expect(dm.getByLabel('未読 1 件')).toBeVisible()
    await dm.click()
    await expect(messageItem(hanaPage, taro, 'DM です')).toBeVisible()
    await expect((await sidebar(hanaPage)).getByLabel('未読 1 件')).toHaveCount(0)
  })
})
