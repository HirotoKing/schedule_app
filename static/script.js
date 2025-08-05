// 活動ごとのポイント変換
function getPoint(activity) {
    switch(activity) {
        case '寝食': return 0;
        case '仕事': return 1;
        case '知的活動': return 5;
        case '勉強': return 10;
        case '運動': return 10;
        case 'ゲーム': return -5;
        default: return 0;
    }
}

let cloudMoveInterval = null;
let bonusGiven = false;

function updateAltitudeSmoothly(change, callback) {
    let altimeterElem = document.getElementById("altimeter");
    let current = parseInt(altimeterElem.dataset.altitude || "100");
    const target = current + change;
    const balloon = document.getElementById("balloon");
    const warningElem = document.getElementById("warning");
    warningElem.innerText = "";

    disableButtons();

    if (target < 100) {
        current = 100;
        altimeterElem.innerText = "高度：100m";
        altimeterElem.dataset.altitude = "100";
        stopCloudFall();
        enableButtons();
        warningElem.innerText = "これ以上高度は下がりません！";
        if (callback) callback();
        return;
    }

    if (change > 0) startCloudFall("down");
    else if (change < 0) startCloudFall("up");

    const step = change > 0 ? 1 : -1;
    const interval = setInterval(() => {
        if (current === target) {
            clearInterval(interval);
            if (target > 100) balloon.classList.add("floating");
            stopCloudFall();
            enableButtons();
            if (callback) callback();
            return;
        }
        current += step;
        altimeterElem.innerText = `高度：${current}m`;
        altimeterElem.dataset.altitude = current;
    }, 150);
}

function disableButtons() {
    document.querySelectorAll(".button-grid button").forEach(btn => btn.disabled = true);
}
function enableButtons() {
    document.querySelectorAll(".button-grid button").forEach(btn => btn.disabled = false);
}

function handleButtonClick(activity) {
    disableButtons();
    const slot = unansweredSlots[currentSlotIndex];
    const point = getPoint(activity);
    sendActivityToServer(slot, activity);
    updateAltitudeSmoothly(point, () => {
        currentSlotIndex++;
        askNextSlot();
    });
}

let unansweredSlots = [];
let currentSlotIndex = 0;

function startQuestioning(date) {
    console.log("初めて作ったので成功しててうれしいです！");

    fetchAnsweredSlots(date).then(answered => {
        const now = new Date();
        unansweredSlots = getSlots(date).filter(slot => {
            const [hour, minute] = slot.split(":").map(Number);
            const slotTime = new Date(now);

            slotTime.setHours(hour, minute, 0, 0);

            // 🔽 深夜（0〜5時台）だったら翌日に調整
            if (hour < 6) {
                slotTime.setDate(slotTime.getDate() + 1);
            }

            return !answered.includes(slot) && slotTime <= now;
        });


        if (unansweredSlots.length === 0) {
            document.getElementById("question").innerText = "今日のすべての質問が完了しました。";
        
            // すべての行動ボタンを無効化
            const actionButtons = document.querySelectorAll(".button-grid button");
            actionButtons.forEach(btn => {
                btn.disabled = true;
                btn.style.opacity = 0.5;
                btn.style.cursor = "default";
            });
        
        } else {
            currentSlotIndex = 0;
            if (answered.length === 0 && !bonusGiven) {
                bonusGiven = true;
                showBonusQuestions();
            } else {
                startMainQuestions();
            }
        }
        document.getElementById("todayDate").innerText = "今日の日付：" + date;
    });
}


async function showBonusQuestions() {
    const popup = document.getElementById("bonusPopup");
    const questionText = document.getElementById("bonusQuestionText");
    const yesButton = document.getElementById("bonusYes");
    const noButton = document.getElementById("bonusNo");
  
    const actions = [
      {
        text: "昨日のスマホ操作時間は6時間以下だったか？",
        action: "スマホ制限"
      },
      {
        text: "昨日は24:00より前に寝て、今日は7:00に起きたか？",
        action: "早寝早起き"
      }
    ];
  
    let index = 0;
    popup.classList.remove("hidden");
    questionText.innerText = actions[index].text;
  
    function handleAnswer(answer) {
        const yesNoButtons = document.getElementById("yes-no-buttons");

        // delta は「はい」なら10、「いいえ」なら0
        const deltaValue = (answer === "はい") ? 10 : 0;
      
        fetch("/log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: actions[index].action,
            slot: "-"
          })
        });
      
        index++;
        if (index < actions.length) {
            questionText.innerText = actions[index].text;  // 
        } else {
          yesNoButtons.style.display = "none";
          startMainQuestions(); // 通常の質問開始
        }
      }
  
    yesButton.onclick = () => handleAnswer("はい");
    noButton.onclick = () => handleAnswer("いいえ");
  }
  

function startMainQuestions() {
    askNextSlot();
}

function getSlots(dateStr) {
    const slots = [];
    const start = new Date(`${dateStr}T06:00:00+09:00`);  // JST
    const end = new Date(start.getTime() + 21 * 60 * 60 * 1000);  // 翌03:00まで

    for (let t = new Date(start); t < end; t.setMinutes(t.getMinutes() + 30)) {
        const slotDate = new Date(t); // スロットごとの日時を個別に保存
        const h = String(slotDate.getHours()).padStart(2, "0");
        const m = String(slotDate.getMinutes()).padStart(2, "0");
        const slotStr = `${h}:${m}`;
        slots.push(slotStr);
    }
    return slots;
}






function askNextSlot() {
    if (currentSlotIndex >= unansweredSlots.length) {
        document.getElementById("question").innerText = "今日のすべての質問が完了しました。";
        return;
    }
    const slot = unansweredSlots[currentSlotIndex];
    const nextTime = getNextHalfHour(slot);
    document.getElementById("question").innerText = `${slot} から ${nextTime} の間、何をしていましたか？`;
}

function sendActivityToServer(slot, activity) {
    fetch("/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot: slot, action: activity })
    });
}

function getNextHalfHour(slot) {
    const [h, m] = slot.split(":").map(Number);
    const t = new Date();
    t.setHours(h, m + 30);
    return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
}

async function fetchAnsweredSlots(date) {
    const res = await fetch(`/answered_slots?date=${date}`);
    return await res.json();
}

// 雲処理
function initClouds() {
    const cloudContainer = document.getElementById("cloudContainer");
    const initialCount = Math.floor(Math.random() * 2) + 2;
    for (let i = 0; i < initialCount; i++) {
        createFloatingCloud();
    }
}
function maintainClouds() {
    const cloudContainer = document.getElementById("cloudContainer");
    setInterval(() => {
        const clouds = cloudContainer.querySelectorAll(".cloud");
        const currentAlt = parseInt(document.getElementById("altimeter").dataset.altitude || "100");
        clouds.forEach(cloud => {
            const baseAlt = parseInt(cloud.dataset.baseAltitude || "100");
            if (Math.abs(currentAlt - baseAlt) > 100) cloud.remove();
        });
        if (Math.random() < 0.1 && clouds.length < 5) {
            createFloatingCloud();
        }
    }, 1000);
}
function createFloatingCloud() {
    const cloudContainer = document.getElementById("cloudContainer");
    const cloud = document.createElement("img");
    cloud.src = "/static/cloud_transparent.png";
    cloud.className = "cloud";
    cloud.style.left = Math.random() < 0.5 ? `${Math.random() * 30}%` : `${Math.random() * 30 + 70}%`;
    const top = Math.random() * 40 + 10;
    cloud.style.top = `${top}px`;
    cloud.dataset.baseTop = top;
    cloud.dataset.baseAltitude = document.getElementById("altimeter").dataset.altitude;
    cloud.dataset.swaying = "true";
    cloudContainer.appendChild(cloud);

    let frame = 0;
    const interval = setInterval(() => {
        if (!document.body.contains(cloud)) {
            clearInterval(interval);
            return;
        }
        if (cloud.dataset.swaying === "true") {
            const sway = Math.sin(frame / 20) * 1.5;
            cloud.style.top = `${parseFloat(cloud.dataset.baseTop) + sway}px`;
            frame++;
        }
    }, 100);
}
function startCloudFall(direction) {
    document.querySelectorAll(".cloud").forEach(cloud => cloud.dataset.swaying = "false");
    if (cloudMoveInterval) clearInterval(cloudMoveInterval);
    cloudMoveInterval = setInterval(() => {
        document.querySelectorAll(".cloud").forEach(cloud => {
            const currentTop = parseFloat(cloud.style.top);
            const newTop = direction === "down" ? currentTop + 3 : currentTop - 3;
            cloud.style.top = `${newTop}px`;
        });
    }, 50);
}
function stopCloudFall() {
    if (cloudMoveInterval) {
        clearInterval(cloudMoveInterval);
        cloudMoveInterval = null;
    }
    document.querySelectorAll(".cloud").forEach(cloud => {
        cloud.dataset.baseTop = cloud.style.top;
        cloud.dataset.swaying = "true";
    });
}

// 履歴表示
document.getElementById("historyBtn").addEventListener("click", () => {
    fetch("/summary_all")
        .then(res => res.json())
        .then(data => showHistoryPopup(data));
});
document.getElementById("closePopup").addEventListener("click", () => {
    document.getElementById("historyPopup").classList.add("hidden");
});
async function showHistoryPopup(data) {
    const labels = data.map(d => d.date);
    const heights = [];
    let cumulative = 100;
    for (const d of data) {
        cumulative += d.height_change;
        heights.push(cumulative);
    }

    const ctx = document.getElementById("heightChart").getContext("2d");
    if (window.heightChart && typeof window.heightChart.destroy === "function") {
        window.heightChart.destroy();
    }
    window.heightChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: labels,
            datasets: [{
                label: "累積高度(m)",
                data: heights,
                borderColor: "skyblue",
                fill: false
            }]
        },
        options: {
            responsive: false,
            scales: {
                y: { beginAtZero: true }
            }
        }
    });

    // 各行動の総合回数を表示
    const summaryList = document.getElementById("summaryList");
    summaryList.innerHTML = "";
    const totalCounts = {
        "寝食": 0, "仕事": 0, "知的活動": 0,
        "勉強": 0, "運動": 0, "ゲーム": 0
    };
    for (const d of data) {
        for (const key in totalCounts) {
            totalCounts[key] += d[key];
        }
    }
    for (const key in totalCounts) {
        const li = document.createElement("li");
        li.textContent = `${key}：${totalCounts[key]} 回`;
        summaryList.appendChild(li);
    }

    // 🎯 ボーナス統計を表示
    const bonusRes = await fetch("/bonus_stats");
    const bonusStats = await bonusRes.json();

    const bonusList = document.getElementById("bonusStatsList");
    bonusList.innerHTML = "<h4>ボーナス質問の達成率</h4>";
    for (const [action, stats] of Object.entries(bonusStats)) {
        const li = document.createElement("li");
        li.textContent = `${action}：${stats["達成率"]}（${stats["成功"]}/${stats["合計"]})`;
        bonusList.appendChild(li);
    }

    document.getElementById("historyPopup").classList.remove("hidden");
}


function checkDB() {
    fetch("/summary_all")
      .then(res => res.json())
      .then(data => {
        const container = document.getElementById("dbStatus");
        container.innerHTML = "";
  
        data.slice(-3).forEach(day => {
          const div = document.createElement("div");
          div.classList.add("day-summary");
  
          const dateHeader = document.createElement("h4");
          dateHeader.textContent = `■ ${day.date} の記録`;
          div.appendChild(dateHeader);
  
          const heightP = document.createElement("p");
          heightP.textContent = `・高度変化：${day.height_change}m`;
          div.appendChild(heightP);
  
          const categories = ["寝食", "仕事", "知的活動", "勉強", "運動", "ゲーム"];
          categories.forEach(cat => {
            const count = day[cat] || 0;
            const hours = count * 0.5;
            const p = document.createElement("p");
            p.textContent = `・${cat}：${hours}時間`;
            div.appendChild(p);
          });
  
          container.appendChild(div);
        });
      })
      .catch(err => {
        document.getElementById("dbStatus").innerText = "エラー: " + err;
      });
  }
  

  async function loadInitialAltitude() {
    try {
      const res = await fetch("/summary_all");
      const data = await res.json();
  
      if (Array.isArray(data)) {
        let cumulative = 100;
        for (const d of data) {
            cumulative += d.height_change;
        }
        const altimeterElem = document.getElementById("altimeter");
        altimeterElem.innerText = `高度：${cumulative}m`;
        altimeterElem.dataset.altitude = cumulative;
      }
    } catch (e) {
      console.error("初期高度の読み込みに失敗しました", e);
    }
  }

  function getLogicalToday() {
    const now = new Date();
    if (now.getHours() < 6) {
        now.setDate(now.getDate() - 1);
    }
    // 日本時間での日付文字列（例：2025-08-04）
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}





  window.addEventListener("DOMContentLoaded", () => {
    loadInitialAltitude();  // ← 高度の初期値を読み込む
    // const today = new Date().toISOString().split("T")[0];
    const today = getLogicalToday();  // ← 修正ポイント！
    startQuestioning(today);  // ← 既存の質問ロジック
    initClouds();             // ← 雲の初期化（必要なら）
    maintainClouds();         // ← 雲の常時管理（必要なら）
  });
  