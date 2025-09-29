from flask import Flask, render_template, request, jsonify
from datetime import datetime, timedelta
import os
import psycopg2
from contextlib import contextmanager

# ----------------------------
# Config
# ----------------------------
INITIAL_HEIGHT = 0
MIN_HEIGHT = 0
DB_URL_ENV_KEY = "DATABASE_URL"

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
    with db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM daily_summary WHERE date = %s", (date_str,))
        exists = cur.fetchone() is not None
        if not exists:
            # 昨日の累積高度を引き継ぐ
            cur.execute("SELECT cumulative_height FROM daily_summary ORDER BY date DESC LIMIT 1")
            prev = cur.fetchone()
            prev_height = prev[0] if prev else INITIAL_HEIGHT
            cur.execute("""
                INSERT INTO daily_summary
                    (date, cumulative_height, height_change, bonus_given)
                VALUES (%s, %s, %s, %s)
            """, (date_str, prev_height, 0, False))


COLUMN_MAP = {
    "寝食": "sleep_eat_count",
    "仕事": "work_count",
    "知的活動": "thinking_count",
    "勉強": "study_count",
    "運動": "exercise_count",
    "ゲーム": "game_count",
}

def apply_delta(date_str: str, delta: int, activity: str | None = None):
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
    data = request.json or {}
    try:
        bonus = int(data.get("bonus", 0))
    except (TypeError, ValueError):
        bonus = 0

    q1 = data.get("q1", False)
    q2 = data.get("q2", False)

    today = get_today()
    ensure_summary_row(today)

    with db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT bonus_given FROM daily_summary WHERE date = %s", (today,))
        row = cur.fetchone()
        already = bool(row and row[0])

        if not already:
            # 回答済みにする
            if bonus > 0:
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
            else:
                cur.execute("UPDATE daily_summary SET bonus_given = TRUE WHERE date = %s", (today,))

            # ログ記録
            if q1:
                cur.execute("INSERT INTO logs (date, slot, activity, delta) VALUES (%s, %s, %s, %s)",
                            (today, "-", "bonus_スマホ6h", 10))
            else:
                cur.execute("INSERT INTO logs (date, slot, activity, delta) VALUES (%s, %s, %s, %s)",
                            (today, "-", "bonus_スマホ6h失敗", 0))
            if q2:
                cur.execute("INSERT INTO logs (date, slot, activity, delta) VALUES (%s, %s, %s, %s)",
                            (today, "-", "bonus_早寝早起き", 10))
            else:
                cur.execute("INSERT INTO logs (date, slot, activity, delta) VALUES (%s, %s, %s, %s)",
                            (today, "-", "bonus_早寝早起き失敗", 0))

    return jsonify({"status": "ok", "applied": (not already)})


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
                   study_count, exercise_count, game_count,
                   cumulative_height, height_change
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
            "change": row[8],   # 高度変化量
        })
    return jsonify(result)


@app.route("/bonus_status")
def bonus_status():
    today = get_today()
    # 今日の行がまだなければ必ず作る（昨日の高度を引き継いで初期化）
    ensure_summary_row(today)
    with db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT bonus_given FROM daily_summary WHERE date = %s", (today,))
        row = cur.fetchone()
    return jsonify({"bonusGiven": bool(row[0]) if row else False})


@app.route("/bonus_stats")
def bonus_stats():
    with db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT date::date, activity FROM logs
             WHERE activity LIKE 'bonus_%'
               AND date::date >= (CURRENT_DATE - INTERVAL '6 days')
        """)
        rows = cur.fetchall()

    days = {}
    for date, activity in rows:
        if date not in days:
            days[date] = {"スマホ6時間": False, "早寝早起き": False}
        if activity == "bonus_スマホ6h":
            days[date]["スマホ6時間"] = True
        if activity == "bonus_早寝早起き":
            days[date]["早寝早起き"] = True

    total = 7
    s1_success = sum(1 for v in days.values() if v["スマホ6時間"])
    s2_success = sum(1 for v in days.values() if v["早寝早起き"])

    return jsonify({
        "スマホ6時間": {"success": s1_success, "total": total},
        "早寝早起き": {"success": s2_success, "total": total}
    })


@app.route("/current_altitude")
def current_altitude():
    today = get_today()
    # 今日の行がまだ無ければ、ここで必ず作る（昨日の高度を引き継ぐ）
    ensure_summary_row(today)
    with db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT cumulative_height FROM daily_summary WHERE date = %s", (today,))
        row = cur.fetchone()
    return jsonify({"altitude": int(row[0]) if row else int(INITIAL_HEIGHT)})


init_db()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
