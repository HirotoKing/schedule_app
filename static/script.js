// ----------------------------
// 定数定義
// ----------------------------
const ACTIVITY_POINTS = {
    "寝食": 0,
    "仕事": 1,
    "知的活動": 5,
    "勉強": 10,
    "運動": 10,
    "ゲーム": -5
};

let unansweredSlots = [];
let currentSlotIndex = 0;
let cloudMoveInterval = null;

// ----------------------------
// 共通ユーティリティ
// ----------------------------
function disableButtons() {
    document.querySelectorAll(".button-grid button").forEach(btn => btn.disabled = true);
}
function enableButtons() {
    document.querySelectorAll(".button-grid button").forEach(btn => btn.disabled = false);
}

// ----------------------------
// 高度処理
// ----------------------------
function updateAltitudeSmoothly(change, callback) {
    const altElem = document.getElementById("altimeter");
    const balloon = document.getElementById("balloon");
    let current = parseInt(altElem.dataset.altitude || "0");
    const target = current + change;
    const warning = document.getElementById("warning");

    warning.innerText = "";
    disableButtons();

    if (target < 0) {
        altElem.innerText = "高度：0m";
        altElem.dataset.altitude = "0";
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
            if (target > 0) balloon.classList.add("floating");
            stopCloudFall();
            enableButtons();
            if (callback) callback();
            return;
        }
        current += step;
        altElem.innerText = `高度：${current}m`;
        altElem.dataset.altitude = current;
    }, 100);
}

// ----------------------------
// 行動記録と質問処理
// ----------------------------
function handleButtonClick(activity) {
    disableButtons();
    const slot = unansweredSlots[currentSlotIndex];
    const point = ACTIVITY_POINTS[activity] ?? 0;

    sendActivityToServer(slot, activity, point);
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
            checkBonusStatus().then(bonusGiven => {
                if (answered.length === 0 && !bonusGiven) {
                    showBonusQuestions();
                } else {
                    startMainQuestions();
                }
            });
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

function sendActivityToServer(slot, activity, delta) {
    fetch("/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: activity, slot, delta })
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

// ----------------------------
// ボーナス質問処理
// ----------------------------
async function checkBonusStatus() {
    const res = await fetch("/bonus_status");
    const data = await res.json();
    return data.bonusGiven;
}

function showBonusQuestions() {
    const popup = document.getElementById("bonusPopup");
    popup.classList.remove("hidden");

    document.getElementById("bonusSubmit").onclick = async () => {
        const q1 = document.getElementById("q1").checked;
        const q2 = document.getElementById("q2").checked;
        let bonus = 0;
        if (q1) bonus += 10;
        if (q2) bonus += 10;

        popup.classList.add("hidden");

        await fetch("/apply_bonus", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bonus, q1, q2 })
        });

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

// ----------------------------
// 雲処理
// ----------------------------
function initClouds() {
    const count = Math.floor(Math.random() * 2) + 2;
    for (let i = 0; i < count; i++) createFloatingCloud();
}

function maintainClouds() {
    const container = document.getElementById("cloudContainer");
    setInterval(() => {
        const clouds = container.querySelectorAll(".cloud");
        const alt = parseInt(document.getElementById("altimeter").dataset.altitude || "0");

        clouds.forEach(cloud => {
            const base = parseInt(cloud.dataset.baseAltitude || "0");
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

    const alt = parseInt(document.getElementById("altimeter").dataset.altitude || "0");
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

// ----------------------------
// 移動履歴ポップアップ
// ----------------------------
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

document.getElementById("weekBtn").addEventListener("click", () => {
    fetch("/summary_all")
        .then(res => res.json())
        .then(data => {
            const today = new Date(); today.setHours(0,0,0,0);
            const last7Days = data.filter(d => {
                const dDate = new Date(d.date);
                return (today - dDate) / (1000 * 60 * 60 * 24) <= 6;
            });

            const tbody = document.querySelector("#weekTable tbody");
            tbody.innerHTML = "";
            if (last7Days.length === 0) {
                const tr = document.createElement("tr");
                tr.innerHTML = `<td colspan="8">データがありません</td>`;
                tbody.appendChild(tr);
            } else {
                last7Days.forEach(day => {
                    const tr = document.createElement("tr");
                    tr.innerHTML = `
                        <td>${day.date}</td>
                        <td>${day["寝食"]}</td>
                        <td>${day["仕事"]}</td>
                        <td>${day["知的活動"]}</td>
                        <td>${day["勉強"]}</td>
                        <td>${day["運動"]}</td>
                        <td>${day["ゲーム"]}</td>
                        <td>${day.height}</td>
                    `;
                    tbody.appendChild(tr);
                });
            }
            document.getElementById("weekPopup").classList.remove("hidden");
        });
});

document.getElementById("closeWeek").addEventListener("click", () => {
    document.getElementById("weekPopup").classList.add("hidden");
});

function showHistoryPopup(data) {
    const labels = data.map(d => d.date);
    const heights = data.map(d => d.height);

    const ctx = document.getElementById("heightChart").getContext("2d");
    if (window.heightChart && typeof window.heightChart.destroy === "function") {
        window.heightChart.destroy();
    }
    window.heightChart = new Chart(ctx, {
        type: "line",
        data: {
            labels,
            datasets: [{
                label: "累積高度(m)",
                data: heights,
                borderColor: "skyblue",
                borderWidth: 2,
                fill: false
            }]
        },
        options: { responsive: false, scales: { y: { beginAtZero: true } } }
    });

    const summaryList = document.getElementById("summaryList");
    summaryList.innerHTML = "";
    const totalCounts = { "寝食": 0, "仕事": 0, "知的活動": 0, "勉強": 0, "運動": 0, "ゲーム": 0 };

    for (const row of data) {
        for (const key in totalCounts) {
            totalCounts[key] += row[key];
        }
    }

    for (const key in totalCounts) {
        const li = document.createElement("li");
        li.textContent = `${key}：${totalCounts[key]} 回`;
        summaryList.appendChild(li);
    }

    // --- ボーナス達成率の追加 ---
    fetch("/bonus_stats")
        .then(res => res.json())
        .then(stats => {
            const s1 = stats["スマホ6時間"];
            const s2 = stats["早寝早起き"];

            const li1 = document.createElement("li");
            li1.textContent = `スマホ6時間: ${Math.round((s1.success / s1.total) * 100)}% (${s1.success}/${s1.total})`;
            summaryList.appendChild(li1);

            const li2 = document.createElement("li");
            li2.textContent = `早寝早起き: ${Math.round((s2.success / s2.total) * 100)}% (${s2.success}/${s2.total})`;
            summaryList.appendChild(li2);
        });

    document.getElementById("historyPopup").classList.remove("hidden");
}

// ----------------------------
// 初期ロード
// ----------------------------
async function fetchCurrentAltitude() {
    const res = await fetch("/current_altitude");
    const data = await res.json();
    return data.altitude;
}

window.onload = async () => {
    const today = new Date().toISOString().split('T')[0];
    const altitude = await fetchCurrentAltitude();
    const altElem = document.getElementById("altimeter");
    altElem.dataset.altitude = altitude;
    altElem.innerText = `高度：${altitude}m`;
    startQuestioning(today);
    initClouds();
    maintainClouds();
};
