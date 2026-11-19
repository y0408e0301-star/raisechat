# 文書一覧：チャットアプリ（RaiseChat）

## 文書の構成

```
docs/
├── README.md                          … 本書（文書一覧）
├── requirements/                      … 要件定義書（何を作るか）
│   ├── requirements.md                … 本体（概要・機能一覧・各文書へのリンク）
│   ├── screens.md                     … 画面一覧
│   └── data-requirements.md           … データ要件定義書
├── functions/                         … 機能定義書（機能ごとに何をするか）
│   ├── function-definition.md         … 本体（共通の決まり・API とリアルタイムの通知の共通仕様・メッセージ一覧）
│   ├── fn01-auth.md                   … FN-01 ユーザー登録・ログイン
│   ├── fn02-profile.md                … FN-02 プロフィール
│   ├── fn03-workspace.md              … FN-03 ワークスペース
│   ├── fn04-invite.md                 … FN-04 招待
│   ├── fn05-member.md                 … FN-05 メンバー管理
│   ├── fn06-channel.md                … FN-06 チャンネル
│   ├── fn07-message.md                … FN-07 メッセージ
│   ├── fn08-thread.md                 … FN-08 スレッド
│   ├── fn09-attachment.md             … FN-09 画像・動画の添付
│   ├── fn10-reaction.md               … FN-10 絵文字リアクション
│   ├── fn11-mention.md                … FN-11 メンション
│   ├── fn12-dm.md                     … FN-12 ダイレクトメッセージ
│   ├── fn13-search.md                 … FN-13 メッセージ検索
│   └── fn14-notification.md           … FN-14 通知
├── design/                            … 基本設計書（画面・データ・インフラの設計）
│   ├── basic-design.md                … 本体（概要・これから行う設計・設計中に見つかった要件の不足と対応）
│   ├── screen-design.md               … 画面設計書
│   ├── data-design.md                 … データ設計書
│   └── infra-design.md                … インフラ設計書
├── test/
│   ├── test-specification.md          … テスト仕様書（方針・環境ごとの結果・手動の項目）
│   ├── requirement-coverage.md        … 要件 ID とテストの対応表（スクリプトで作る。手で直さない）
│   ├── performance-test-report.md     … 性能試験報告書（公開先で測った結果と合否）
│   └── acceptance-report.md           … 検収書（合格の条件の確認と署名）
├── manual/
│   └── operation-manual.md            … 操作マニュアル（利用者向けの使い方）
├── tech-stack.md                      … 技術スタック定義書
└── development-plan.md                … 開発計画書（作る順番と進み具合）
```

| 文書 | 文書番号 | 内容 | 承認 |
| --- | --- | --- | --- |
| [要件定義書](requirements/requirements.md) | RC-REQ | 背景・目的、範囲、利用者、前提、用語、機能一覧、非機能要件、検収、納品、運用・保守、変更管理 | 要件定義書の本体で、詳細文書とまとめて行う |
| [画面一覧](requirements/screens.md) | RC-REQ-SCR | 画面一覧、画面遷移、チャット画面のイメージ | 〃 |
| [データ要件定義書](requirements/data-requirements.md) | RC-REQ-DATA | 扱うデータの項目、上限、保存する個人情報 | 〃 |
| [機能定義書](functions/function-definition.md) | RC-FD | 機能ごとの文書の章立て、画面と API の共通の決まり、リアルタイムの通知の共通の決まり、メッセージ一覧 | 機能定義書の本体で、機能ごとの文書とまとめて行う |
| [FN-01〜FN-14 の機能定義書](functions/function-definition.md#12-機能定義書の構成) | RC-FD-01〜14 | 機能ごとの機能要件、処理の流れ、入力の確認、業務ルール、API（案）、使うデータ、権限、エラー、テストの観点 | 〃 |
| [基本設計書](design/basic-design.md) | RC-BD | 概要、これから行う設計、設計中に見つかった要件の不足と対応。詳細文書は画面設計書・データ設計書・インフラ設計書 | 基本設計書の本体で、詳細文書とまとめて行う |
| [画面設計書](design/screen-design.md) | RC-BD-SCR | 共通仕様（色・文字・ボタン・メッセージ・共通の部品・画面の幅）、画面ごとのレイアウト・表示項目・操作 | 〃 |
| [データ設計書](design/data-design.md) | RC-BD-DATA | 方針、エンティティ一覧、ER 図、テーブル定義、索引、データのルール（BR）、特別な SQL、CRUD 表、データ量の見積もり | 〃 |
| [インフラ設計書](design/infra-design.md) | RC-BD-INFRA | 方針、AWS の構成図、リソース一覧、セキュリティグループ（SG）、WebSocket と添付の流れ、開発環境との対応、費用の目安 | 〃 |
| [テスト仕様書](test/test-specification.md) | RC-TEST | テストの方針、要件 ID・テストの観点とテストの対応、環境ごとの結果、手動で確かめる項目 | 本書で行う |
| [要件 ID とテストの対応表](test/requirement-coverage.md) | — | 要件 ID・テストの観点ごとに、確かめるテストの一覧。テスト仕様書 2 章のとおりスクリプトで作る | 要らない（コードと同じ） |
| [性能試験報告書](test/performance-test-report.md) | RC-TEST-PERF | 公開先（AWS）で測った性能（N-1〜N-7）の結果と合否、目標を超えたものの扱い | 本書で行う |
| [検収書](test/acceptance-report.md) | RC-TEST-ACC | 要件定義書 13.4 の合格の条件ごとの確認、検収の結果と署名 | 署名で行う |
| [操作マニュアル](manual/operation-manual.md) | RC-MAN | 利用者向けの使い方（招待リンクの渡し方、ブラウザの通知の許可のしかたと共用のパソコンでの注意、DM を見られる人を含む）、メッセージが出たときにすること | 本書で行う |
| [技術スタック定義書](tech-stack.md) | RC-TECH | 使う言語・フレームワーク・サービス・開発ツールと選んだ理由 | 本書で行う |
| [開発計画書](development-plan.md) | RC-PLAN | 作る順番（段階と Pull Request の単位）、段階ごとの完了条件、どこまでできたか | 本書で行う |

文書は BookLog（読書記録アプリ）・Raise timeline（タイムライン型 SNS）と同じ構成で作る。

## 読む順番

1. [要件定義書](requirements/requirements.md)：全体像と機能一覧（8 章）をつかむ
2. 必要に応じて、要件定義書の詳細文書（[画面一覧](requirements/screens.md)・[データ要件定義書](requirements/data-requirements.md)）
3. [機能定義書](functions/function-definition.md)：共通の決まりを読み、作る機能の文書（FN-01〜FN-14）を読む

1 つの機能を作るときは、その機能の機能定義書と、そこから参照している章を読めばよい。

## ID の一覧

文書の中で使う ID と、それを定めている文書である。

| ID | 意味 | 定めている文書 |
| --- | --- | --- |
| P-1〜 | 前提条件・制約 | 要件定義書 4 章 |
| FN-01〜 | 機能 | 要件定義書 8 章（機能一覧） |
| N-1〜 | 非機能要件 | 要件定義書 11 章 |
| R-1〜 | リスク | 要件定義書 12 章 |
| U-1〜 | 未決事項 | 要件定義書 17 章 |
| G-1〜 | 画面 | 画面一覧 1 章 |
| A・PF・W・I・MB・CH・MS・TH・AT・RE・MN・DM・SR・NT | 機能要件（登録・ログイン、プロフィール、ワークスペース、招待、メンバー管理、チャンネル、メッセージ、スレッド、添付、リアクション、メンション、DM、検索、通知） | 各機能定義書 2 章（A は FN-01、PF は FN-02 … NT は FN-14） |
| M-1〜 | メッセージ | 機能定義書 5 章 |
| Q-1〜 | 設計中に見つかった要件の不足と対応 | 基本設計書 3 章 |
| BR-1〜 | データのルール | データ設計書 7 章 |
| SG-1〜 | セキュリティグループ | インフラ設計書 4 章 |
| TC-01-1〜 | テストの観点（機能の番号と連番） | 機能定義書 FN-01〜FN-14 の 10 章 |

## 文書の書き方のルール

- 文書はすべて Markdown で書き、このフォルダーに置く。図は Mermaid 記法かテキストで書き、画像ファイルにしない（GitHub 上で読めて、差分も追えるようにする）
- 同じ内容を 2 か所に詳しく書かない。本体の文書には概要とリンクだけを書き、詳しい内容は詳細文書に書く
- 文書ごとに版数と改訂履歴を持つ。詳細文書を変えたときは、本体の版数も上げて改訂履歴に記録する
- ほかの文書を参照するときは、ID（例：P-3）か「文書名＋章番号」で書く
