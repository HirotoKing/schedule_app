// --- 活動ごとのポイント変換 ---
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

let unansweredSlots = [];
let currentSlotIndex = 0;
let bonusGiven = false;
let cloudMoveInterval = null;

// --- 高度アニメーション処理 ---
function updateAltitudeSmoothly(change, callback) {
    const altElem = document.getElementById("altimeter");
    const balloon = document.getElementById("balloon");
    let current = parseInt(altElem.dataset.altitude || "100");
    const target = current + change;
    const warning = document.getElementById("warning");

    warning.innerText = "";
    disableButtons();

    if (target < 100) {
        altElem.innerText = "高度：100m";
        altElem.dataset.altitude = "100";
        stopCloudFall();
        enableButtons();
        warning.innerText = "これ以上高度は下がりません！";
        if (callback) callback();
        return;
    }

    if (change > 0) {
        balloon.classList.remove("floating");
        startCloudFall("down");
    } else if (change < 0) {
        balloon.classList.remove("floating");
        startCloudFall("up");
    }

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
        altElem.innerText = `高度：${current}m`;
        altElem.dataset.altitude = current;
    }, 150);
}

function disableButtons() {
    document.querySelectorAll(".button-grid button").forEach(btn => btn.disabled = true);
}
function enableButtons() {
    document.querySelectorAll(".button-grid button").forEach(btn => btn.disabled = false);
}

// --- 行動記録と質問処理 ---
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

function startQuestioning(date) {
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

function getSlots(dateStr) {
    const slots = [];
    const start = new Date(`${dateStr}T06:00:00`);
    const end = new Date(start.getTime() + 19 * 60 * 60 * 1000);
    for (let t = new Date(start); t < end; t.setMinutes(t.getMinutes() + 30)) {
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
    document.getElementById("question").innerText = `${slot}〜${nextTime}の間、何をしていましたか？`;
}

function sendActivityToServer(slot, activity) {
    fetch("/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: activity, delta: getPoint(activity) })
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
    const data = await res.json();
    return data;
}

// --- ボーナス質問処理（ポップアップ表示） ---
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

// --- 雲処理 ---
function initClouds() {
    const cloudContainer = document.getElementById("cloudContainer");
    const count = Math.floor(Math.random() * 2) + 2;
    for (let i = 0; i < count; i++) createFloatingCloud();
}

function maintainClouds() {
    const container = document.getElementById("cloudContainer");
    setInterval(() => {
        const clouds = container.querySelectorAll(".cloud");
        const alt = parseInt(document.getElementById("altimeter").dataset.altitude || "100");

        clouds.forEach(cloud => {
            const base = parseInt(cloud.dataset.baseAltitude || "100");
            if (Math.abs(alt - base) > 100) cloud.remove();
        });

        if (Math.random() < 0.1 && clouds.length < 5) createFloatingCloud();
    }, 1000);
}

function createFloatingCloud() {
    const container = document.getElementById("cloudContainer");
    const cloud = document.createElement("img");
    cloud.src = "/static/cloud_transparent.png";
    cloud.className = "cloud";

    const left = Math.random() < 0.5 ? Math.random() * 30 : Math.random() * 30 + 70;
    cloud.style.left = `${left}%`;
    cloud.style.top = `${Math.random() * 40 + 10}px`;

    const alt = parseInt(document.getElementById("altimeter").dataset.altitude || "100");
    cloud.dataset.baseAltitude = alt;
    cloud.dataset.baseTop = cloud.style.top;
    cloud.dataset.swaying = "true";
    container.appendChild(cloud);

    let frame = 0;
    const swayInterval = setInterval(() => {
        if (!document.body.contains(cloud)) {
            clearInterval(swayInterval);
            return;
        }
        if (cloud.dataset.swaying === "true") {
            const sway = Math.sin(frame / 20) * 1.5;
            cloud.style.top = `${parseFloat(cloud.dataset.baseTop) + sway}px`;
            frame++;
        }
    }, 100);
}

function startCloudFall(direction = "down") {
    document.querySelectorAll(".cloud").forEach(cloud => {
        cloud.dataset.swaying = "false";
    });

    if (cloudMoveInterval) clearInterval(cloudMoveInterval);
    cloudMoveInterval = setInterval(() => {
        document.querySelectorAll(".cloud").forEach(cloud => {
            const top = parseFloat(cloud.style.top);
            cloud.style.top = `${direction === "down" ? top + 3 : top - 3}px`;
        });
    }, 50);
}

function stopCloudFall() {
    if (cloudMoveInterval) clearInterval(cloudMoveInterval);
    cloudMoveInterval = null;

    document.querySelectorAll(".cloud").forEach(cloud => {
        cloud.dataset.baseTop = cloud.style.top;
        cloud.dataset.swaying = "true";
    });
}

// --- 移動履歴ボタン ---
document.getElementById("historyBtn").addEventListener("click", () => {
    fetch("/summary_all")
        .then(res => res.json())
        .then(data => {
            showHistoryPopup(data);
        });
});

document.getElementById("closePopup").addEventListener("click", () => {
    document.getElementById("historyPopup").classList.add("hidden");
});

function showHistoryPopup(data) {
    const labels = data.map(d => d.date);
    const totals = data.map(d => d.height_change);
    const ctx = document.getElementById("heightChart").getContext("2d");

    if (window.heightChart) window.heightChart.destroy();
    window.heightChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: labels,
            datasets: [{
                label: "総高度(m)",
                data: totals,
                borderColor: "skyblue",
                borderWidth: 2,
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
    const counts = { "寝食": 0, "仕事": 0, "知的活動": 0, "勉強": 0, "運動": 0, "ゲーム": 0 };

    for (const row of data) {
        for (const k in counts) counts[k] += row[k];
    }

    for (const k in counts) {
        const li = document.createElement("li");
        li.textContent = `${k}：${counts[k]} 回`;
        summaryList.appendChild(li);
    }

    document.getElementById("historyPopup").classList.remove("hidden");
}
