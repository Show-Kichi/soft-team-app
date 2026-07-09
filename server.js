// =====================================================
// 発表支援AIアプリ - サーバー (server.js)
// Node.js + Express でローカル動作するデモ用サーバー
// =====================================================

const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const pdfParseModule = require("pdf-parse");
const mammoth = require("mammoth");
const AdmZip = require("adm-zip");

const app = express();
const DEFAULT_PORT = Number(process.env.PORT || 3000);
let PORT = DEFAULT_PORT;

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
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const uploadRoot = path.join(__dirname, "uploads");
const slideUploadDir = path.join(uploadRoot, "slides");
fs.mkdirSync(slideUploadDir, { recursive: true });

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
app.use(express.json({ limit: "10mb" }));

// publicフォルダとアップロード済みスライドを静的ファイルとして配信
app.use(express.static("public"));
app.use("/uploads", express.static(uploadRoot));


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
// スライドアップロード・現在スライド・逆質問の状態
// =====================================================
const slideStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, slideUploadDir),
  filename: (req, file, cb) => {
    const safeBase = path
      .basename(file.originalname || "slide")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 120);
    const ext = path.extname(safeBase) || "";
    const base = path.basename(safeBase, ext) || "slide";
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${base}${ext}`);
  },
});

const uploadSlideFile = multer({
  storage: slideStorage,
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const allowedExts = new Set([
      ".pdf", ".pptx", ".ppt", ".png", ".jpg", ".jpeg", ".webp",
      ".txt", ".md", ".markdown", ".docx"
    ]);
    if (allowedExts.has(ext)) return cb(null, true);
    cb(new Error("対応している形式は PDF / PPTX / 画像 / TXT / MD / DOCX です"));
  },
});

let currentSlide = null;
let currentReverseQuestion = null;
let reverseQuestionAnswers = [];

function decodeXmlEntities(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripXmlTags(text) {
  return decodeXmlEntities(String(text || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function extractTextFromPptx(filePath) {
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries()
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));

  const slideTexts = [];
  for (const entry of entries) {
    const xml = entry.getData().toString("utf-8");
    const matches = [...xml.matchAll(/<a:t>(.*?)<\/a:t>/g)].map((m) => decodeXmlEntities(m[1]));
    const text = matches.join(" ").replace(/\s+/g, " ").trim();
    if (text) slideTexts.push(text);
  }
  return slideTexts.map((text, index) => `Slide ${index + 1}: ${text}`).join("\n");
}

async function extractSlideText(file) {
  const ext = path.extname(file.originalname || file.filename || "").toLowerCase();
  const mimeType = file.mimetype || "application/octet-stream";
  const buffer = fs.readFileSync(file.path);

  try {
    if (mimeType.startsWith("text/") || [".txt", ".md", ".markdown"].includes(ext)) {
      return buffer.toString("utf-8");
    }

    if (ext === ".pdf" || mimeType === "application/pdf") {
      const pdfParse = pdfParseModule.default || pdfParseModule;
      const parsed = await pdfParse(buffer);
      return parsed.text || "";
    }

    if (ext === ".pptx") {
      return extractTextFromPptx(file.path);
    }

    if (ext === ".docx") {
      const result = await mammoth.extractRawText({ path: file.path });
      return result.value || "";
    }
  } catch (e) {
    console.warn("スライドからテキストを抽出できませんでした:", e.message);
    return "";
  }

  return "";
}

async function getPdfPageCount(file) {
  const ext = path.extname(file.originalname || file.filename || "").toLowerCase();
  const mimeType = file.mimetype || "application/octet-stream";

  if (ext !== ".pdf" && mimeType !== "application/pdf") {
    return 1;
  }

  try {
    const buffer = fs.readFileSync(file.path);
    const pdfParse = pdfParseModule.default || pdfParseModule;
    const parsed = await pdfParse(buffer);
    return Math.max(1, Number(parsed.numpages || parsed.numPages || 1) || 1);
  } catch (e) {
    console.warn("PDFのページ数を取得できませんでした:", e.message);
    return 1;
  }
}

function normalizeSlideText(text, maxLength = 12000) {
  const normalized = String(text || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength) + "\n...（長いため一部省略）";
}

function publicSlideInfo(slide = currentSlide) {
  if (!slide) return null;

  const pageCount = Math.max(1, Number(slide.pageCount || 1) || 1);
  const currentPage = Math.max(1, Math.min(Number(slide.currentPage || 1) || 1, pageCount));

  return {
    id: slide.id,
    originalName: slide.originalName,
    mimeType: slide.mimeType,
    ext: slide.ext,
    url: slide.url,
    uploadedAt: slide.uploadedAt,
    notes: slide.notes,
    textLength: slide.textLength,
    textPreview: slide.textPreview,
    displayType: slide.displayType,
    currentPage,
    pageCount,
  };
}

function getDisplayType(mimeType, ext) {
  if (mimeType === "application/pdf" || ext === ".pdf") return "pdf";
  if (mimeType.startsWith("image/") || [".png", ".jpg", ".jpeg", ".webp"].includes(ext)) return "image";
  if (mimeType.startsWith("text/") || [".txt", ".md", ".markdown"].includes(ext)) return "text";
  return "preview";
}

function isImageSlide(slide) {
  return Boolean(slide && slide.mimeType && slide.mimeType.startsWith("image/"));
}

function getImageDataUrlForOpenAI(slide) {
  if (!isImageSlide(slide) || !slide.filePath) return null;
  const stat = fs.statSync(slide.filePath);
  // 画像をBase64でAPIに渡すため、あまり大きいものは送らない
  if (stat.size > 8 * 1024 * 1024) return null;
  const buffer = fs.readFileSync(slide.filePath);
  return `data:${slide.mimeType};base64,${buffer.toString("base64")}`;
}

function extractJsonFromText(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch (e) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw e;
    return JSON.parse(match[0]);
  }
}

function createReverseQuestionMock(slide, audienceQuestions) {
  const latestQuestions = audienceQuestions.slice(-5).map((q) => q.text).join(" / ");
  const hasQuestions = audienceQuestions.length > 0;
  const slideTitle = slide ? slide.originalName : "現在のスライド";

  return {
    question: hasQuestions
      ? "今の説明の中で、みなさんが一番理解しづらかったポイントは『手法を選んだ理由』『評価方法』『実用化の課題』のどれに近いですか？理由も一言で答えてください。"
      : "このスライドの内容を一文で説明するとしたら、どの部分が一番重要だと思いますか？",
    intent: "聴衆がどの部分でつまずいているかを確認するための逆質問です。",
    whyThisQuestion: hasQuestions
      ? `聴衆からの質問に共通して、理解が曖昧そうな点が含まれているためです。関連質問: ${latestQuestions}`
      : "まだ質問が少ないため、スライドの中心内容を理解できているか確認します。",
    expectedAnswer: "聴衆が自分の言葉で、理解できている点・曖昧な点を短く答えることを想定しています。",
    slideFocus: slideTitle,
    relatedAudienceQuestions: audienceQuestions.slice(-3).map((q) => q.text),
    method: "mock",
  };
}

async function createReverseQuestionWithOpenAI(slide, audienceQuestions) {
  if (!OPENAI_API_KEY) {
    return createReverseQuestionMock(slide, audienceQuestions);
  }

  const slideText = normalizeSlideText([slide?.notes, slide?.extractedText].filter(Boolean).join("\n\n"));
  const questionLines = audienceQuestions.length
    ? audienceQuestions.map((q, index) => `${index + 1}. ${q.text}`).join("\n")
    : "まだ聴衆からの質問はありません。";

  const prompt = `
あなたはスライド発表を支援する教育向けAIです。
発表者は、聴衆からの質問を見ながら、理解が浅そうな部分を確認するために聴衆へ「逆質問」を1つだけ投げかけたいです。

条件:
- 聴衆を責める口調ではなく、答えやすい確認質問にする
- 質問は1つだけ
- 選択肢つき、または短文で答えられる形式が望ましい
- スライド内容と聴衆質問の両方を考慮する
- 特に、聴衆質問から「まだ分かっていなさそうな点」を推測する
- 日本語で出力する
- JSONだけを返す

返すJSON形式:
{
  "question": "聴衆に表示する逆質問",
  "intent": "この逆質問の目的",
  "whyThisQuestion": "なぜこの質問を選んだか",
  "expectedAnswer": "想定される答え・確認したい理解",
  "slideFocus": "関係するスライド内容",
  "relatedAudienceQuestions": ["関係する聴衆質問"]
}

スライドファイル名: ${slide?.originalName || "未アップロード"}
スライド補足メモ・抽出テキスト:
${slideText || "画像またはテキスト抽出できない形式です。ファイル名と聴衆質問から判断してください。"}

聴衆からの質問:
${questionLines}
`.trim();

  const imageDataUrl = getImageDataUrlForOpenAI(slide);
  const userContent = imageDataUrl
    ? [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ]
    : prompt;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          {
            role: "system",
            content: "あなたは発表者を支援するAIです。必ず有効なJSONだけを返してください。",
          },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    const parsed = extractJsonFromText(content);

    return {
      question: String(parsed.question || "").trim(),
      intent: String(parsed.intent || "").trim(),
      whyThisQuestion: String(parsed.whyThisQuestion || "").trim(),
      expectedAnswer: String(parsed.expectedAnswer || "").trim(),
      slideFocus: String(parsed.slideFocus || "").trim(),
      relatedAudienceQuestions: Array.isArray(parsed.relatedAudienceQuestions)
        ? parsed.relatedAudienceQuestions.map((item) => String(item)).slice(0, 5)
        : [],
      method: "openai",
    };
  } catch (e) {
    console.warn("逆質問のOpenAI生成に失敗しました。モックに切り替えます:", e.message);
    const mock = createReverseQuestionMock(slide, audienceQuestions);
    mock.method = "mock-fallback";
    mock.error = e.message;
    return mock;
  }
}

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


// GET /api/current-slide - 現在のスライド情報を取得
app.get("/api/current-slide", (req, res) => {
  res.json({ success: true, slide: publicSlideInfo() });
});

// POST /api/slides/page/previous - 現在のPDFページを1つ戻す
app.post("/api/slides/page/previous", (req, res) => {
  if (!currentSlide) {
    return res.status(404).json({ success: false, error: "表示中のスライドがありません" });
  }

  const pageCount = Math.max(1, Number(currentSlide.pageCount || 1) || 1);
  currentSlide.pageCount = pageCount;
  currentSlide.currentPage = Math.max(1, (Number(currentSlide.currentPage || 1) || 1) - 1);
  res.json({ success: true, slide: publicSlideInfo() });
});

// POST /api/slides/page/next - 現在のPDFページを1つ進める
app.post("/api/slides/page/next", (req, res) => {
  if (!currentSlide) {
    return res.status(404).json({ success: false, error: "表示中のスライドがありません" });
  }

  const pageCount = Math.max(1, Number(currentSlide.pageCount || 1) || 1);
  currentSlide.pageCount = pageCount;
  currentSlide.currentPage = Math.min(pageCount, (Number(currentSlide.currentPage || 1) || 1) + 1);
  res.json({ success: true, slide: publicSlideInfo() });
});

// POST /api/slides/upload - スライドをアップロードして現在スライドに設定
app.post("/api/slides/upload", (req, res) => {
  uploadSlideFile.single("slide")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ success: false, error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: "スライドファイルを選択してください" });
    }

    try {
      const ext = path.extname(req.file.originalname || req.file.filename || "").toLowerCase();
      const extractedText = await extractSlideText(req.file);
      const notes = String(req.body.notes || "").trim();
      const displayType = getDisplayType(req.file.mimetype || "", ext);
      const pageCount = displayType === "pdf" ? await getPdfPageCount(req.file) : 1;

      currentSlide = {
        id: Date.now(),
        originalName: req.file.originalname || req.file.filename,
        storedName: req.file.filename,
        filePath: req.file.path,
        mimeType: req.file.mimetype || "application/octet-stream",
        ext,
        url: `/uploads/slides/${encodeURIComponent(req.file.filename)}`,
        uploadedAt: new Date().toLocaleString("ja-JP"),
        notes,
        extractedText,
        textLength: extractedText.length,
        textPreview: normalizeSlideText(extractedText, 500),
        displayType,
        currentPage: 1,
        pageCount,
      };

      currentReverseQuestion = null;
      reverseQuestionAnswers = [];

      res.json({
        success: true,
        slide: publicSlideInfo(),
        message: extractedText
          ? `スライドをアップロードしました。${extractedText.length}文字のテキストを抽出しました。`
          : "スライドをアップロードしました。テキスト抽出できない形式の場合は、補足メモをAI入力に使います。",
      });
    } catch (e) {
      console.warn("スライドアップロード処理に失敗しました:", e.message);
      res.status(500).json({ success: false, error: "スライドの処理に失敗しました" });
    }
  });
});

// POST /api/reverse-question/generate - 発表者の操作で逆質問を生成・配信
app.post("/api/reverse-question/generate", async (req, res) => {
  if (!currentSlide) {
    return res.status(400).json({ success: false, error: "先にスライドをアップロードしてください" });
  }

  try {
    const result = await createReverseQuestionWithOpenAI(currentSlide, questions);

    if (!result.question) {
      throw new Error("逆質問の本文を生成できませんでした");
    }

    currentReverseQuestion = {
      id: Date.now(),
      question: result.question,
      intent: result.intent,
      whyThisQuestion: result.whyThisQuestion,
      expectedAnswer: result.expectedAnswer,
      slideFocus: result.slideFocus,
      relatedAudienceQuestions: result.relatedAudienceQuestions || [],
      method: result.method,
      error: result.error || null,
      slideId: currentSlide.id,
      slideName: currentSlide.originalName,
      createdAt: new Date().toLocaleString("ja-JP"),
    };
    reverseQuestionAnswers = [];

    res.json({ success: true, reverseQuestion: currentReverseQuestion });
  } catch (e) {
    console.warn("逆質問生成に失敗しました:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/reverse-question - 聴衆・発表者が現在の逆質問を取得
app.get("/api/reverse-question", (req, res) => {
  res.json({ success: true, reverseQuestion: currentReverseQuestion });
});

// DELETE /api/reverse-question - 逆質問を非表示にする
app.delete("/api/reverse-question", (req, res) => {
  currentReverseQuestion = null;
  reverseQuestionAnswers = [];
  res.json({ success: true });
});

// POST /api/reverse-question/answers - 聴衆が逆質問に回答
app.post("/api/reverse-question/answers", (req, res) => {
  if (!currentReverseQuestion) {
    return res.status(400).json({ success: false, error: "現在表示中の逆質問がありません" });
  }

  const answer = String(req.body?.answer || "").trim();
  if (!answer) {
    return res.status(400).json({ success: false, error: "回答を入力してください" });
  }

  const newAnswer = {
    id: Date.now() + Math.random(),
    reverseQuestionId: currentReverseQuestion.id,
    answer,
    createdAt: new Date().toLocaleString("ja-JP"),
  };

  reverseQuestionAnswers.push(newAnswer);
  res.json({ success: true, answer: newAnswer });
});

// GET /api/reverse-question/answers - 発表者が逆質問への回答を取得
app.get("/api/reverse-question/answers", (req, res) => {
  res.json({ success: true, answers: reverseQuestionAnswers });
});

// =====================================================
// サーバー起動
// =====================================================
async function startServer(port = PORT) {
  await rebuildQaEmbeddingIndex();

  const server = app.listen(port, () => {
    PORT = port;
    console.log(`✅ サーバーが起動しました`);
    console.log(`👉 http://localhost:${PORT} をブラウザで開いてください`);
    console.log(`📱 聴衆ページ: http://localhost:${PORT}/audience.html`);
    console.log(`-----------------------------------------`);
    console.log(`スマホからアクセスする場合は、PCのIPアドレスを使用してください`);
    console.log(`例: http://192.168.x.x:${PORT}`);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      const nextPort = port + 1;
      console.warn(`⚠️ ポート ${port} は使用中のため、${nextPort} で再試行します。`);
      startServer(nextPort);
      return;
    }

    console.error("サーバー起動エラー:", err);
    process.exit(1);
  });
}

startServer();
