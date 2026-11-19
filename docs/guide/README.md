# 開発者向けガイド

手元で開発・テスト・公開するときの手順。何を作るか・どう作るかは [docs/README.md](../README.md) の文書に、最短の起動手順は[リポジトリの README](../../README.md) にある。

| ガイド | 内容 |
| --- | --- |
| [開発環境](development.md) | 必要なもの、初回の準備、アバター・添付の置き場所（S3）、起動と停止、開発の設定、API の仕様書（OpenAPI）、ログ |
| [テストとコードチェック](testing.md) | API・画面のテストの種類、書式・lint・静的解析、画面を通したテスト（E2E）、画面も入れた jar |
| [性能テスト](performance.md) | k6・Playwright での測り方、手元・GitHub Actions・公開先で動かす手順 |
| [公開環境](deploy.md) | 反映・起動・停止のスクリプト、公開の注意 |
