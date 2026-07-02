// =====================================================
// 発表支援AIアプリ - サーバー (server.js)
// Node.js + Express でローカル動作するデモ用サーバー
// =====================================================

const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

// .envファイルがあれば読み込む（dotenvなしで動く簡易版）
// 例: OPENAI_API_KEY=sk-...
function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const SEMANTIC_THRESHOLD = Number(process.env.SEMANTIC_THRESHOLD || 0.75);

// JSONリクエストを受け取れるようにする
app.use(express.json({ limit: "5mb" }));

// publicフォルダを静的ファイルとして配信
app.use(express.static("public"));


// =====================================================
// 過去質問データベース + OpenAI Embeddingsによる意味検索
// qa-database.json に { "question": "...", "answer": "..." } を追加すると、
// 意味的に近い質問が来たときに自動で回答します。
// =====================================================
const qaDatabasePath = path.join(__dirname, "qa-database.json");

let qaDatabase = [];
let qaEmbeddingIndex = [];
let semanticSearchReady = false;
let semanticSearchError = null;

function loadQaDatabase() {
  try {
    const raw = fs.readFileSync(qaDatabasePath, "utf-8");
    const data = JSON.parse(raw);

    if (!Array.isArray(data)) {
      console.warn("qa-database.json は配列形式にしてください");
      return [];
    }

    return data
      .filter((item) => item.question && item.answer)
      .map((item) => ({
        question: String(item.question),
        answer: String(item.answer),
      }));
  } catch (e) {
    console.warn("qa-database.json を読み込めませんでした。自動回答機能は無効です。", e.message);
    return [];
  }
}

function splitCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  const normalizedText = String(text || "").replace(/^\uFEFF/, "");

  for (let i = 0; i < normalizedText.length; i++) {
    const char = normalizedText[i];
    const next = normalizedText[i + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        field += "\"";
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i++;

      row.push(field);

      if (row.some((cell) => String(cell).trim() !== "")) {
        rows.push(row);
      }

      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);

  if (row.some((cell) => String(cell).trim() !== "")) {
    rows.push(row);
  }

  return rows;
}

function parseQaCsv(csvText) {
  const rows = splitCsvRows(csvText);

  if (rows.length < 2) {
    throw new Error("CSVにはヘッダー行と、少なくとも1件のQ&Aが必要です");
  }

  const headers = rows[0].map((cell) =>
    String(cell || "").trim().toLowerCase()
  );

  const questionIndex = headers.findIndex((h) =>
    ["question", "questions", "q", "質問", "過去質問"].includes(h)
  );

  const answerIndex = headers.findIndex((h) =>
    ["answer", "answers", "a", "回答", "答え"].includes(h)
  );

  if (questionIndex === -1 || answerIndex === -1) {
    throw new Error("CSVの1行目に question,answer または 質問,回答 の列名を入れてください");
  }

  const items = [];
  const seenQuestions = new Set();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    const question = String(row[questionIndex] || "").trim();
    const answer = String(row[answerIndex] || "").trim();

    if (!question && !answer) continue;

    if (!question || !answer) {
      throw new Error(`${i + 1}行目に question または answer がありません`);
    }

    const dedupeKey = question.toLowerCase();

    if (seenQuestions.has(dedupeKey)) {
      continue;
    }

    seenQuestions.add(dedupeKey);

    items.push({
      question,
      answer,
    });
  }

  if (items.length === 0) {
    throw new Error("有効なQ&Aがありません。question と answer の両方を入力してください");
  }

  return items;
}

function saveQaDatabase(items) {
  fs.writeFileSync(
    qaDatabasePath,
    JSON.stringify(items, null, 2),
    "utf-8"
  );
}

async function createEmbeddings(inputs) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY が設定されていません");
  }

  if (!Array.isArray(inputs) || inputs.length === 0) {
    return [];
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: inputs,
      encoding_format: "float",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI Embeddings API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.data
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function rebuildQaEmbeddingIndex() {
  qaDatabase = loadQaDatabase();
  qaEmbeddingIndex = [];
  semanticSearchReady = false;
  semanticSearchError = null;

  if (qaDatabase.length === 0) {
    console.warn("qa-database.json に有効なQ&Aがありません。自動回答機能は無効です。");
    return;
  }

  if (!OPENAI_API_KEY) {
    semanticSearchError = "OPENAI_API_KEY が設定されていません";
    console.warn("⚠️ OPENAI_API_KEY が未設定のため、意味検索による自動回答は無効です。");
    console.warn("   .env に OPENAI_API_KEY=sk-... を書いてから再起動してください。");
    return;
  }

  try {
    const questionEmbeddings = await createEmbeddings(qaDatabase.map((item) => item.question));

    qaEmbeddingIndex = qaDatabase
      .map((item, index) => ({
        ...item,
        embedding: questionEmbeddings[index],
      }))
      .filter((item) => Array.isArray(item.embedding));

    semanticSearchReady = qaEmbeddingIndex.length > 0;
    console.log(`🤖 意味検索インデックスを作成しました: ${qaEmbeddingIndex.length}件 / model=${EMBEDDING_MODEL} / threshold=${SEMANTIC_THRESHOLD}`);
  } catch (e) {
    semanticSearchError = e.message;
    console.warn("⚠️ 意味検索インデックスの作成に失敗しました:", e.message);
  }
}

async function findAutoAnswer(text) {
  if (!semanticSearchReady || qaEmbeddingIndex.length === 0) {
    return null;
  }

  const [questionEmbedding] = await createEmbeddings([text]);
  let best = null;

  for (const item of qaEmbeddingIndex) {
    const similarity = cosineSimilarity(questionEmbedding, item.embedding);
    if (!best || similarity > best.similarity) {
      best = {
        question: item.question,
        answer: item.answer,
        similarity,
      };
    }
  }

  // Embeddingsのコサイン類似度がしきい値以上なら、意味的に近い過去質問として扱う
  if (best && best.similarity >= SEMANTIC_THRESHOLD) {
    return {
      answer: best.answer,
      matchedQuestion: best.question,
      similarity: Number(best.similarity.toFixed(3)),
      method: "openai-embeddings",
    };
  }

  return null;
}

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
app.post("/api/questions", async (req, res) => {
  const { text } = req.body;
  if (!text || text.trim() === "") {
    return res.status(400).json({ error: "質問内容を入力してください" });
  }

  const trimmedText = text.trim();
  let autoAnswer = null;

  try {
    autoAnswer = await findAutoAnswer(trimmedText);
  } catch (e) {
    // OpenAI APIの一時的な失敗で質問送信自体が止まらないようにする
    console.warn("自動回答の意味検索に失敗しました:", e.message);
  }

  const newQuestion = {
    id: Date.now(),
    text: trimmedText,
    createdAt: new Date().toLocaleString("ja-JP"),
    autoAnswered: Boolean(autoAnswer),
    answer: autoAnswer ? autoAnswer.answer : null,
    matchedQuestion: autoAnswer ? autoAnswer.matchedQuestion : null,
    similarity: autoAnswer ? autoAnswer.similarity : null,
    matchMethod: autoAnswer ? autoAnswer.method : null,
  };

  questions.push(newQuestion);
  res.json({ success: true, question: newQuestion, autoAnswer });
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

// GET /api/qa-database - 過去質問データベースを取得
app.get("/api/qa-database", (req, res) => {
  res.json({
    count: qaDatabase.length,
    indexedCount: qaEmbeddingIndex.length,
    semanticSearchReady,
    semanticSearchError,
    model: EMBEDDING_MODEL,
    threshold: SEMANTIC_THRESHOLD,
    items: qaDatabase,
  });
});

// POST /api/upload-qa-database - CSVを受け取り、過去質問データベースを更新
app.post("/api/upload-qa-database", async (req, res) => {
  const { csvText } = req.body || {};

  if (!csvText || String(csvText).trim() === "") {
    return res.status(400).json({
      success: false,
      error: "CSVファイルの中身が空です",
    });
  }

  try {
    const items = parseQaCsv(csvText);

    saveQaDatabase(items);

    await rebuildQaEmbeddingIndex();

    res.json({
      success: true,
      count: qaDatabase.length,
      indexedCount: qaEmbeddingIndex.length,
      semanticSearchReady,
      semanticSearchError,
      model: EMBEDDING_MODEL,
      threshold: SEMANTIC_THRESHOLD,
    });
  } catch (e) {
    console.warn("CSVアップロード処理に失敗しました:", e.message);

    res.status(400).json({
      success: false,
      error: e.message,
    });
  }
});

// POST /api/reload-qa-database - qa-database.jsonを再読み込みして意味検索インデックスも作り直す
app.post("/api/reload-qa-database", async (req, res) => {
  await rebuildQaEmbeddingIndex();
  res.json({
    success: semanticSearchReady,
    count: qaDatabase.length,
    indexedCount: qaEmbeddingIndex.length,
    semanticSearchReady,
    semanticSearchError,
    model: EMBEDDING_MODEL,
    threshold: SEMANTIC_THRESHOLD,
  });
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
async function startServer() {
  await rebuildQaEmbeddingIndex();

  app.listen(PORT, () => {
    console.log(`✅ サーバーが起動しました`);
    console.log(`👉 http://localhost:${PORT} をブラウザで開いてください`);
    console.log(`📱 聴衆ページ: http://localhost:${PORT}/audience.html`);
    console.log(`-----------------------------------------`);
    console.log(`スマホからアクセスする場合は、PCのIPアドレスを使用してください`);
    console.log(`例: http://192.168.x.x:${PORT}`);
  });
}

startServer();
