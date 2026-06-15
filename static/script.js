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
let activeQuestionDate = null;
let activeQuestionLabel = "今日";
let returnToTodayAfterCurrentDate = false;
let timeThemeInterval = null;
let lastCelebratedMilestone = 0;

// ----------------------------
// 共通ユーティリティ
// ----------------------------
function disableButtons() {
    document.querySelectorAll(".button-grid button").forEach(btn => btn.disabled = true);
}
function enableButtons() {
    document.querySelectorAll(".button-grid button").forEach(btn => btn.disabled = false);
}

function getTimeTheme(hour) {
    if (hour >= 5 && hour < 10) return "morning";
    if (hour >= 10 && hour < 17) return "day";
    if (hour >= 17 && hour < 20) return "evening";
    return "night";
}

function getJapanHour() {
    const hourText = new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        hour: "2-digit",
        hour12: false
    }).format(new Date());
    return Number(hourText);
}

function applyTimeTheme() {
    const top = document.querySelector(".top");
    if (!top) return;
    const theme = getTimeTheme(getJapanHour());
    top.classList.remove("morning", "day", "evening", "night");
    top.classList.add(theme);
}

function startTimeThemeClock() {
    applyTimeTheme();
    if (timeThemeInterval) clearInterval(timeThemeInterval);
    timeThemeInterval = setInterval(applyTimeTheme, 60 * 1000);
}

function initializeMilestoneState(altitude) {
    lastCelebratedMilestone = Math.floor(altitude / 100) * 100;
}

function maybeCelebrateMilestone(previousAltitude, currentAltitude) {
    if (currentAltitude <= previousAltitude || currentAltitude < 100) return;

    const milestone = Math.floor(currentAltitude / 100) * 100;
    if (milestone > lastCelebratedMilestone) {
        lastCelebratedMilestone = milestone;
        showMilestoneCelebration(milestone);
    }
}

function showMilestoneCelebration(milestone) {
    const toast = document.getElementById("milestoneToast");
    const sparkleLayer = document.getElementById("sparkleLayer");
    if (!toast || !sparkleLayer) return;

    toast.textContent = `${milestone}m到達！`;
    toast.classList.remove("hidden", "show");
    void toast.offsetWidth;
    toast.classList.add("show");

    sparkleLayer.innerHTML = "";
    for (let i = 0; i < 18; i++) {
        const sparkle = document.createElement("span");
        sparkle.className = "sparkle";
        sparkle.style.left = `${12 + Math.random() * 76}%`;
        sparkle.style.top = `${18 + Math.random() * 56}%`;
        sparkle.style.animationDelay = `${Math.random() * 0.25}s`;
        sparkle.style.setProperty("--sparkle-x", `${Math.random() * 80 - 40}px`);
        sparkle.style.setProperty("--sparkle-y", `${-20 - Math.random() * 70}px`);
        sparkleLayer.appendChild(sparkle);
    }

    setTimeout(() => {
        toast.classList.remove("show");
    }, 1800);
    setTimeout(() => {
        toast.classList.add("hidden");
        sparkleLayer.innerHTML = "";
    }, 2300);
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
        const previous = current;
        current += step;
        altElem.innerText = `高度：${current}m`;
        altElem.dataset.altitude = current;
        maybeCelebrateMilestone(previous, current);
    }, 100);
}

// ----------------------------
// 行動記録と質問処理
// ----------------------------
function handleButtonClick(activity) {
    // --- すでに質問が完了している場合は処理しない ---
    if (currentSlotIndex >= unansweredSlots.length) {
        return;
    }

    disableButtons();
    const slot = unansweredSlots[currentSlotIndex];
    if (!slot) {
        enableButtons();
        return;
    }

    const point = ACTIVITY_POINTS[activity] ?? 0;
    const logPromise = sendActivityToServer(slot, activity, point);
    updateAltitudeSmoothly(point, () => {
        currentSlotIndex++;
        logPromise.finally(fetchWeeklyGoal);
        askNextSlot();
    });
}


function startQuestioning(date, options = {}) {
    activeQuestionDate = date;
    activeQuestionLabel = options.label || "今日";
    returnToTodayAfterCurrentDate = Boolean(options.returnToToday);

    fetchUnansweredSlots(date).then(slots => {
        unansweredSlots = slots;
        if (unansweredSlots.length === 0) {
            finishCurrentQuestionSet();
        } else {
            currentSlotIndex = 0;
            if (options.skipBonus) {
                startMainQuestions();
            } else {
                fetchAnsweredSlots(date).then(answered => {
                    checkBonusStatus().then(bonusGiven => {
                        if (answered.length === 0 && !bonusGiven) {
                            showBonusQuestions();
                        } else {
                            startMainQuestions();
                        }
                    });
                });
            }
        }
        document.getElementById("todayDate").innerText = `${activeQuestionLabel}の日付：${date}`;
    });
}

async function startAppQuestioning() {
    const context = await fetchStartupContext();
    const skipKey = getYesterdaySkipKey(context.previousDate);
    const skippedYesterday = localStorage.getItem(skipKey) === "true";

    if (context.previousUnansweredCount > 0 && !skippedYesterday) {
        showResumeYesterdayPrompt(context);
        return;
    }

    startQuestioning(context.today);
}

function showResumeYesterdayPrompt(context) {
    document.getElementById("resumeYesterdayMessage").innerText =
        `昨日の未記録データがあります（${context.previousUnansweredCount}件）\n\n昨日の続きを入力しますか？`;
    document.getElementById("resumeYesterdayPopup").classList.remove("hidden");

    document.getElementById("resumeYesterdayBtn").onclick = () => {
        document.getElementById("resumeYesterdayPopup").classList.add("hidden");
        startQuestioning(context.previousDate, {
            label: "昨日",
            skipBonus: true,
            returnToToday: true
        });
    };

    document.getElementById("skipYesterdayBtn").onclick = () => {
        localStorage.setItem(getYesterdaySkipKey(context.previousDate), "true");
        document.getElementById("resumeYesterdayPopup").classList.add("hidden");
        startQuestioning(context.today);
    };
}

function getYesterdaySkipKey(date) {
    return `skipYesterday:${date}`;
}

function finishCurrentQuestionSet() {
    document.getElementById("question").innerText = `${activeQuestionLabel}のすべての質問が完了しました。`;
    if (returnToTodayAfterCurrentDate) {
        returnToTodayAfterCurrentDate = false;
        fetchStartupContext().then(context => {
            startQuestioning(context.today);
        });
    }
}

async function fetchStartupContext() {
    const res = await fetch("/startup_context");
    return await res.json();
}

async function fetchUnansweredSlots(date) {
    const res = await fetch(`/unanswered_slots?date=${date}`);
    const data = await res.json();
    return data.slots || [];
}

function askNextSlot() {
    if (currentSlotIndex >= unansweredSlots.length) {
        finishCurrentQuestionSet();
        return;
    }
    const slot = unansweredSlots[currentSlotIndex];
    const nextTime = getNextHalfHour(slot);
    document.getElementById("question").innerText = `${activeQuestionLabel}${slot}〜${nextTime}の間、何をしていましたか？`;
}

function sendActivityToServer(slot, activity, delta) {
    return fetch("/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: activeQuestionDate, action: activity, slot, delta })
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

    // ボーナス回答ボタン
    document.getElementById("bonusSubmit").onclick = async () => {
        const q1 = document.getElementById("q1").checked;
        const q2 = document.getElementById("q2").checked;
        let bonus = 0;
        if (q1) bonus += 10;
        if (q2) bonus += 10;

        document.getElementById("bonusPopup").classList.add("hidden");

        if (bonus > 0) {
            await fetch("/apply_bonus", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ bonus, q1, q2 })
            });
            updateAltitudeSmoothly(bonus, () => {
                fetchWeeklyGoal();
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

async function fetchWeeklyGoal() {
    const res = await fetch("/weekly_goal");
    const data = await res.json();
    const weeklyGoal = document.getElementById("weeklyGoal");
    let statusText = `銀賞まであと${data.remaining}m`;
    if (data.goldAchieved) {
        statusText = "金賞達成";
    } else if (data.silverAchieved) {
        statusText = `銀賞達成・金賞まであと${data.remaining}m`;
    }

    weeklyGoal.innerHTML = `
        <div class="weekly-goal-header">
            <span>今週の目標</span>
            <strong>${statusText}</strong>
        </div>
        <div class="weekly-goal-progress">
            <div class="weekly-goal-progress-fill" style="width: ${data.progress}%"></div>
            <div class="weekly-goal-silver-marker" style="left: ${(data.silverTarget / data.goldTarget) * 100}%"></div>
        </div>
        <div class="weekly-goal-detail">${data.current}m / 金賞${data.goldTarget}m (${data.progress}%)・銀賞${data.silverTarget}m</div>
    `;
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

                    // 回数 → 時間換算（0.5h単位, 小数点1桁）
                    const sleepEat = (day["寝食"] * 0.5).toFixed(1);
                    const work     = (day["仕事"] * 0.5).toFixed(1);
                    const think    = (day["知的活動"] * 0.5).toFixed(1);
                    const study    = (day["勉強"] * 0.5).toFixed(1);
                    const exercise = (day["運動"] * 0.5).toFixed(1);
                    const game     = (day["ゲーム"] * 0.5).toFixed(1);

                    tr.innerHTML = `
                        <td>${day.date}</td>
                        <td>${sleepEat}h</td>
                        <td>${work}h</td>
                        <td>${think}h</td>
                        <td>${study}h</td>
                        <td>${exercise}h</td>
                        <td>${game}h</td>
                        <td>${day.height_change ?? day.change ?? 0}</td>
                    `;
                    tbody.appendChild(tr);
                });
            }

            // --- 円グラフ用データ集計（寝食も含む） ---
            const totalCounts = { "寝食": 0, "仕事": 0, "知的活動": 0, "勉強": 0, "運動": 0, "ゲーム": 0 };
            last7Days.forEach(day => {
                for (const key in totalCounts) {
                    totalCounts[key] += day[key];
                }
            });

            const labels = Object.keys(totalCounts);
            const values = Object.values(totalCounts).map(v => (v * 0.5).toFixed(1));
            const totalHours = values.reduce((a, b) => parseFloat(a) + parseFloat(b), 0).toFixed(1);

            // --- 中央に合計時間を表示するプラグイン ---
            const centerText = {
                id: "centerText",
                beforeDraw(chart) {
                    const { ctx, chartArea: { width, height } } = chart;
                    ctx.save();
                    ctx.font = "bold 18px sans-serif";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillStyle = "#333";
                    ctx.fillText(`${totalHours}h`, width / 2, height / 2);
                }
            };

            // --- 円グラフ描画 ---
            const ctx = document.getElementById("weekChart").getContext("2d");
            if (window.weekChart && typeof window.weekChart.destroy === "function") {
                window.weekChart.destroy();
            }
            window.weekChart = new Chart(ctx, {
                type: "doughnut",
                data: {
                    labels: labels,
                    datasets: [{
                        data: values,
                        backgroundColor: ["#FFD700", "#87CEEB", "#FF7F50", "#90EE90", "#9370DB", "#FF6347"]
                    }]
                },
                options: {
                    plugins: {
                        tooltip: {
                            callbacks: {
                                label: (context) => `${context.label}: ${context.formattedValue}h`
                            }
                        },
                        legend: {
                            position: "bottom"
                        }
                    }
                },
                plugins: [centerText]
            });

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
    startTimeThemeClock();
    const altitude = await fetchCurrentAltitude();
    const altElem = document.getElementById("altimeter");
    altElem.dataset.altitude = altitude;
    altElem.innerText = `高度：${altitude}m`;
    initializeMilestoneState(altitude);
    startAppQuestioning();
    initClouds();
    maintainClouds();
    // --- 週目標の取得 ---
    fetchWeeklyGoal();
};
