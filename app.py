from flask import Flask, render_template, request, jsonify
from datetime import datetime, timedelta
import os
import psycopg2
from contextlib import contextmanager

# ----------------------------
# Config
# ----------------------------
INITIAL_HEIGHT = 0          # 初期の累積高度を 0 に統一
MIN_HEIGHT = 0              # 累積高度の下限
DB_URL_ENV_KEY = "DATABASE_URL"

# ----------------------------
# App
# ----------------------------
app = Flask(__name__)
DATABASE_URL = os.environ.get(DB_URL_ENV_KEY)

# ----------------------------
# DB Utilities
# ----------------------------
@contextmanager
def db() -> psycopg2.extensions.connection:
    conn = psycopg2.connect(DATABASE_URL)
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()

def get_today() -> str:
    """
    ローカル時刻で 06:00 未満は前日扱い。
    返り値は 'YYYY-MM-DD' 文字列。
    """
    now = datetime.now()
    if now.hour < 6:
        now = now - timedelta(days=1)
    return now.strftime("%Y-%m-%d")

def init_db():
    with db() as conn:
        c = conn.cursor()
        c.execute("""
            CREATE TABLE IF NOT EXISTS logs (
                id SERIAL PRIMARY KEY,
                date TEXT NOT NULL,
                slot TEXT,
                activity TEXT NOT NULL,
                delta INTEGER DEFAULT 0,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        c.execute(f"""
            CREATE TABLE IF NOT EXISTS daily_summary (
                id SERIAL PRIMARY KEY,
                date TEXT UNIQUE,
                sleep_eat_count INTEGER DEFAULT 0,
                work_count INTEGER DEFAULT 0,
                thinking_count INTEGER DEFAULT 0,
                study_count INTEGER DEFAULT 0,
                exercise_count INTEGER DEFAULT 0,
                game_count INTEGER DEFAULT 0,
                cumulative_height INTEGER DEFAULT {INITIAL_HEIGHT},
                height_change INTEGER DEFAULT 0,
                bonus_given BOOLEAN DEFAULT FALSE
            )
        """)

def ensure_summary_row(date_str: str):
    """daily_summary に date の行がなければ初期値で作成"""
    with db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM daily_summary WHERE date = %s", (date_str,))
        exists = cur.fetchone() is not None
        if not exists:
            cur.execute("""
                INSERT INTO daily_summary
                    (date, cumulative_height, height_change, bonus_given)
                VALUES (%s, %s, %s, %s)
            """, (date_str, INITIAL_HEIGHT, 0, False))

COLUMN_MAP = {
    "寝食": "sleep_eat_count",
    "仕事": "work_count",
    "知的活動": "thinking_count",
    "勉強": "study_count",
    "運動": "exercise_count",
    "ゲーム": "game_count",
}

def apply_delta(date_str: str, delta: int, activity: str | None = None):
    """
    累積高度と当日変化を更新。必要なら行動カウントも加算。
    累積高度は MIN_HEIGHT 未満にならないよう抑止。
    """
    with db() as conn:
        cur = conn.cursor()

        if activity and activity in COLUMN_MAP:
            col = COLUMN_MAP[activity]
            cur.execute(
                f"""
                UPDATE daily_summary
                   SET {col} = {col} + 1,
                       height_change = height_change + %s,
                       cumulative_height = GREATEST(cumulative_height + %s, %s)
                 WHERE date = %s
                """,
                (delta, delta, MIN_HEIGHT, date_str),
            )
        else:
            cur.execute(
                """
                UPDATE daily_summary
                   SET height_change = height_change + %s,
                       cumulative_height = GREATEST(cumulative_height + %s, %s)
                 WHERE date = %s
                """,
                (delta, delta, MIN_HEIGHT, date_str),
            )

# ----------------------------
# Routes
# ----------------------------
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/log", methods=["POST"])
def log_action():
    """
    行動ログと高度反映。slot は任意。
    期待する JSON: { action: str, delta: int, slot?: str }
    """
    data = request.json or {}
    action = data.get("action")
    try:
        delta = int(data.get("delta", 0))
    except (TypeError, ValueError):
        delta = 0

    today = get_today()
    ensure_summary_row(today)

    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO logs (date, slot, activity, delta) VALUES (%s, %s, %s, %s)",
            (today, data.get("slot"), action, delta),
        )

    apply_delta(today, delta, activity=action)
    return jsonify({"status": "ok"})

@app.route("/apply_bonus", methods=["POST"])
def apply_bonus():
    """
    ボーナス反映。二重付与防止のため bonus_given を確認してから更新。
    期待する JSON: { bonus: int }
    """
    data = request.json or {}
    try:
        bonus = int(data.get("bonus", 0))
    except (TypeError, ValueError):
        bonus = 0

    today = get_today()
    ensure_summary_row(today)

    with db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT bonus_given FROM daily_summary WHERE date = %s", (today,))
        row = cur.fetchone()
        already = bool(row and row[0])
        if not already and bonus != 0:
            cur.execute(
                """
                UPDATE daily_summary
                   SET bonus_given = TRUE,
                       height_change = height_change + %s,
                       cumulative_height = GREATEST(cumulative_height + %s, %s)
                 WHERE date = %s
                """,
                (bonus, bonus, MIN_HEIGHT, today),
            )
    return jsonify({"status": "ok", "applied": (bonus != 0 and not already)})

@app.route("/answered_slots")
def answered_slots():
    date_str = request.args.get("date")
    if not date_str:
        return jsonify([])

    with db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT slot FROM logs WHERE date = %s AND slot IS NOT NULL", (date_str,))
        rows = cur.fetchall()
    return jsonify([r[0] for r in rows])

@app.route("/summary")
def get_summary():
    today = get_today()
    with db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM daily_summary WHERE date = %s", (today,))
        row = cur.fetchone()

    if not row:
        return jsonify({
            "寝食": 0, "仕事": 0, "知的活動": 0,
            "勉強": 0, "運動": 0, "ゲーム": 0,
            "高度": INITIAL_HEIGHT
        })

    return jsonify({
        "寝食": row[2], "仕事": row[3], "知的活動": row[4],
        "勉強": row[5], "運動": row[6], "ゲーム": row[7],
        "高度": row[8]
    })

@app.route("/summary_all")
def summary_all():
    with db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT date, sleep_eat_count, work_count, thinking_count,
                   study_count, exercise_count, game_count, cumulative_height
              FROM daily_summary
             ORDER BY date ASC
        """)
        rows = cur.fetchall()

    result = []
    for row in rows:
        result.append({
            "date": row[0],
            "寝食": row[1],
            "仕事": row[2],
            "知的活動": row[3],
            "勉強": row[4],
            "運動": row[5],
            "ゲーム": row[6],
            "height": row[7],
        })
    return jsonify(result)

@app.route("/bonus_status")
def bonus_status():
    today = get_today()
    with db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT bonus_given FROM daily_summary WHERE date = %s", (today,))
        row = cur.fetchone()
    return jsonify({"bonusGiven": bool(row[0]) if row else False})

@app.route("/current_altitude")
def current_altitude():
    today = get_today()
    with db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT cumulative_height FROM daily_summary WHERE date = %s", (today,))
        row = cur.fetchone()
    return jsonify({"altitude": int(row[0]) if row else int(INITIAL_HEIGHT)})

# ----------------------------
# Init & Run
# ----------------------------
init_db()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
