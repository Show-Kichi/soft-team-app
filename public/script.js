// =====================================================
// 発表支援AIアプリ - クライアントサイドJS (script.js)
// =====================================================

// =====================================================
// 発表者ページ: 初期化
// =====================================================
function initPresenterPage() {
  // QRコードと聴衆URLを設定
  const audienceUrl = `${location.protocol}//${location.hostname}:${location.port || 3000}/audience.html`;
  document.getElementById("audience-url").textContent = audienceUrl;

  // QRコード生成 (qrcode.js ライブラリを使用)
  const qrContainer = document.getElementById("qrcode");
  if (typeof QRCode !== "undefined") {
    new QRCode(qrContainer, {
      text: audienceUrl,
      width: 160,
      height: 160,
      colorDark: "#1a1a2e",
      colorLight: "#ffffff",
    });
  } else {
    qrContainer.innerHTML = `<div style="width:160px;height:160px;border:2px solid #e2e8f0;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:12px;color:#94a3b8;text-align:center;padding:10px;">QRコード<br>ライブラリ読込中</div>`;
  }

  // 質問を取得
  fetchQuestions();

  // 10秒ごとに自動更新
  setInterval(fetchQuestions, 10000);
}

// URLをコピーするボタン
function copyAudienceUrl() {
  const url = document.getElementById("audience-url").textContent;
  navigator.clipboard.writeText(url).then(() => {
    showTempMsg("URLをコピーしました ✅");
  }).catch(() => {
    alert("コピーできませんでした。URLを手動でコピーしてください。\n" + url);
  });
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

  countEl.textContent = `（${questions.length}件）`;

  if (questions.length === 0) {
    area.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📭</span>
        まだ質問がありません。<br />
        聴衆にQRコードを読み込んでもらうか、「デモ質問を追加」を押してください。
      </div>`;
    return;
  }

  const listHtml = questions.map((q, i) => `
    <li class="question-item">
      <span class="question-num">${i + 1}</span>
      <span class="question-text">${escapeHtml(q.text)}</span>
      <span class="question-time">${q.createdAt}</span>
    </li>
  `).join("");

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

// Enterキーで送信（Shift+Enterは改行）
document.addEventListener("keydown", function (e) {
  if (e.target.id === "question-input" && e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submitQuestion();
  }
});

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