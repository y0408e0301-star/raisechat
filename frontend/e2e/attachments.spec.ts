import { expect, test } from '@playwright/test'
import {
  closeContexts, composer, createWorkspace, join, messageAction, messageItem, openConversation, pngFile, send, signup, user,
} from './helpers.ts'

test.afterEach(closeContexts)

// FN-09 画像の添付・FN-10 リアクション・FN-02 プロフィール。添付とアバターは、手元では S3 の開発用バケット、
// CI では MinIO に、ブラウザから直接 PUT する（cleanup.ts が後で消す）

test('画像を添付して送ると、相手に縮小した画像が出て、押すと拡大する。編集で外せる', async ({ browser }) => {
  const taro = user('aa', 'たろう')
  const hana = user('ab', 'はなこ')
  const page = await signup(browser, taro)
  const hanaPage = await signup(browser, hana)
  const workspace = await createWorkspace(page, '添付')
  await join(page, workspace, hanaPage)
  const general = workspace.generalConversationId
  await openConversation(page, workspace, general)
  await openConversation(hanaPage, workspace, general)

  // AT-1〜AT-3 📎 で選ぶと、アップロードが済むまで送れず、済んだら送れる
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'ファイルを添付' }).click()
  await (await chooser).setFiles([pngFile('a.png'), pngFile('b.png')])
  const previews = page.getByRole('list', { name: '添付' })
  await expect(previews.getByRole('img')).toHaveCount(2)
  const sendButton = page.getByRole('button', { name: '送信 ➤' })
  await expect(sendButton).toBeEnabled()
  await composer(page).fill('写真です')
  await sendButton.click()

  // AT-5・AT-6 相手の画面に、縮小した画像（署名付き URL）が出る
  const item = messageItem(hanaPage, taro, '写真です')
  await expect(item.getByRole('img', { name: 'a.png' })).toBeVisible()
  await expect(item.getByRole('img', { name: 'b.png' })).toHaveJSProperty('complete', true)
  expect(await item.getByRole('img', { name: 'a.png' }).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)

  // G-17 押すと元の画像を拡大し、前後の画像に移れる
  await item.getByRole('button', { name: 'a.pngを大きく見る' }).click()
  const viewer = hanaPage.getByRole('dialog')
  await expect(viewer.getByRole('img', { name: 'a.png' })).toBeVisible()
  await viewer.getByRole('button', { name: '次の画像' }).click()
  await expect(viewer.getByRole('img', { name: 'b.png' })).toBeVisible()
  await viewer.getByRole('button', { name: '閉じる' }).click()

  // AT-9 編集で添付を外すと、相手の画面からも消える
  await messageAction(messageItem(page, taro, '写真です'), '編集')
  await page.getByRole('button', { name: 'b.pngを外す' }).click()
  await page.getByRole('button', { name: '保存' }).click()
  await expect(item.getByRole('img', { name: 'b.png' })).toHaveCount(0)
  await expect(item.getByRole('img', { name: 'a.png' })).toBeVisible()

  // AT-4 送れない形式のファイルは M-39
  const textChooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'ファイルを添付' }).click()
  await (await textChooser).setFiles({ name: 'memo.txt', mimeType: 'text/plain', buffer: Buffer.from('memo') })
  await expect(page.getByText('添付できるのは、10MB までの画像（JPEG・PNG・GIF・WebP）と 100MB までの動画（MP4・WebM）です。'))
    .toBeVisible()
})

test('リアクションは押して付け外しでき、相手の画面の件数も変わる', async ({ browser }) => {
  const taro = user('ac', 'たろう')
  const hana = user('ad', 'はなこ')
  const page = await signup(browser, taro)
  const hanaPage = await signup(browser, hana)
  const workspace = await createWorkspace(page, 'リアクション')
  await join(page, workspace, hanaPage)
  const general = workspace.generalConversationId
  const message = await send<{ id: number }>(page, 'POST', `/api/conversations/${general}/messages`,
    { body: 'いいね', clientId: crypto.randomUUID() })
  await send(page, 'PUT', `/api/messages/${message.id}/reactions/${encodeURIComponent('🎉')}`)
  await openConversation(page, workspace, general)
  await openConversation(hanaPage, workspace, general)

  const chip = (p: typeof page) => messageItem(p, taro, 'いいね').getByRole('button', { name: /^🎉 / })
  // RE-3 付いている絵文字を押すと自分も付け、もう一度押すと外す
  await expect(chip(hanaPage)).toHaveAccessibleName('🎉 1 件')
  await chip(hanaPage).click()
  await expect(chip(hanaPage)).toHaveAccessibleName('🎉 2 件、自分も付けた')
  await expect(chip(page)).toHaveAccessibleName('🎉 2 件、自分も付けた')
  // RE-4 重ねると付けた人を出す
  await chip(page).hover()
  await expect(page.getByRole('tooltip')).toHaveText(`${taro.displayName}、${hana.displayName}`)
  await chip(hanaPage).click()
  await expect(chip(page)).toHaveAccessibleName('🎉 1 件、自分も付けた')
})

test('プロフィール（表示名・ステータス・アバター）を変えると、ほかの人にも出る', async ({ browser }) => {
  const taro = user('ae', 'たろう')
  const hana = user('af', 'はなこ')
  const page = await signup(browser, taro)
  const hanaPage = await signup(browser, hana)
  const workspace = await createWorkspace(page, 'プロフィール')
  await join(page, workspace, hanaPage)
  await send(page, 'POST', `/api/conversations/${workspace.generalConversationId}/messages`,
    { body: 'プロフィールを変えます', clientId: crypto.randomUUID() })

  // PF-1〜PF-6 G-10 で変えて保存すると M-10
  const renamed = `${taro.displayName}改`
  await page.goto('/settings/profile')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '画像を選ぶ' }).click()
  await (await chooser).setFiles(pngFile('me.png'))
  await page.getByLabel('表示名').fill(renamed)
  await page.getByRole('textbox', { name: 'ステータス' }).fill('在宅勤務')
  await page.getByRole('button', { name: '保存する' }).click()
  await expect(page.getByRole('status')).toContainText('保存しました。')

  // PF-7 G-16 で表示名・ステータス・アバターが見える
  await hanaPage.goto(`/w/${workspace.id}/c/${workspace.generalConversationId}`)
  const item = hanaPage.getByRole('article', { name: `${renamed}のメッセージ` })
  await item.getByRole('button', { name: `${renamed}のプロフィール` }).click()
  const card = hanaPage.getByRole('dialog', { name: `${renamed}のプロフィール` })
  await expect(card).toContainText(`@${taro.username}`)
  await expect(card).toContainText('在宅勤務')
  await expect(card.getByRole('img', { name: `${renamed}のアバター` })).toHaveJSProperty('complete', true)
})
