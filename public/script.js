// =====================================================
// 発表支援AIアプリ - クライアントサイドJS (script.js)
// =====================================================


// =====================================================
// ログイン画面 / 画面遷移（UIデモ用）
// =====================================================
let selectedRole = "presenter";
let renderedAudienceReverseQuestionId = null;

function selectRole(role) {
  selectedRole = role;

  const presenterRole = document.getElementById("presenterRole");
  const audienceRole = document.getElementById("audienceRole");
  const presenterFields = document.getElementById("presenterLoginFields");
  const audienceFields = document.getElementById("audienceLoginFields");
  const help = document.getElementById("loginHelp");

  if (presenterRole) presenterRole.classList.toggle("active", role === "presenter");
  if (audienceRole) audienceRole.classList.toggle("active", role === "audience");
  if (presenterFields) presenterFields.style.display = role === "presenter" ? "block" : "none";
  if (audienceFields) audienceFields.style.display = role === "audience" ? "block" : "none";

  if (help) {
    help.textContent =
      role === "presenter"
        ? "発表者はプロジェクト管理へ、聴衆は質問送信ページへ進みます。"
        : "聴衆は授業コードとパスワードで参加します。";
  }
}

function loginFromHome() {
  if (selectedRole === "audience") {
    location.href = "audience.html";
  } else {
    location.href = "qa-entry.html";
  }
}

// =====================================================
// 発表者ページ: 初期化
// =====================================================
function initPresenterPage() {
  // QRコードと聴衆URLを設定
  const audienceUrl = new URL("audience.html", window.location.href).href;
  const audienceUrlEl = document.getElementById("audience-url");
  if (audienceUrlEl) audienceUrlEl.textContent = audienceUrl;

  // QRコード生成 (qrcode.js ライブラリを使用)
  const qrContainer = document.getElementById("qrcode");
  if (qrContainer && typeof QRCode !== "undefined") {
    qrContainer.innerHTML = "";
    new QRCode(qrContainer, {
      text: audienceUrl,
      width: 160,
      height: 160,
      colorDark: "#1a1a2e",
      colorLight: "#ffffff",
    });
  } else if (qrContainer) {
    qrContainer.innerHTML = `<div style="width:160px;height:160px;border:2px solid #e2e8f0;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:12px;color:#94a3b8;text-align:center;padding:10px;">QRコード<br>ライブラリ読込中</div>`;
  }

  // 過去質問DBの状態を取得
  fetchQaDatabaseStatus();

  // スライド・逆質問・質問を取得
  fetchCurrentSlide();
  fetchReverseQuestion();
  fetchReverseQuestionAnswers();
  fetchQuestions();

  // 自動更新
  setInterval(fetchQuestions, 10000);
  setInterval(fetchReverseQuestionAnswers, 5000);
}

// URLをコピーするボタン
function copyAudienceUrl() {
  const urlEl = document.getElementById("audience-url");
  const url = urlEl ? urlEl.textContent : new URL("audience.html", window.location.href).href;

  if (!navigator.clipboard) {
    alert("URLを手動でコピーしてください。\n" + url);
    return;
  }

  navigator.clipboard.writeText(url).then(() => {
    showTempMsg("URLをコピーしました ✅");
  }).catch(() => {
    alert("コピーできませんでした。URLを手動でコピーしてください。\n" + url);
  });
}


async function fetchQaDatabaseStatus() {
  const statusEl = document.getElementById("qa-db-status");

  if (!statusEl) return;

  try {
    const res = await fetch("/api/qa-database");
    const data = await res.json();

    renderQaDatabaseStatus(data);
  } catch (e) {
    statusEl.className = "qa-db-status qa-db-status-error";
    statusEl.textContent = "過去質問DBの状態を取得できませんでした。";
  }
}

function renderQaDatabaseStatus(data) {
  const statusEl = document.getElementById("qa-db-status");

  if (!statusEl) return;

  const ready = data.semanticSearchReady;

  statusEl.className = `qa-db-status ${
    ready ? "qa-db-status-ready" : "qa-db-status-warning"
  }`;

  if (ready) {
    statusEl.innerHTML = `
      ✅ 意味検索は有効です。<br />
      登録Q&A: <strong>${data.count}</strong>件 / ベクトル化済み: <strong>${data.indexedCount}</strong>件<br />
      モデル: <code>${escapeHtml(data.model)}</code> / しきい値: <code>${data.threshold}</code>
    `;
  } else {
    statusEl.innerHTML = `
      ⚠️ 過去質問DBは登録されていますが、意味検索はまだ有効ではありません。<br />
      登録Q&A: <strong>${data.count}</strong>件 / ベクトル化済み: <strong>${data.indexedCount}</strong>件<br />
      ${
        data.semanticSearchError
          ? `理由: ${escapeHtml(data.semanticSearchError)}`
          : "OPENAI_API_KEY の設定やCSVの内容を確認してください。"
      }
    `;
  }
}

async function uploadQaDatabase() {
  const fileInput = document.getElementById("qa-csv-file");
  const btn = document.getElementById("upload-qa-btn");

  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    showQaUploadMsg("CSVファイルを選択してください。", "error");
    return;
  }

  const file = fileInput.files[0];

  if (!file.name.toLowerCase().endsWith(".csv")) {
    showQaUploadMsg(".csv ファイルを選択してください。", "error");
    return;
  }

  btn.disabled = true;
  showQaUploadMsg("CSVをアップロードして、意味検索用のデータを作成しています...", "info");

  try {
    const csvText = await file.text();

    const res = await fetch("/api/upload-qa-database", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ csvText }),
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      showQaUploadMsg(data.error || "アップロードに失敗しました。", "error");
      return;
    }

    if (data.semanticSearchReady) {
      showQaUploadMsg(
        `✅ 過去質問DBを更新しました。${data.count}件を登録し、${data.indexedCount}件を意味検索に反映しました。`,
        "success"
      );
    } else {
      showQaUploadMsg(
        `⚠️ CSVは保存しましたが、意味検索はまだ有効ではありません。理由: ${
          data.semanticSearchError || "OPENAI_API_KEY を確認してください。"
        }`,
        "warning"
      );
    }

    renderQaDatabaseStatus(data);
  } catch (e) {
    showQaUploadMsg("アップロードに失敗しました。CSVの形式や通信状態を確認してください。", "error");
  } finally {
    btn.disabled = false;
  }
}

function showQaUploadMsg(message, type) {
  const msgEl = document.getElementById("qa-upload-msg");

  if (!msgEl) return;

  msgEl.style.display = "block";
  msgEl.className = `qa-upload-msg qa-upload-msg-${type}`;
  msgEl.textContent = message;
}

function downloadQaTemplate() {
  const csv = `question,answer
この研究の目的は何ですか？,発表中の質問を整理し、発表者が答えやすくすることです。
なぜAIを使うのですか？,似た質問の検出や過去質問との照合ができるためです。
`;

  const blob = new Blob(["\uFEFF" + csv], {
    type: "text/csv;charset=utf-8",
  });

  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "qa-database-template.csv";

  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

// =====================================================
// 発表者ページ: 質問一覧の取得・表示
// =====================================================
async function fetchQuestions() {
  try {
    const res = await fetch("/api/questions");
    const data = await res.json();
    renderQuestionList(data.questions);
  } catch (e) {
    console.error("質問の取得に失敗しました:", e);
  }
}

function renderQuestionList(questions) {
  const area = document.getElementById("question-list-area");
  const countEl = document.getElementById("question-count");

  if (!area) return;

  if (countEl) countEl.textContent = `（${questions.length}件）`;

  const totalStat = document.getElementById("question-total-stat");
  const autoAnswerStat = document.getElementById("auto-answer-stat");
  if (totalStat) totalStat.textContent = `${questions.length}件`;
  if (autoAnswerStat) {
    autoAnswerStat.textContent = `${questions.filter((q) => q.autoAnswered).length}件`;
  }

  if (questions.length === 0) {
    area.innerHTML = `
      <div class="empty-state">
        まだ質問がありません
      </div>`;
    return;
  }

  const listHtml = questions.map((q, i) => {
    const autoAnswerHtml = q.autoAnswered ? `
      <div class="auto-answer-box">
        <div class="auto-answer-label">🤖 自動回答済み</div>
        <div class="auto-answer-text">${escapeHtml(q.answer)}</div>
        <div class="auto-answer-meta">意味的に近い過去質問：${escapeHtml(q.matchedQuestion)} / 類似度：${q.similarity}</div>
      </div>` : "";

    return `
      <li class="question-item">
        <span class="question-num">${i + 1}</span>
        <span class="question-text">
          ${escapeHtml(q.text)}
          ${autoAnswerHtml}
        </span>
        <span class="question-time">${q.createdAt}</span>
      </li>
    `;
  }).join("");

  area.innerHTML = `<ul class="question-list">${listHtml}</ul>`;
}

// =====================================================
// 発表者ページ: デモ質問の追加
// =====================================================
async function addDemoQuestions() {
  try {
    const res = await fetch("/api/demo-questions", { method: "POST" });
    const data = await res.json();
    if (data.success) {
      showTempMsg(`✅ デモ質問を${data.added}件追加しました`);
      fetchQuestions();
    }
  } catch (e) {
    alert("エラーが発生しました");
  }
}

// =====================================================
// 発表者ページ: 質問のリセット
// =====================================================
async function resetQuestions() {
  if (!confirm("すべての質問を削除しますか？")) return;
  try {
    const res = await fetch("/api/questions", { method: "DELETE" });
    const data = await res.json();
    if (data.success) {
      fetchQuestions();
      document.getElementById("result-area").innerHTML = "";
      showTempMsg("🗑️ 質問をリセットしました");
    }
  } catch (e) {
    alert("エラーが発生しました");
  }
}

// =====================================================
// 発表者ページ: AIで質問を整理する
// =====================================================
async function analyzeQuestions() {
  const btn = document.getElementById("analyze-btn");
  const loading = document.getElementById("loading-area");
  const resultArea = document.getElementById("result-area");

  btn.disabled = true;
  loading.classList.add("show");
  resultArea.innerHTML = "";

  // デモらしく少し待機
  await sleep(1200);

  try {
    const res = await fetch("/api/analyze-questions", { method: "POST" });
    const data = await res.json();

    if (!data.success) {
      loading.classList.remove("show");
      btn.disabled = false;
      alert(data.error || "エラーが発生しました");
      return;
    }

    renderAnalysisResult(data.result);
  } catch (e) {
    alert("エラーが発生しました");
  } finally {
    loading.classList.remove("show");
    btn.disabled = false;
  }
}

function renderAnalysisResult(groups) {
  const area = document.getElementById("result-area");
  const summaryEl = document.getElementById("summary");
  const analysisStatus = document.getElementById("analysis-status");
  const analysisBar = document.getElementById("analysisBar");

  if (!area) return;

  if (summaryEl) {
    const topGroup = groups[0];
    summaryEl.textContent = topGroup
      ? `AI整理完了：${groups.length}グループに整理されました。まずは「${topGroup.category}」から答えるとよさそうです。`
      : "AI整理結果がありませんでした。";
  }
  if (analysisStatus) analysisStatus.textContent = "完了";
  if (analysisBar) analysisBar.style.width = "100%";

  const priorityClass = {
    高: { header: "result-group-header-high", badge: "priority-badge priority-high" },
    中: { header: "result-group-header-mid",  badge: "priority-badge priority-mid" },
    低: { header: "result-group-header-low",  badge: "priority-badge priority-low" },
  };

  let html = `
    <div style="font-size:14px; color:#475569; margin-bottom:16px;">
      🎯 <strong>${groups.length}グループ</strong>に整理されました。優先度の高い順に答えていきましょう。
    </div>`;

  groups.forEach((g) => {
    const cls = priorityClass[g.priority] || priorityClass["中"];
    html += `
      <div class="result-group">
        <div class="result-group-header ${cls.header}">
          <span class="result-category">${escapeHtml(g.category)}</span>
          <span class="${cls.badge}">優先度：${g.priority}</span>
          <span class="result-type">${escapeHtml(g.type)}</span>
          <span class="result-count">📬 ${g.count}件</span>
        </div>
        <div class="result-group-body">
          <p class="result-summary">${escapeHtml(g.summary)}</p>
          <div class="result-hint">
            💡 <span><strong>回答ヒント：</strong>${escapeHtml(g.hint)}</span>
          </div>
        </div>
      </div>`;
  });

  area.innerHTML = html;

  // 結果にスクロール
  area.scrollIntoView({ behavior: "smooth", block: "start" });
}

// =====================================================
// 聴衆ページ: 初期化
// =====================================================
function initAudiencePage() {
  // 文字数カウント
  const input = document.getElementById("question-input");
  if (input) {
    input.addEventListener("input", function () {
      document.getElementById("char-count").textContent = input.value.length;
    });
  }

  const reverseAnswerInput = document.getElementById("reverse-answer-input");
  if (reverseAnswerInput) {
    reverseAnswerInput.addEventListener("input", function () {
      const count = document.getElementById("reverse-answer-count");
      if (count) count.textContent = reverseAnswerInput.value.length;
    });
  }

  // スライドと逆質問を定期取得
  fetchCurrentSlide();
  fetchReverseQuestion();
  setInterval(fetchCurrentSlide, 5000);
  setInterval(fetchReverseQuestion, 5000);

  // 送信済みリストの復元
  renderSentList();
}

// =====================================================
// 聴衆ページ: 質問の送信
// =====================================================
async function submitQuestion() {
  const input = document.getElementById("question-input");
  const btn = document.getElementById("send-btn");
  const errorMsg = document.getElementById("error-msg");
  const successToast = document.getElementById("success-toast");

  const text = input.value.trim();

  // バリデーション
  if (!text) {
    showError("質問を入力してください");
    return;
  }

  btn.disabled = true;
  errorMsg.style.display = "none";
  successToast.classList.remove("show");

  try {
    const res = await fetch("/api/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();

    if (data.success) {
      // 送信成功
      input.value = "";
      document.getElementById("char-count").textContent = "0";

      // 過去質問DBに意味的に近い質問がある場合は、その場で回答を表示
      if (data.autoAnswer) {
        successToast.textContent = "✅ 過去の質問と意味的に近いため、自動回答を表示しました。";
        renderAudienceAutoAnswer(data.autoAnswer);
      } else {
        successToast.textContent = "✅ 質問を送信しました。発表者画面に反映されます。";
        hideAudienceAutoAnswer();
      }

      successToast.classList.add("show");

      // 送信済みリストに追加
      addToSentList(text);

      // 3秒後にトーストを隠す
      setTimeout(() => successToast.classList.remove("show"), 4000);
    } else {
      showError(data.error || "送信に失敗しました");
    }
  } catch (e) {
    showError("送信に失敗しました。通信を確認してください。");
  } finally {
    btn.disabled = false;
  }
}

function renderAudienceAutoAnswer(autoAnswer) {
  const card = document.getElementById("auto-answer-card");
  const answer = document.getElementById("auto-answer-content");
  const matched = document.getElementById("auto-answer-matched");
  if (!card || !answer || !matched) return;

  answer.textContent = autoAnswer.answer;
  matched.textContent = `意味的に近い過去質問：${autoAnswer.matchedQuestion} / 類似度：${autoAnswer.similarity}`;
  card.style.display = "block";
}

function hideAudienceAutoAnswer() {
  const card = document.getElementById("auto-answer-card");
  if (card) card.style.display = "none";
}

function showError(msg) {
  const errorMsg = document.getElementById("error-msg");
  if (errorMsg) {
    errorMsg.textContent = msg;
    errorMsg.style.display = "block";
    setTimeout(() => (errorMsg.style.display = "none"), 3000);
  }
}

// 送信済みリスト（セッション中のみ保持）
let sentQuestions = [];

function addToSentList(text) {
  sentQuestions.unshift({ text, time: new Date().toLocaleTimeString("ja-JP") });
  renderSentList();
}

function renderSentList() {
  const card = document.getElementById("sent-list-card");
  const list = document.getElementById("sent-list");
  if (!card || !list) return;

  if (sentQuestions.length === 0) {
    card.style.display = "none";
    return;
  }

  card.style.display = "block";
  list.innerHTML = sentQuestions.map((q, i) => `
    <li class="question-item">
      <span class="question-num">${sentQuestions.length - i}</span>
      <span class="question-text">${escapeHtml(q.text)}</span>
      <span class="question-time">${q.time}</span>
    </li>
  `).join("");
}

function clearSentList() {
  sentQuestions = [];
  renderSentList();
}


// =====================================================
// スライドアップロード・共通表示
// =====================================================
async function uploadSlide(mode = "ai") {
  const fileInput = document.getElementById("slide-file");
  const notesInput = document.getElementById("slide-notes");
  const btn = document.getElementById(mode === "display" ? "upload-slide-display-btn" : "upload-slide-ai-btn");
  const status = document.getElementById("slide-upload-status");

  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    showTempMsg("スライドファイルを選択してください");
    return;
  }

  const file = fileInput.files[0];
  const formData = new FormData();
  formData.append("slide", file);
  formData.append("notes", mode === "ai" && notesInput ? notesInput.value : "");

  if (btn) btn.disabled = true;
  if (status) status.textContent = mode === "display" ? "表示用としてアップロード中..." : "AI用としてアップロード中...";

  try {
    const res = await fetch("/api/slides/upload", {
      method: "POST",
      body: formData,
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || "アップロードに失敗しました");
    }

    if (status) status.textContent = data.message || (mode === "display" ? "表示用にアップロードしました" : "AI用にアップロードしました");
    showTempMsg(mode === "display" ? "✅ 表示用にアップロードしました" : "✅ AI用にアップロードしました");
    renderSlideView(data.slide);
    fetchReverseQuestion();
    fetchReverseQuestionAnswers();
  } catch (e) {
    if (status) status.textContent = e.message;
    showTempMsg("❌ " + e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function fetchCurrentSlide() {
  const presenterView = document.getElementById("presenter-slide-view");
  const audienceView = document.getElementById("audience-slide-view");
  if (!presenterView && !audienceView) return;

  try {
    const res = await fetch("/api/current-slide");
    const data = await res.json();
    renderSlideView(data.slide);
  } catch (e) {
    console.error("スライド情報の取得に失敗しました:", e);
  }
}

function renderPdfViewerIfNeeded(view, slide) {
  if (!view || !slide || slide.displayType !== "pdf") return;
}

function renderSlideView(slide) {
  const presenterView = document.getElementById("presenter-slide-view");
  const audienceView = document.getElementById("audience-slide-view");
  const slideId = slide ? String(slide.id || "none") : "none";
  const slideViewKey = slide ? `${slideId}:${slide.currentPage || 1}:${slide.pageCount || 1}` : `${slideId}:none`;

  if (presenterView && presenterView.dataset.slideViewKey !== slideViewKey) {
    presenterView.innerHTML = createSlideViewHtml(slide, true);
    presenterView.dataset.slideViewKey = slideViewKey;
    presenterView.dataset.slideId = slideId;
    renderPdfViewerIfNeeded(presenterView, slide);
  }

  if (audienceView && audienceView.dataset.slideViewKey !== slideViewKey) {
    audienceView.innerHTML = createSlideViewHtml(slide, false);
    audienceView.dataset.slideViewKey = slideViewKey;
    audienceView.dataset.slideId = slideId;
    renderPdfViewerIfNeeded(audienceView, slide);
  }
}

function createSlideViewHtml(slide, isPresenter) {
  if (!slide) {
    return `
      <div class="slide-preview-card">
        <div style="font-size:42px">📄</div>
        <div class="slide-preview-name">スライド未アップロード</div>
      </div>`;
  }

  const safeName = escapeHtml(slide.originalName || "スライド");
  const safeUrl = escapeHtml(slide.url || "");
  const currentPage = Number(slide.currentPage || 1) || 1;
  const pageCount = Math.max(1, Number(slide.pageCount || 1) || 1);
  const isPdf = slide.displayType === "pdf";
  const isImage = slide.displayType === "image";
  const isText = slide.displayType === "text";

  let body = "";
  if (isPdf) {
    body = `<iframe class="slide-frame" src="${safeUrl}#toolbar=0&navpanes=0" title="${safeName}"></iframe>`;
  } else if (isImage) {
    body = `<img class="slide-image" src="${safeUrl}" alt="${safeName}" />`;
  } else if (isText) {
    body = `<div class="slide-text-preview">${escapeHtml(slide.textPreview || "テキストを読み込みました。")}</div>`;
  } else {
    body = `
      <div class="slide-preview-card">
        <div style="font-size:42px">📄</div>
        <div class="slide-preview-name">${safeName}</div>
        <p class="muted">この形式はブラウザで直接表示できないため、抽出テキストのプレビューを表示しています。スライドそのものを見せたい場合はPDFにしてアップロードしてください。</p>
        <div class="slide-text-preview">${escapeHtml(slide.textPreview || "テキストは抽出できませんでした。補足メモがAI生成に使われます。")}</div>
        <a class="btn secondary small" href="${safeUrl}" target="_blank" rel="noopener">ファイルを開く</a>
      </div>`;
  }

  return `
    <div class="slide-content-area">${body}</div>
    ${isPresenter && slide.notes ? `<div class="slide-notes-preview">${escapeHtml(slide.notes)}</div>` : ""}`;
}

// =====================================================
// 逆質問の生成・表示・回答
// =====================================================
async function generateReverseQuestion() {
  const btn = document.getElementById("reverse-question-btn");
  const loading = document.getElementById("reverse-loading");
  const area = document.getElementById("reverse-question-area");

  if (btn) btn.disabled = true;
  if (loading) loading.classList.add("show");
  if (area) area.textContent = "逆質問を生成しています...";

  try {
    const res = await fetch("/api/reverse-question/generate", { method: "POST" });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || "逆質問の生成に失敗しました");
    }
    renderReverseQuestion(data.reverseQuestion);
    fetchReverseQuestionAnswers();
    showTempMsg("✅ 逆質問を聴衆画面に表示しました");
  } catch (e) {
    if (area) area.textContent = e.message;
    showTempMsg("❌ " + e.message);
  } finally {
    if (loading) loading.classList.remove("show");
    if (btn) btn.disabled = false;
  }
}

async function fetchReverseQuestion() {
  const presenterArea = document.getElementById("reverse-question-area");
  const audienceArea = document.getElementById("audience-reverse-question-area");
  if (!presenterArea && !audienceArea) return;

  try {
    const res = await fetch("/api/reverse-question");
    const data = await res.json();
    renderReverseQuestion(data.reverseQuestion);
  } catch (e) {
    console.error("逆質問の取得に失敗しました:", e);
  }
}

function renderReverseQuestion(reverseQuestion) {
  const presenterArea = document.getElementById("reverse-question-area");
  const audienceArea = document.getElementById("audience-reverse-question-area");

  if (presenterArea) {
    if (!reverseQuestion) {
      presenterArea.className = "ai-summary";
      presenterArea.innerHTML = "まだ逆質問は配信されていません。";
    } else {
      presenterArea.className = "reverse-question-card";
      const related = (reverseQuestion.relatedAudienceQuestions || []).map((q) => `<li>${escapeHtml(q)}</li>`).join("");
      presenterArea.innerHTML = `
        <span class="tag purple">聴衆に表示中</span>
        <h3>${escapeHtml(reverseQuestion.question)}</h3>
        <p><strong>目的：</strong>${escapeHtml(reverseQuestion.intent || "-")}</p>
        <p><strong>理由：</strong>${escapeHtml(reverseQuestion.whyThisQuestion || "-")}</p>
        <p><strong>想定回答：</strong>${escapeHtml(reverseQuestion.expectedAnswer || "-")}</p>
        <p><strong>関連スライド：</strong>${escapeHtml(reverseQuestion.slideFocus || reverseQuestion.slideName || "-")}</p>
        ${related ? `<div><strong>関連する聴衆質問：</strong><ul>${related}</ul></div>` : ""}
        <div class="reverse-meta">${escapeHtml(reverseQuestion.createdAt || "")} / ${escapeHtml(reverseQuestion.method || "")}</div>
      `;
    }
  }

  if (audienceArea) {
    if (!reverseQuestion) {
      audienceArea.style.display = "none";
      renderedAudienceReverseQuestionId = null;
      return;
    }

    if (renderedAudienceReverseQuestionId === reverseQuestion.id) {
      audienceArea.style.display = "block";
      return;
    }

    audienceArea.style.display = "block";
    renderedAudienceReverseQuestionId = reverseQuestion.id;
    audienceArea.innerHTML = `
      <span class="tag purple">発表者からの逆質問</span>
      <div class="question-title">${escapeHtml(reverseQuestion.question)}</div>
      <p class="muted" style="line-height:1.7">発表者が理解度を確認するための質問です。短く答えてください。</p>
      <textarea id="reverse-answer-input" rows="3" maxlength="300" placeholder="例：評価方法のところがまだ少し分かりません。"></textarea>
      <div style="font-size:12px;color:#94a3b8;text-align:right;margin-top:4px"><span id="reverse-answer-count">0</span> / 300文字</div>
      <button class="btn" type="button" style="width:100%;margin-top:12px" onclick="submitReverseAnswer()">逆質問に回答する</button>
      <div class="success-toast" id="reverse-answer-toast">回答を送信しました。</div>
    `;

    const input = document.getElementById("reverse-answer-input");
    if (input) {
      input.addEventListener("input", function () {
        const count = document.getElementById("reverse-answer-count");
        if (count) count.textContent = input.value.length;
      });
    }
  }
}

async function clearReverseQuestion() {
  if (!confirm("聴衆画面の逆質問を非表示にしますか？")) return;
  try {
    const res = await fetch("/api/reverse-question", { method: "DELETE" });
    const data = await res.json();
    if (data.success) {
      renderReverseQuestion(null);
      fetchReverseQuestionAnswers();
      showTempMsg("逆質問を非表示にしました");
    }
  } catch (e) {
    showTempMsg("逆質問の非表示に失敗しました");
  }
}

async function submitReverseAnswer() {
  const input = document.getElementById("reverse-answer-input");
  const toast = document.getElementById("reverse-answer-toast");
  if (!input) return;

  const answer = input.value.trim();
  if (!answer) {
    showError("回答を入力してください");
    return;
  }

  try {
    const res = await fetch("/api/reverse-question/answers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || "回答の送信に失敗しました");
    }
    input.value = "";
    const count = document.getElementById("reverse-answer-count");
    if (count) count.textContent = "0";
    if (toast) {
      toast.textContent = "✅ 回答を送信しました。";
      toast.classList.add("show");
      setTimeout(() => toast.classList.remove("show"), 3000);
    }
  } catch (e) {
    showError(e.message);
  }
}

async function fetchReverseQuestionAnswers() {
  const area = document.getElementById("reverse-answer-area");
  if (!area) return;

  try {
    const res = await fetch("/api/reverse-question/answers");
    const data = await res.json();
    const answers = data.answers || [];

    if (answers.length === 0) {
      area.className = "empty-state";
      area.style.padding = "18px 10px";
      area.innerHTML = "まだ回答がありません。";
      return;
    }

    area.className = "";
    area.style.padding = "0";
    area.innerHTML = `<ul class="question-list">${answers.map((a, i) => `
      <li class="question-item">
        <span class="question-num">${i + 1}</span>
        <span class="question-text">${escapeHtml(a.answer)}</span>
        <span class="question-time">${escapeHtml(a.createdAt || "")}</span>
      </li>`).join("")}</ul>`;
  } catch (e) {
    console.error("逆質問回答の取得に失敗しました:", e);
  }
}

// =====================================================
// スライド分析ページ: デモテキスト読み込み
// =====================================================
function loadDemoSlide() {
  const demoText = `本研究では機械学習を用いたテキスト分類アルゴリズムを提案する。
従来手法であるSVMやNaïve Bayesと比較し、BERTベースのファインチューニングにより精度が87%から93%へ向上した。
評価にはIMDbおよびSST-2データセットを使用し、5-fold交差検証を実施した。
提案手法の実行時間はGPU使用時に1エポック約3分であり、実用的な速度を実現している。
今後はマルチラベル分類への拡張とゼロショット学習の適用を検討している。`;

  document.getElementById("slide-input").value = demoText;
}

// =====================================================
// スライド分析ページ: 分析実行
// =====================================================
async function analyzeSlide() {
  const input = document.getElementById("slide-input");
  const btn = document.getElementById("analyze-slide-btn");
  const loading = document.getElementById("slide-loading");
  const resultArea = document.getElementById("slide-result-area");

  const text = input.value.trim();
  if (!text) {
    alert("スライドのテキストを入力してください");
    return;
  }

  btn.disabled = true;
  loading.classList.add("show");
  resultArea.innerHTML = "";

  // デモらしく少し待機
  await sleep(1400);

  try {
    const res = await fetch("/api/analyze-slide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();

    if (!data.success) {
      alert(data.error || "エラーが発生しました");
      return;
    }

    renderSlideResult(data.result);
  } catch (e) {
    alert("エラーが発生しました");
  } finally {
    loading.classList.remove("show");
    btn.disabled = false;
  }
}

function renderSlideResult(result) {
  const area = document.getElementById("slide-result-area");

  const diffClass = { 簡単: "diff-easy", 普通: "diff-normal", 難しい: "diff-hard" };

  // 想定質問
  const questionsHtml = result.predictedQuestions.map(q => `
    <div class="predicted-question-item">
      <span class="difficulty-badge ${diffClass[q.difficulty] || 'diff-normal'}">${q.difficulty}</span>
      <span>${escapeHtml(q.question)}</span>
    </div>`).join("");

  // 難しい用語
  const termsHtml = result.terms.map(t => `
    <div class="term-item">
      <div class="term-name">
        <span class="term-badge">用語</span>
        ${escapeHtml(t.term)}
      </div>
      <div class="term-explanation">${escapeHtml(t.explanation)}</div>
    </div>`).join("");

  // 補足説明
  const supplementsHtml = result.supplements.map(s => `
    <div class="supplement-item">
      <div class="supplement-point">⚠️ ${escapeHtml(s.point)}</div>
      <div class="supplement-suggestion">→ ${escapeHtml(s.suggestion)}</div>
    </div>`).join("");

  area.innerHTML = `
    <div class="card">
      <div class="analysis-section">
        <div class="analysis-section-title">
          ❓ 想定される質問
          <span style="font-size:12px;font-weight:400;color:#94a3b8;">${result.predictedQuestions.length}件</span>
        </div>
        ${questionsHtml}
      </div>

      <div class="analysis-section" style="margin-top: 24px;">
        <div class="analysis-section-title">
          📖 難しい用語
          <span style="font-size:12px;font-weight:400;color:#94a3b8;">${result.terms.length}件</span>
        </div>
        ${termsHtml}
      </div>

      <div class="analysis-section" style="margin-top: 24px;">
        <div class="analysis-section-title">
          💡 補足説明の提案
          <span style="font-size:12px;font-weight:400;color:#94a3b8;">${result.supplements.length}件</span>
        </div>
        ${supplementsHtml}
      </div>
    </div>`;

  area.scrollIntoView({ behavior: "smooth", block: "start" });
}

// =====================================================
// ユーティリティ
// =====================================================

// XSS対策: HTMLをエスケープ
function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// 指定ミリ秒待機
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 一時メッセージを表示（ヘッダー下あたりに）
function showTempMsg(msg) {
  const toastEl = document.getElementById("toast");
  if (toastEl) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), 2500);
    return;
  }

  // 既存があれば削除
  const existing = document.getElementById("temp-msg");
  if (existing) existing.remove();

  const el = document.createElement("div");
  el.id = "temp-msg";
  el.style.cssText = `
    position: fixed; top: 64px; left: 50%; transform: translateX(-50%);
    background: #1a1a2e; color: #ffffff; padding: 10px 20px;
    border-radius: 100px; font-size: 13px; font-weight: 500;
    z-index: 9999; white-space: nowrap; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  `;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

