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
    console.log("今日の日付:", getLogicalToday());
    console.log("今の時刻:", new Date().toTimeString());
    console.log("スロット:", getSlots(getLogicalToday()));
    fetchAnsweredSlots(date).then(answered => {
        unansweredSlots = getSlots(date).filter(slot => !answered.includes(slot));
        if (unansweredSlots.length === 0) {
            document.getElementById("question").innerText = "今日のすべての質問が完了しました。";
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

function showBonusQuestions() {
    const popup = document.getElementById("bonusPopup");
    popup.classList.remove("hidden");

    document.getElementById("bonusSubmit").onclick = () => {
        const q1 = document.getElementById("q1").checked;
        const q2 = document.getElementById("q2").checked;
        let bonus = 0;
        if (q1) bonus += 10;
        if (q2) bonus += 10;
        popup.classList.add("hidden");
        if (bonus > 0) {
            updateAltitudeSmoothly(bonus, () => {
                startMainQuestions();
            });
        } else {
            startMainQuestions();
        }
    };
}

function startMainQuestions() {
    askNextSlot();
}

function getSlots(dateStr) {
    const slots = [];
    const start = new Date(`${dateStr}T06:00:00`);
    const now = new Date();
    const logicalNow = new Date();  // 論理日付ベース（6時前は前日扱い）

    if (now.getHours() < 6) {
        logicalNow.setDate(logicalNow.getDate() - 1);
    }

    const end = new Date(now);  // 今の時間までを上限にする

    for (let t = new Date(start); t <= end; t.setMinutes(t.getMinutes() + 30)) {
        const h = String(t.getHours()).padStart(2, "0");
        const m = String(t.getMinutes()).padStart(2, "0");
        slots.push(`${h}:${m}`);
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
        body: JSON.stringify({ slot: slot, action: activity, delta: getPoint(activity) })
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
function showHistoryPopup(data) {
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
    return now.toISOString().split("T")[0];
}



  window.addEventListener("DOMContentLoaded", () => {
    loadInitialAltitude();  // ← 高度の初期値を読み込む
    // const today = new Date().toISOString().split("T")[0];
    const today = getLogicalToday();  // ← 修正ポイント！
    startQuestioning(today);  // ← 既存の質問ロジック
    initClouds();             // ← 雲の初期化（必要なら）
    maintainClouds();         // ← 雲の常時管理（必要なら）
  });
  