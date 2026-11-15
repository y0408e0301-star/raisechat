import styles from './CountBadge.module.css'

type Props = {
  count: number
  // 読み上げの名前（「メンション」「未読」）。「メンション 3 件」と読ませる（画面設計書 2.8。色だけで区別しない N-30）
  label: string
  // 置き方を変えるとき（ヘッダーの「@」の右上に重ねるなど）
  className?: string
}

// 件数の丸（画面設計書 2.1）。0 件なら出さない。100 以上は「99+」
export default function CountBadge({ count, label, className }: Props) {
  if (count <= 0) return null
  return (
    <span className={`${styles.count} ${className ?? ''}`} aria-label={`${label} ${count} 件`}>
      {count > 99 ? '99+' : count}
    </span>
  )
}
