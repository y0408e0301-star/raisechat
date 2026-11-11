import ui from '../components/ui.module.css'
import { M } from '../messages'
import styles from './WorkspacesPage.module.css'

// G-3 ワークスペースの一覧画面（画面設計書 5 章）の仮の画面。
// 一覧と「ワークスペースを作る」は、ワークスペース（開発計画書 1-3）で作る
export default function WorkspacesPage() {
  return (
    <>
      <h1 className={styles.title}>ワークスペース</h1>
      <p className={ui.empty}>{M[16]}</p>
    </>
  )
}
