import { useEffect, useRef } from 'react'
import { Picker } from 'emoji-picker-element'
import ja from 'emoji-picker-element/i18n/ja'
// 絵文字のデータ（Emoji 17.0、日本語の名前）。アプリと一緒に配り、外部の CDN から読まない（技術スタック定義書 3.2）
import dataSource from 'emoji-picker-element-data/ja/cldr/data.json?url'
import styles from './EmojiPicker.module.css'
import Popover from './Popover'

// 吹き出しの幅（画面設計書 2.15）
const WIDTH = 352

type Props = {
  // 押したボタン。この近くに出す
  anchor: HTMLElement | null
  // 選んだ絵文字（肌の色を選んでいればその絵文字）。選ぶと閉じる
  onSelect: (emoji: string) => void
  onClose: () => void
}

// 絵文字の一覧（画面設計書 2.15。PF-5・RE-1）。emoji-picker-element（Web Components）を吹き出しの中に置く。
// 検索（日本語の名前）・最近使ったもの・分類のタブ・肌の色の選択は emoji-picker-element が出す
export default function EmojiPicker({ anchor, onSelect, onClose }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const select = useRef(onSelect)
  useEffect(() => {
    select.current = onSelect
  }, [onSelect])

  useEffect(() => {
    const picker = new Picker({ locale: 'ja', dataSource, i18n: ja })
    picker.addEventListener('emoji-click', (e) => {
      if (e.detail.unicode) select.current(e.detail.unicode)
    })
    host.current?.appendChild(picker)
    return () => picker.remove()
  }, [])

  return (
    <Popover anchor={anchor} label="絵文字の一覧" width={WIDTH} className={styles.popover} onClose={onClose}>
      <div ref={host} />
    </Popover>
  )
}
