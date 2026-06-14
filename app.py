from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import os
import threading

from flask import Flask, jsonify, render_template, request
import psycopg2

# ----------------------------
# Config
# ----------------------------
INITIAL_HEIGHT = 0
MIN_HEIGHT = 0
DB_URL_ENV_KEY = "DATABASE_URL"

app = Flask(__name__)
_db_initialized = False
_db_init_lock = threading.Lock()

# ----------------------------
# DB Utilities
# ----------------------------
def get_database_url() -> str:
    database_url = os.environ.get(DB_URL_ENV_KEY)
    if not database_url:
        raise RuntimeError(
            f"{DB_URL_ENV_KEY} is not set. "
            "Set it to the PostgreSQL connection URL before starting the app."
        )
    return database_url


@contextmanager
def db() -> psycopg2.extensions.connection:
    conn = psycopg2.connect(get_database_url())
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()

# 日本時間 (UTC+9)
JST = timezone(timedelta(hours=9))
SLOT_START_HOUR = 6
SLOT_COUNT = 38

def get_today() -> str:
    now = datetime.now(JST)  # ← JSTで現在時刻を取得
    if now.hour < 6:
        now = now - timedelta(days=1)
    return now.strftime("%Y-%m-%d")


def get_previous_business_day(date_str: str) -> str:
    return (datetime.strptime(date_str, "%Y-%m-%d").date() - timedelta(days=1)).strftime("%Y-%m-%d")


def get_slots_for_date(date_str: str) -> list[str]:
    day = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=JST)
    start = day.replace(hour=SLOT_START_HOUR, minute=0, second=0, microsecond=0)
    now = datetime.now(JST)
    current_business_day = get_today()
    slot_count = SLOT_COUNT

    if date_str == current_business_day:
        elapsed_minutes = max(0, int((now - start).total_seconds() // 60))
        slot_count = min(SLOT_COUNT, elapsed_minutes // 30)

    return [
        (start + timedelta(minutes=30 * i)).strftime("%H:%M")
        for i in range(slot_count)
    ]


def get_answered_slots(date_str: str) -> set[str]:
    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT slot FROM logs WHERE date = %s AND slot IS NOT NULL AND slot <> '-'",
            (date_str,),
        )
        rows = cur.fetchall()
    return {r[0] for r in rows}


def get_unanswered_slots(date_str: str) -> list[str]:
    answered = get_answered_slots(date_str)
    return [slot for slot in get_slots_for_date(date_str) if slot not in answered]


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


def ensure_db_initialized():
    global _db_initialized
    if _db_initialized:
        return
    with _db_init_lock:
        if not _db_initialized:
            init_db()
            _db_initialized = True


def ensure_summary_row(date_str: str):
    with db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM daily_summary WHERE date = %s", (date_str,))
        exists = cur.fetchone() is not None
        if not exists:
            # 指定日より前の累積高度を引き継ぐ
            cur.execute(
                """
                SELECT cumulative_height
                  FROM daily_summary
                 WHERE date < %s
                 ORDER BY date DESC
                 LIMIT 1
                """,
                (date_str,),
            )
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
                       height_change = height_change + %s
                 WHERE date = %s
                """,
                (delta, date_str),
            )
        else:
            cur.execute(
                """
                UPDATE daily_summary
                   SET height_change = height_change + %s
                 WHERE date = %s
                """,
                (delta, date_str),
            )
        cur.execute(
            """
            UPDATE daily_summary
               SET cumulative_height = GREATEST(cumulative_height + %s, %s)
             WHERE date >= %s
            """,
            (delta, MIN_HEIGHT, date_str),
        )

# ----------------------------
# Routes
# ----------------------------
@app.before_request
def prepare_database():
    if request.endpoint != "healthz":
        ensure_db_initialized()


@app.route("/healthz")
def healthz():
    return jsonify({"status": "ok"})


@app.route("/")
def index():
    return render_template("index.html")

@app.route("/log", methods=["POST"])
def log_action():
    data = request.json or {}
    action = data.get("action")
    date_str = data.get("date") or get_today()
    slot = data.get("slot")

    try:
        delta = int(data.get("delta", 0))
    except (TypeError, ValueError):
        delta = 0

    try:
        valid_slots = get_slots_for_date(date_str)
    except ValueError:
        return jsonify({"status": "error", "message": "invalid date"}), 400

    today = get_today()
    previous_day = get_previous_business_day(today)
    if date_str not in {previous_day, today}:
        return jsonify({"status": "error", "message": "date is out of range"}), 400

    if slot not in valid_slots:
        return jsonify({"status": "error", "message": "invalid slot"}), 400

    ensure_summary_row(date_str)

    now_jst = datetime.now(JST)  # ← JST時刻で固定

    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO logs (date, slot, activity, delta, timestamp) VALUES (%s, %s, %s, %s, %s)",
            (date_str, slot, action, delta, now_jst),
        )

    apply_delta(date_str, delta, activity=action)
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
    return jsonify(sorted(get_answered_slots(date_str)))


@app.route("/unanswered_slots")
def unanswered_slots():
    date_str = request.args.get("date")
    if not date_str:
        return jsonify({"date": None, "slots": []})
    try:
        slots = get_unanswered_slots(date_str)
    except ValueError:
        return jsonify({"status": "error", "message": "invalid date"}), 400
    return jsonify({"date": date_str, "slots": slots, "count": len(slots)})


@app.route("/startup_context")
def startup_context():
    today = get_today()
    previous_day = get_previous_business_day(today)
    previous_unanswered = get_unanswered_slots(previous_day)
    return jsonify({
        "today": today,
        "previousDate": previous_day,
        "previousUnansweredSlots": previous_unanswered,
        "previousUnansweredCount": len(previous_unanswered),
    })

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
    ensure_summary_row(today)  # ← ここでも必ず作る
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
    ensure_summary_row(today)  # ← 今日の行を必ず作る
    with db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT cumulative_height FROM daily_summary WHERE date = %s", (today,))
        row = cur.fetchone()
    return jsonify({"altitude": int(row[0]) if row else int(INITIAL_HEIGHT)})

@app.route("/weekly_goal")
def weekly_goal():
    with db() as conn:
        cur = conn.cursor()

        # 今日の週の開始日（月曜日）
        today = datetime.now(JST).date()
        start_of_week = today - timedelta(days=today.weekday())
        end_of_week = start_of_week + timedelta(days=6)

        # TEXT カラムに合わせて文字列に変換
        start_str = start_of_week.strftime("%Y-%m-%d")
        end_str = end_of_week.strftime("%Y-%m-%d")

        # 今週の高度合計を取得
        cur.execute("""
            SELECT COALESCE(SUM(height_change), 0)
            FROM daily_summary
            WHERE date BETWEEN %s AND %s
        """, (start_str, end_str))
        current_total = cur.fetchone()[0]

        silver_target = 200
        gold_target = 300
        next_target = gold_target if current_total >= silver_target else silver_target
        remaining = max(next_target - current_total, 0)
        progress = min(max(round((current_total / gold_target) * 100), 0), 100)
        award = "gold" if current_total >= gold_target else "silver" if current_total >= silver_target else None

    return jsonify({
        "silverTarget": silver_target,
        "goldTarget": gold_target,
        "target": gold_target,
        "current": current_total,
        "remaining": remaining,
        "progress": progress,
        "award": award,
        "silverAchieved": current_total >= silver_target,
        "goldAchieved": current_total >= gold_target,
        "achieved": current_total >= gold_target
    })

@app.route("/debug_db")
def debug_db():
    with db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT current_database(), inet_server_addr(), inet_server_port()")
        dbname, addr, port = cur.fetchone()
    return jsonify({"db": dbname, "addr": str(addr), "port": port})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
