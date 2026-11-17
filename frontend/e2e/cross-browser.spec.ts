import { chromium, devices, expect, firefox, test, webkit } from '@playwright/test'
import type { Browser, BrowserContextOptions } from '@playwright/test'
import {
  closeContexts, composer, createWorkspace, join, messageItem, openConversation, sendFrom, signup, user,
} from './helpers.ts'

test.afterEach(closeContexts)

// リアルタイムの通信を、違う環境の 2 つのブラウザの間で確かめる（要件定義書 13.1 の手順 2、テスト仕様書 3 章）。
// Edge（pc の project）と、ほかの環境の代わりのブラウザとで、メッセージが互いに開き直さずに出る（MS-5、N-3）。
// 対応環境の代わりのブラウザで流すとき（E2E_BROWSERS=all）だけ、pc の project で動かす。
// pc の project の channel（msedge）が起動の設定に入るので、Firefox・WebKit では channel を消して起動する
const desktop = { viewport: { width: 1280, height: 900 } }
const partners: { name: string, suffix: string, launch: () => Promise<Browser>, use: BrowserContextOptions }[] = [
  { name: 'Chrome', suffix: 'xc', launch: () => chromium.launch({ channel: 'chrome' }), use: desktop },
  { name: 'Firefox', suffix: 'xf', launch: () => firefox.launch({ channel: undefined }), use: desktop },
  { name: 'WebKit', suffix: 'xw', launch: () => webkit.launch({ channel: undefined }), use: desktop },
  { name: 'iPhone 15 のエミュレーション', suffix: 'xi', launch: () => webkit.launch({ channel: undefined }), use: devices['iPhone 15'] },
  { name: 'Pixel 7 のエミュレーション', suffix: 'xp', launch: () => chromium.launch({ channel: 'chrome' }), use: devices['Pixel 7'] },
]

for (const partner of partners) {
  test(`Edge と ${partner.name} の間で、メッセージが開き直さずに出る`, async ({ browser }) => {
    test.skip(process.env.E2E_BROWSERS !== 'all' || test.info().project.name !== 'pc', '対応環境の代わりのブラウザで流すときだけ')
    const other = await partner.launch()
    try {
      const taro = user(`${partner.suffix}a`, 'たろう')
      const hana = user(`${partner.suffix}b`, 'はなこ')
      const page = await signup(browser, taro)
      const hanaPage = await signup(other, hana, partner.use)
      const workspace = await createWorkspace(page, `${partner.name} と`)
      await join(page, workspace, hanaPage)
      await openConversation(page, workspace, workspace.generalConversationId)
      await openConversation(hanaPage, workspace, workspace.generalConversationId)

      await sendFrom(composer(page), `Edge から ${partner.name} へ`)
      await expect(messageItem(hanaPage, taro, `Edge から ${partner.name} へ`)).toBeVisible()
      await sendFrom(composer(hanaPage), `${partner.name} から Edge へ`)
      await expect(messageItem(page, hana, `${partner.name} から Edge へ`)).toBeVisible()
    } finally {
      await closeContexts()
      await other.close()
    }
  })
}
