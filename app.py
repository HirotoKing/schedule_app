from flask import Flask, render_template, request, jsonify
from datetime import datetime
import os
import psycopg2
import urllib.parse

app = Flask(__name__)

# DATABASE_URL のパース
def get_connection():
    db_url = os.environ.get("DATABASE_URL")
    if db_url is None:
        raise RuntimeError("DATABASE_URL is not set")
    parsed = urllib.parse.urlparse(db_url)
    return psycopg2.connect(
        dbname=parsed.path[1:],
        user=parsed.username,
        password=parsed.password,
        host=parsed.hostname,
        port=parsed.port
    )

from datetime import datetime, timedelta

def get_today():
    # UTCに+9時間でJSTに変換
    now = datetime.utcnow() + timedelta(hours=9)
    if now.hour < 6:
        now -= timedelta(days=1)
    return now.strftime("%Y-%m-%d")


@app.route("/")
def index():
    return render_template("index.html")

@app.route("/log", methods=["POST"])
def log_action():
    data = request.json
    action = data.get("action")
    delta = int(data.get("delta"))
    slot = data.get("slot")  # ← これを追加

    if action is None or delta is None:
        return jsonify({"status": "error", "message": "Invalid data"}), 400

    today = get_today()
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("SELECT id FROM daily_summary WHERE date = %s", (today,))
    if cur.fetchone() is None:
        cur.execute("INSERT INTO daily_summary (date) VALUES (%s)", (today,))

    # logsテーブルに記録（ここにtry-exceptを追加）
    try:
        cur.execute("INSERT INTO logs (date, slot, activity) VALUES (%s, %s, %s)", (today, slot, action))
    except Exception as e:
        print("ログの記録に失敗:", e)  # ← ここがポイント
        conn.rollback()
        conn.close()
        return jsonify({"status": "error", "message": "Log insert failed"}), 500



    column_map = {
        "寝食": "sleep_eat_count",
        "仕事": "work_count",
        "知的活動": "thinking_count",
        "勉強": "study_count",
        "運動": "exercise_count",
        "ゲーム": "game_count"
    }
    col = column_map.get(action)
    if col:
        cur.execute(f"""
            UPDATE daily_summary
            SET {col} = {col} + 1,
                height_change = height_change + %s
            WHERE date = %s
        """, (delta, today))
        conn.commit()
        conn.close()
        return jsonify({"status": "ok"})
    else:
        conn.close()
        return jsonify({"status": "error", "message": "Unknown action"}), 400

@app.route("/submit", methods=["POST"])
def submit_activity():
    data = request.get_json()
    date = get_today()
    slot = data.get("slot")
    activity = data.get("activity")

    if not slot or not activity:
        return jsonify({"status": "error", "message": "Invalid data"}), 400

    conn = get_connection()
    c = conn.cursor()
    c.execute("INSERT INTO logs (date, slot, activity) VALUES (%s, %s, %s)", (date, slot, activity))
    conn.commit()
    conn.close()

    return jsonify({"status": "ok"})

@app.route("/summary", methods=["GET"])
def get_summary():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT date, sleep_eat_count, work_count, thinking_count,
               study_count, exercise_count, game_count, height_change
        FROM daily_summary
        ORDER BY date DESC
        LIMIT 3
    """)
    rows = cur.fetchall()
    conn.close()

    if not rows:
        return jsonify({"summary": "記録がありません"})

    summary = []
    for row in reversed(rows):  # 古い順に並べたい場合は reversed
        summary.append({
            "日付": row[0],
            "寝食": row[1],
            "仕事": row[2],
            "知的活動": row[3],
            "勉強": row[4],
            "運動": row[5],
            "ゲーム": row[6],
            "高度変化": row[7]
        })

    return jsonify(summary)


@app.route("/answered_slots")
def answered_slots():
    date = request.args.get('date')
    conn = get_connection()
    c = conn.cursor()
    c.execute("SELECT slot FROM logs WHERE date = %s", (date,))
    slots = [row[0] for row in c.fetchall()]
    conn.close()
    return jsonify(slots)

@app.route("/summary_all")
def summary_all():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT date, sleep_eat_count, work_count, thinking_count,
               study_count, exercise_count, game_count, height_change
        FROM daily_summary
        ORDER BY date ASC
    """)
    rows = cur.fetchall()
    conn.close()

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
            "height_change": row[7]
        })
    return jsonify(result)

def init_db():
    conn = get_connection()
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS logs (
            id SERIAL PRIMARY KEY,
            date TEXT NOT NULL,
            slot TEXT NOT NULL,
            activity TEXT NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS daily_summary (
            id SERIAL PRIMARY KEY,
            date TEXT UNIQUE NOT NULL,
            sleep_eat_count INTEGER DEFAULT 0,
            work_count INTEGER DEFAULT 0,
            thinking_count INTEGER DEFAULT 0,
            study_count INTEGER DEFAULT 0,
            exercise_count INTEGER DEFAULT 0,
            game_count INTEGER DEFAULT 0,
            height_change INTEGER DEFAULT 100
        )
    ''')
    conn.commit()
    conn.close()

@app.route("/bonus_stats")
def bonus_stats():
    conn = get_connection()
    cur = conn.cursor()

    # ボーナス対象アクション
    bonus_actions = ["スマホ制限", "早寝早起き"]
    result = {}

    for action in bonus_actions:
        # 回答総数
        cur.execute("SELECT COUNT(*) FROM logs WHERE activity = %s", (action,))

        # 成功数（delta=10 → 高度が加算された記録）
        cur.execute("""
            SELECT COUNT(*) FROM logs 
            WHERE activity = %s AND date >= (CURRENT_DATE - INTERVAL '6 days')
        """, (action,))
        success = cur.fetchone()[0]

        # 率（パーセンテージ）
        rate = f"{round((success / 7) * 100)}%" if 7 > 0 else "0%"

        result[action] = {
            "成功": success,
            "合計": 7,
            "達成率": rate
        }

    conn.close()
    return jsonify(result)


# Render用
if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
