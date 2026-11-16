import { expect, test } from '@playwright/test'
import {
  closeContexts, composer, createChannel, createWorkspace, join, messageItem, openConversation, postMessage, runId, sendFrom,
  sidebar, signup, subscribed, toast, user, USER_QUEUE,
} from './helpers.ts'

test.afterEach(closeContexts)

// FN-06 チャンネル。作成・探して参加・プライベートへの招待・退出・オーナーの削除を、2 人分のブラウザで確かめる

test('公開チャンネルを作ると、ほかのメンバーが G-8 で見つけて参加できる', async ({ browser }) => {
  const taro = user('ca', 'たろう')
  const hana = user('cb', 'はなこ')
  const page = await signup(browser, taro)
  const hanaPage = await signup(browser, hana)
  const workspace = await createWorkspace(page, 'チャンネル')
  await join(page, workspace, hanaPage)
  const name = `travel-${runId()}`

  // CH-1・CH-2 メンバー（オーナーでない人）も作れ、作るとそのチャンネルが開く
  await openConversation(hanaPage, workspace, workspace.generalConversationId)
  await (await sidebar(hanaPage)).getByRole('button', { name: 'チャンネルを作る' }).click()
  const dialog = hanaPage.getByRole('dialog', { name: 'チャンネルを作る' })
  await dialog.getByLabel('名前').fill(name)
  await dialog.getByLabel('説明（任意）').fill('旅行の相談')
  await dialog.getByRole('button', { name: '作る' }).click()
  await expect(composer(hanaPage)).toHaveAttribute('placeholder', `# ${name} へのメッセージ`)
  await sendFrom(composer(hanaPage), '旅行に行きましょう')

  // CH-3・CH-4 名前で絞り込んで開くと、参加していなくてもメッセージが見え、「参加する」で入力欄が出る（CH-5）
  await page.goto(`/w/${workspace.id}/channels`)
  await page.getByRole('searchbox', { name: '名前で絞り込む' }).fill('travel')
  await page.getByRole('main').getByRole('link', { name }).click()
  await expect(messageItem(page, hana, '旅行に行きましょう')).toBeVisible()
  await expect(page.getByText('このチャンネルに参加すると、メッセージを送れます。')).toBeVisible()
  await page.getByRole('button', { name: '参加する' }).click()
  await expect(composer(page)).toBeVisible()
  await expect((await sidebar(page)).getByRole('link', { name })).toBeVisible()
  await expect(page.getByRole('button', { name: 'メンバー 2 人' })).toBeVisible()
})

test('プライベートチャンネルは、招待された人だけが見られ、退出すると見られなくなる', async ({ browser }) => {
  const taro = user('cc', 'たろう')
  const hana = user('cd', 'はなこ')
  const page = await signup(browser, taro)
  const hanaPage = await signup(browser, hana)
  const workspace = await createWorkspace(page, 'プライベート')
  await join(page, workspace, hanaPage)
  const name = `secret-${runId()}`

  await openConversation(page, workspace, workspace.generalConversationId)
  await (await sidebar(page)).getByRole('button', { name: 'チャンネルを作る' }).click()
  const dialog = page.getByRole('dialog', { name: 'チャンネルを作る' })
  await dialog.getByLabel('名前').fill(name)
  await dialog.getByRole('radio', { name: /プライベート/ }).check()
  await dialog.getByRole('button', { name: '作る' }).click()
  await expect(composer(page)).toHaveAttribute('placeholder', `# ${name} へのメッセージ`)
  await sendFrom(composer(page), '内緒の話')

  // 招待される前は、G-8 にも出ない（CH-3）
  await hanaPage.goto(`/w/${workspace.id}/channels`)
  await expect(hanaPage.getByRole('main').getByRole('link', { name: /travel|secret/ })).toHaveCount(0)
  await openConversation(hanaPage, workspace, workspace.generalConversationId)
  await subscribed(hanaPage, USER_QUEUE)

  // CH-7 G-14 から招待すると、招待された人のサイドバーに開き直さずに出る
  await page.getByRole('button', { name: 'チャンネルの詳細' }).click()
  await page.getByRole('button', { name: 'メンバーを招待' }).click()
  const invite = page.getByRole('dialog', { name: `#${name} に招待する人を選ぶ` })
  await invite.getByRole('checkbox', { name: `${hana.displayName}（@${hana.username}）` }).check()
  await invite.getByRole('button', { name: '招待する（1）' }).click()
  const link = (await sidebar(hanaPage)).getByRole('link', { name })
  await expect(link).toBeVisible()
  await link.click()
  await expect(messageItem(hanaPage, taro, '内緒の話')).toBeVisible()

  // CH-8 退出すると確認を出し、general に移ってサイドバーから消える
  await hanaPage.getByRole('button', { name: 'チャンネルの詳細' }).click()
  await hanaPage.getByRole('button', { name: 'チャンネルから退出' }).click()
  await hanaPage.getByRole('dialog', { name: 'チャンネルから退出' }).getByRole('button', { name: '退出' }).click()
  await expect(composer(hanaPage)).toHaveAttribute('placeholder', '# general へのメッセージ')
  await expect((await sidebar(hanaPage)).getByRole('link', { name })).toHaveCount(0)
})

test('オーナーがチャンネルを削除すると、開いていた人は M-28 で general に移る', async ({ browser }) => {
  const taro = user('ce', 'たろう')
  const hana = user('cf', 'はなこ')
  const page = await signup(browser, taro)
  const hanaPage = await signup(browser, hana)
  const workspace = await createWorkspace(page, '削除')
  await join(page, workspace, hanaPage)
  const name = `old-${runId()}`
  const channel = await createChannel(hanaPage, workspace, name)
  await postMessage(hanaPage, channel.id, '消えるメッセージ')
  await openConversation(hanaPage, workspace, channel.id)
  await subscribed(hanaPage, USER_QUEUE)

  // CH-10 オーナーは作っていないチャンネルも削除できる。メンバーでない人には「チャンネルを削除」だけが出る
  await page.goto(`/w/${workspace.id}/c/${channel.id}`)
  await page.getByRole('button', { name: 'チャンネルの詳細' }).click()
  await expect(page.getByRole('button', { name: 'チャンネルから退出' })).toHaveCount(0)
  await page.getByRole('button', { name: 'チャンネルを削除' }).click()
  await page.getByRole('dialog', { name: 'チャンネルの削除' }).getByRole('button', { name: '削除' }).click()
  await expect(composer(page)).toHaveAttribute('placeholder', '# general へのメッセージ')

  await expect(toast(hanaPage)).toContainText(`チャンネル「#${name}」は削除されました。`)
  await expect(composer(hanaPage)).toHaveAttribute('placeholder', '# general へのメッセージ')
  await expect((await sidebar(hanaPage)).getByRole('link', { name })).toHaveCount(0)
  // general は削除できない（CH-10）
  await page.getByRole('button', { name: 'チャンネルの詳細' }).click()
  await expect(page.getByRole('button', { name: 'チャンネルを削除' })).toHaveCount(0)
})
