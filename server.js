// =====================================================
// 発表支援AIアプリ - サーバー (server.js)
// Node.js + Express でローカル動作するデモ用サーバー
// =====================================================

const express = require("express");
const app = express();
const PORT = 3000;

// JSONリクエストを受け取れるようにする
app.use(express.json());

// publicフォルダを静的ファイルとして配信
app.use(express.static("public"));

// =====================================================
// データ保存（メモリ上の配列 - 再起動でリセット）
// =====================================================
let questions = [];

// =====================================================
// AIモック関数
// 将来的にここをClaude APIやOpenAI APIに差し替える
// =====================================================

/**
 * 質問整理のモック関数
 * 将来: この関数内をAnthropic/OpenAI APIの呼び出しに置き換える
 * @param {Array} questions - 質問の配列
 * @returns {Array} - グループ化・整理された結果
 */
function analyzeQuestionsMock(questions) {
  // 将来のAPI差し替えポイント:
  // const response = await anthropic.messages.create({ ... });
  // return JSON.parse(response.content[0].text);

  return [
    {
      category: "手法の選定理由",
      type: "理解確認質問",
      priority: "高",
      count: 2,
      summary:
        "なぜ機械学習を使ったのか、既存手法ではなくこの手法を選んだ理由についての質問が複数あります。",
      hint: "既存手法との違いと、この手法を選んだ理由を最初に説明するとよいです。",
    },
    {
      category: "データについて",
      type: "詳細質問",
      priority: "中",
      count: 3,
      summary:
        "データセットの取得方法、サンプル数、信頼性についての質問です。",
      hint: "データの出典、件数、集め方を簡単に説明するとよいです。",
    },
    {
      category: "評価方法",
      type: "比較質問",
      priority: "中",
      count: 2,
      summary: "精度の評価方法や他の手法との比較についての質問です。",
      hint: "評価指標と比較対象を示すと説得力が出ます。",
    },
    {
      category: "今後の展望",
      type: "実用性質問",
      priority: "低",
      count: 2,
      summary: "研究の限界や実用化の可能性についての質問です。",
      hint: "現時点での課題と、今後改善したい点を説明するとよいです。",
    },
  ];
}

/**
 * スライド分析のモック関数
 * 将来: この関数内をAnthropic/OpenAI APIの呼び出しに置き換える
 * @param {string} slideText - スライドのテキスト
 * @returns {Object} - 分析結果
 */
function analyzeSlideMock(slideText) {
  // 将来のAPI差し替えポイント:
  // const response = await anthropic.messages.create({ ... });
  // return JSON.parse(response.content[0].text);

  return {
    predictedQuestions: [
      { question: "なぜBERTを使ったのですか？", difficulty: "普通" },
      {
        question:
          "87%から93%への向上は、どの程度大きな改善と言えますか？",
        difficulty: "難しい",
      },
      {
        question:
          "IMDbとSST-2以外のデータセットでも同じ結果になりますか？",
        difficulty: "難しい",
      },
      {
        question: "GPUがない環境でも動作しますか？",
        difficulty: "普通",
      },
    ],
    terms: [
      {
        term: "BERT",
        explanation:
          "文章の文脈を考慮して意味を理解するAIモデルです。Googleが開発しました。",
      },
      {
        term: "ファインチューニング",
        explanation:
          "既に学習済みのAIモデルを、特定の目的に合わせて追加学習させることです。",
      },
      {
        term: "5-fold交差検証",
        explanation:
          "データを5分割し、学習と評価を繰り返して性能を確認する方法です。",
      },
      {
        term: "SVM（サポートベクターマシン）",
        explanation:
          "データを分類するための機械学習アルゴリズムの一種です。",
      },
    ],
    supplements: [
      {
        point: "BERTを選んだ理由",
        suggestion:
          "従来手法より文章の前後関係を考慮できる点を補足するとよいです。",
      },
      {
        point: "精度向上の意味",
        suggestion:
          "87%から93%への改善が、実際にどのような効果を持つのか説明すると伝わりやすくなります。",
      },
      {
        point: "評価データセット",
        suggestion:
          "IMDbやSST-2がどのようなデータなのかを一言説明するとよいです。",
      },
    ],
  };
}

// =====================================================
// デモ質問データ
// =====================================================
const demoQuestions = [
  "なぜ既存手法ではなく機械学習を選んだのですか？",
  "機械学習を使うメリットは何ですか？",
  "データセットはどこから取得しましたか？",
  "サンプル数は十分ですか？",
  "データの信頼性はどのように確認しましたか？",
  "精度はどのように評価しましたか？",
  "他の手法との比較実験はしましたか？",
  "この研究の限界は何ですか？",
  "実用化する場合、どのような課題がありますか？",
];

// =====================================================
// API エンドポイント
// =====================================================

// GET /api/questions - 質問一覧を取得
app.get("/api/questions", (req, res) => {
  res.json({ questions });
});

// POST /api/questions - 質問を追加（聴衆が送信）
app.post("/api/questions", (req, res) => {
  const { text } = req.body;
  if (!text || text.trim() === "") {
    return res.status(400).json({ error: "質問内容を入力してください" });
  }
  const newQuestion = {
    id: Date.now(),
    text: text.trim(),
    createdAt: new Date().toLocaleString("ja-JP"),
  };
  questions.push(newQuestion);
  res.json({ success: true, question: newQuestion });
});

// DELETE /api/questions - 質問をリセット
app.delete("/api/questions", (req, res) => {
  questions = [];
  res.json({ success: true });
});

// POST /api/demo-questions - デモ質問を追加
app.post("/api/demo-questions", (req, res) => {
  const added = demoQuestions.map((text) => ({
    id: Date.now() + Math.random(),
    text,
    createdAt: new Date().toLocaleString("ja-JP"),
  }));
  questions.push(...added);
  res.json({ success: true, added: added.length });
});

// POST /api/analyze-questions - 質問を整理（AIモック）
app.post("/api/analyze-questions", (req, res) => {
  if (questions.length === 0) {
    return res.status(400).json({ error: "質問がありません" });
  }
  const result = analyzeQuestionsMock(questions);
  res.json({ success: true, result });
});

// POST /api/analyze-slide - スライドを分析（AIモック）
app.post("/api/analyze-slide", (req, res) => {
  const { text } = req.body;
  if (!text || text.trim() === "") {
    return res.status(400).json({ error: "スライドのテキストを入力してください" });
  }
  const result = analyzeSlideMock(text.trim());
  res.json({ success: true, result });
});

// =====================================================
// サーバー起動
// =====================================================
app.listen(PORT, () => {
  console.log(`✅ サーバーが起動しました`);
  console.log(`👉 http://localhost:${PORT} をブラウザで開いてください`);
  console.log(`📱 聴衆ページ: http://localhost:${PORT}/audience.html`);
  console.log(`-----------------------------------------`);
  console.log(`スマホからアクセスする場合は、PCのIPアドレスを使用してください`);
  console.log(`例: http://192.168.x.x:${PORT}`);
});