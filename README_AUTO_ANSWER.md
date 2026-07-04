# OpenAI APIによる意味検索つき自動回答機能

## 追加した機能
聴衆が質問を送信したとき、`qa-database.json` にある過去質問と「意味が近い」場合に自動回答します。

前の版にあった、文字の一致・部分一致・2文字ずつの比較による判定は削除しました。
この版では OpenAI Embeddings API で質問文をベクトル化し、コサイン類似度で一番近い過去質問を探します。

- 聴衆ページ：送信後、その場で自動回答を表示
- 発表者ページ：質問一覧に「自動回答済み」と回答内容を表示
- サーバー：`POST /api/questions` でOpenAI Embeddingsによる意味検索を実行

## 必要な準備
プロジェクト直下に `.env` ファイルを作って、OpenAI APIキーを書いてください。

```env
OPENAI_API_KEY=sk-ここに自分のAPIキー
EMBEDDING_MODEL=text-embedding-3-small
SEMANTIC_THRESHOLD=0.75
```

`EMBEDDING_MODEL` と `SEMANTIC_THRESHOLD` は省略できます。
省略した場合は以下が使われます。

```env
EMBEDDING_MODEL=text-embedding-3-small
SEMANTIC_THRESHOLD=0.75
```

## 過去質問データベースの書き方
プロジェクト直下の `qa-database.json` を編集します。

```json
[
  {
    "question": "なぜ既存手法ではなく機械学習を選んだのですか？",
    "answer": "既存手法ではルールを人が細かく作る必要がありますが、機械学習を使うとデータから特徴を学習できます。"
  }
]
```

## 実行方法
```bash
npm install
npm start
```

ブラウザで以下を開きます。

- トップページ: http://localhost:3000
- 発表者ページ: http://localhost:3000/presenter.html
- 聴衆ページ: http://localhost:3000/audience.html

## 仕組み
起動時に `qa-database.json` の過去質問をOpenAI Embeddings APIでベクトル化します。
その後、聴衆から新しい質問が送られるたびに、その質問もベクトル化します。

新しい質問ベクトルと過去質問ベクトルを比較し、一番近いものを選びます。
類似度が `SEMANTIC_THRESHOLD` 以上なら、その過去質問の回答を返します。

## 感度の調整
`.env` の `SEMANTIC_THRESHOLD` を変更します。

```env
SEMANTIC_THRESHOLD=0.75
```

目安です。

- `0.80`: 厳しめ。かなり近い質問だけ自動回答
- `0.75`: 標準
- `0.70`: やや感度高め
- `0.65`: かなり感度高め。誤検知が増える可能性あり

変更したら、サーバーを一度止めて再起動してください。

```bash
Control + C
npm start
```

## qa-database.jsonを編集した後
サーバーを再起動するのが一番簡単です。

または、起動中に以下を実行して再読み込みできます。

```bash
curl -X POST http://localhost:3000/api/reload-qa-database
```

## 状態確認
以下をブラウザで開くと、意味検索が有効になっているか確認できます。

```text
http://localhost:3000/api/qa-database
```

`semanticSearchReady` が `true` なら、自動回答が有効です。
