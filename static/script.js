
const altimeter = document.getElementById("altimeter");
const balloon = document.getElementById("balloon");
const buttons = document.querySelectorAll(".button-grid button");
const questionBox = document.getElementById("questionBox");
const historyBtn = document.getElementById("historyBtn");
const historyPopup = document.getElementById("historyPopup");
const closePopup = document.getElementById("closePopup");
const historyList = document.getElementById("historyList");

let height = parseInt(localStorage.getItem("height") || "0");
let log = JSON.parse(localStorage.getItem("log") || "{}");

function updateDisplay() {
  altimeter.textContent = `高度：${height}m`;
  if (height > 0) {
    balloon.classList.add("float");
  } else {
    balloon.classList.remove("float");
  }
}

function getTodayKey() {
  const d = new Date();
  if (d.getHours() < 6) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function getSlots() {
  const realNow = new Date(); // 実際の現在時刻（例：1:00）
  const targetDate = new Date(realNow);
  if (realNow.getHours() < 6) targetDate.setDate(targetDate.getDate() - 1); // 昨日扱いに修正

  let start = new Date(targetDate); // ← ここを let に変更！
  start.setHours(6, 0, 0, 0);

  const slots = [];
  while (start < realNow && start.getHours() < 25) {
    let end = new Date(start);
    end.setMinutes(end.getMinutes() + 30);
    slots.push({
      key: `${start.getHours()}:${String(start.getMinutes()).padStart(2, '0')}`,
      range: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}〜${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`,
      time: start.toISOString()
    });
    start = end; // ✅ let にしたからOK
  }
  return slots;
}


let todayKey = getTodayKey();
let slots = getSlots();
let currentSlot = slots.find(s => !log[s.time]);

function askNextQuestion() {
  if (currentSlot) {
    questionBox.textContent = `${currentSlot.range} の間、何をしていた？`;
  } else {
    questionBox.textContent = "今日のすべての質問が完了しました。";
  }
}

buttons.forEach(btn => {
  btn.addEventListener("click", () => {
    if (!currentSlot) return;
    const delta = parseInt(btn.dataset.change);
    const action = btn.textContent;
    height = Math.max(0, height + delta);
    log[currentSlot.time] = { label: action, delta: delta };
    localStorage.setItem("height", height);
    localStorage.setItem("log", JSON.stringify(log));
    updateDisplay();
    slots = getSlots();
    currentSlot = slots.find(s => !log[s.time]);
    askNextQuestion();

    // 🔁 DBへ送信（Flaskの /log を呼ぶ）
    fetch("/log", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action: action, delta: delta })
    }).catch(err => console.error("DB送信エラー:", err));
  });
});

historyBtn.addEventListener("click", () => {
  historyList.innerHTML = "";
  fetch("/summary")
    .then(res => res.json())
    .then(data => {
      for (const [label, count] of Object.entries(data)) {
        const li = document.createElement("li");
        li.textContent = `${label}：${count}`;
        historyList.appendChild(li);
      }
    });
  historyPopup.classList.remove("hidden");
});

closePopup.addEventListener("click", () => {
  historyPopup.classList.add("hidden");
});

updateDisplay();
askNextQuestion();
