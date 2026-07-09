# UI統合版について

この版では、`soft-team-app-main` のサーバー/API機能を残したまま、`slide_qa_ai_single_html_mock` の見た目に近いUIへ変更しています。

## 残している主な機能

- 聴衆ページからの質問送信
- 発表者ページでの質問一覧表示
- 10秒ごとの質問自動更新
- デモ質問追加
- 質問リセット
- Q&A CSVアップロード
- 過去質問DBとの意味検索による自動回答（OPENAI_API_KEY設定時）
- AI質問整理モック

## 主な変更ファイル

- `public/index.html`: UI案のログイン風トップ画面に変更
- `public/qa-entry.html`: UI案のプロジェクト管理風画面に変更
- `public/presenter.html`: UI案の3カラム発表者画面に変更
- `public/audience.html`: UI案の聴衆画面に変更
- `public/style.css`: UI案のデザインをベースに再構成
- `public/script.js`: 既存API連携を維持しつつ、新UIのID・統計表示・画面遷移に対応

## 実行方法

```bash
npm install
npm start
```

ブラウザで以下を開きます。

```text
http://localhost:3000
```

スマホからアクセスする場合は、PCとスマホを同じWi-Fiに接続し、発表者画面のQRコードまたはPCのローカルIPアドレスを使ってください。
