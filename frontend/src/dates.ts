// 日付・日時の表示（画面設計書 2.13）。すべて日本時間で出す（データ設計書 方針 4）

const ZONE = 'Asia/Tokyo'

const parts = (date: Date) => {
  const values = Object.fromEntries(new Intl.DateTimeFormat('ja-JP', {
    timeZone: ZONE, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    second: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(date).map((p) => [p.type, p.value]))
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    hour: values.hour, minute: values.minute, second: values.second, weekday: values.weekday,
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

// 日本時間の日付（同じ日かを比べるため）。例：「2026-11-10」
export function dayKey(iso: string): string {
  const p = parts(new Date(iso))
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

// メッセージの一覧の中の時刻。例：「10:15」
export function formatTime(iso: string): string {
  const p = parts(new Date(iso))
  return `${p.hour}:${p.minute}`
}

// 時刻に重ねたときに出す日時。例：「2026/11/10 10:15:32」
export function formatFull(iso: string): string {
  const p = parts(new Date(iso))
  return `${p.year}/${pad(p.month)}/${pad(p.day)} ${p.hour}:${p.minute}:${p.second}`
}

// 日付の区切り（画面設計書 2.9）。例：「11月10日（月）」、前の年以前は「2025年11月10日（月）」
export function formatDayDivider(iso: string, now: Date = new Date()): string {
  const p = parts(new Date(iso))
  const year = p.year === parts(now).year ? '' : `${p.year}年`
  return `${year}${p.month}月${p.day}日（${p.weekday}）`
}

// 期限・作った日時（画面設計書 13 章）。例：「11月17日 10:15」、前の年以前・次の年以後は「2025年11月17日 10:15」
export function formatDateTime(iso: string, now: Date = new Date()): string {
  const p = parts(new Date(iso))
  const year = p.year === parts(now).year ? '' : `${p.year}年`
  return `${year}${p.month}月${p.day}日 ${p.hour}:${p.minute}`
}
