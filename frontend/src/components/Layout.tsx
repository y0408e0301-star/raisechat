import { Outlet } from 'react-router'
import AppHeader from './AppHeader'
import styles from './Layout.module.css'

// G-3・G-10 の簡単なヘッダー（画面設計書 2.6）と、横幅 720px の 1 列（2.19）
export default function Layout() {
  return (
    <>
      <AppHeader />
      <main className={styles.container}>
        <Outlet />
      </main>
    </>
  )
}
