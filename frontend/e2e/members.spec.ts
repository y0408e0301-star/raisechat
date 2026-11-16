import { expect, test } from '@playwright/test'
import {
  closeContexts, composer, createWorkspace, join, messageItem, openConversation, postMessage, send, signup, subscribed,
  toast, user, USER_QUEUE,
} from './helpers.ts'

test.afterEach(closeContexts)

// FN-04 招待・FN-05 メンバー管理・FN-03 ワークスペースの削除・FN-12 DM（相手が抜けたとき）

test('取り消した招待リンクでは参加できない', async ({ browser }) => {
  const page = await signup(browser, user('ia', 'たろう'))
  const hanaPage = await signup(browser, user('ib', 'はなこ'))
  const workspace = await createWorkspace(page, '招待')
  const { url } = await send<{ url: string }>(page, 'POST', `/api/workspaces/${workspace.id}/invites`)

  // I-3 取り消す前に確認を出す
  await page.goto(`/w/${workspace.id}/invites`)
  await page.getByRole('button', { name: '取り消す' }).click()
  await page.getByRole('dialog', { name: '招待リンクの取り消し' }).getByRole('button', { name: '取り消す' }).click()
  await expect(page.getByText('取り消し済み')).toBeVisible()

  // I-6 期限切れ・取り消し済みのリンクは M-18
  await hanaPage.goto(new URL(url).pathname)
  await expect(hanaPage.getByRole('alert')).toHaveText(
    'この招待リンクは期限切れか、取り消されています。招待した人に新しいリンクをもらってください。')
  await expect(hanaPage.getByRole('button', { name: '参加する' })).toHaveCount(0)
})

test('キックされた人はすぐ追い出され、また参加すると前の DM に戻る', async ({ browser }) => {
  const taro = user('ic', 'たろう')
  const hana = user('id', 'はなこ')
  const page = await signup(browser, taro)
  const hanaPage = await signup(browser, hana)
  const workspace = await createWorkspace(page, 'キック')
  await join(page, workspace, hanaPage)
  const dm = await send<{ id: number }>(page, 'POST', `/api/workspaces/${workspace.id}/dms`, { username: hana.username })
  await postMessage(page, dm.id, '前の DM')
  await openConversation(hanaPage, workspace, workspace.generalConversationId)
  await subscribed(hanaPage, USER_QUEUE)
  await openConversation(page, workspace, dm.id, 'd')
  await subscribed(page, USER_QUEUE)

  // MB-3・MB-4 確認を出してキックすると、開いていた画面から M-22 で G-3 に移す
  const members = await page.context().newPage()
  await members.goto(`/w/${workspace.id}/members`)
  await members.getByRole('button', { name: `${hana.displayName}をキック` }).click()
  const dialog = members.getByRole('dialog', { name: 'メンバーのキック' })
  await expect(dialog).toContainText(`${hana.displayName}さんをワークスペースから外しますか？`)
  await dialog.getByRole('button', { name: 'キック' }).click()
  await expect(members.getByRole('button', { name: `${hana.displayName}をキック` })).toHaveCount(0)

  await expect(toast(hanaPage)).toContainText(`ワークスペース「${workspace.name}」から外されました。`)
  await expect(hanaPage.getByRole('heading', { name: 'ワークスペース', exact: true })).toBeVisible()
  await expect(hanaPage.getByRole('link', { name: new RegExp(workspace.name) })).toHaveCount(0)
  // 入っていないワークスペースは開けない（W-8）
  await hanaPage.goto(`/w/${workspace.id}`)
  await expect(toast(hanaPage)).toContainText('このワークスペースは見つからないか、参加していません。')

  // MB-8 相手がいなくなった DM は送れない（M-36）
  await expect(page.getByText(`${hana.displayName}さんはこのワークスペースにいないため、メッセージを送れません。`)).toBeVisible()
  await expect(composer(page)).toHaveCount(0)

  // U-3 キックされた人も招待リンクでまた参加でき、DM は前のものに戻る
  await join(page, workspace, hanaPage)
  await expect(composer(page)).toBeVisible()
  await openConversation(hanaPage, workspace, dm.id, 'd')
  await expect(messageItem(hanaPage, taro, '前の DM')).toBeVisible()
})

test('メンバーは退出でき、オーナーが名前を入れてワークスペースを削除すると全員の画面から消える', async ({ browser }) => {
  const taro = user('ie', 'たろう')
  const hana = user('if', 'はなこ')
  const jiro = user('ig', 'じろう')
  const page = await signup(browser, taro)
  const hanaPage = await signup(browser, hana)
  const jiroPage = await signup(browser, jiro)
  const workspace = await createWorkspace(page, '退出と削除')
  await join(page, workspace, hanaPage, jiroPage)

  // MB-6 退出の前に確認を出し、退出したら G-3 に移る
  await jiroPage.goto(`/w/${workspace.id}/members`)
  await jiroPage.getByRole('button', { name: 'ワークスペースから退出' }).click()
  await jiroPage.getByRole('dialog', { name: 'ワークスペースから退出' }).getByRole('button', { name: '退出' }).click()
  await expect(jiroPage.getByRole('heading', { name: 'ワークスペース', exact: true })).toBeVisible()
  await expect(jiroPage.getByRole('link', { name: new RegExp(workspace.name) })).toHaveCount(0)

  await openConversation(hanaPage, workspace, workspace.generalConversationId)
  await subscribed(hanaPage, USER_QUEUE)

  // W-6 名前を入れるまで「削除」は押せない
  await page.goto(`/w/${workspace.id}/members`)
  await page.getByRole('button', { name: 'ワークスペースを削除' }).click()
  const dialog = page.getByRole('dialog', { name: 'ワークスペースの削除' })
  await expect(dialog.getByRole('button', { name: '削除' })).toBeDisabled()
  await dialog.getByLabel('ワークスペースの名前').fill(workspace.name)
  await dialog.getByRole('button', { name: '削除' }).click()
  await expect(page.getByRole('heading', { name: 'ワークスペース', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: new RegExp(workspace.name) })).toHaveCount(0)

  // W-7 開いていたメンバーには M-15 を出して G-3 に移す
  await expect(toast(hanaPage)).toContainText(`ワークスペース「${workspace.name}」は削除されました。`)
  await expect(hanaPage.getByRole('heading', { name: 'ワークスペース', exact: true })).toBeVisible()
})
