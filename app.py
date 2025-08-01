
from flask import Flask, render_template, request, jsonify
import sqlite3
from datetime import datetime
import os
import psycopg2

app = Flask(__name__)
DB_PATH = "schedule.db"
DATABASE_URL = os.environ.get("DATABASE_URL")
def get_connection():
    return psycopg2.connect(DATABASE_URL)


def get_today():
    now = datetime.now()
    if now.hour < 6:
        now = now.replace(day=now.day - 1)
    return now.strftime("%Y-%m-%d")

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/log", methods=["POST"])
def log_action():
    data = request.json
    action = data.get("action")
    delta = int(data.get("delta"))

    if action is None or delta is None:
        return jsonify({"status": "error", "message": "Invalid data"}), 400

    today = get_today()
    conn = get_connection()
    cur = conn.cursor()

    # 初回なら行を作る
    cur.execute("SELECT id FROM daily_summary WHERE date = ?", (today,))
    if cur.fetchone() is None:
        cur.execute("""
            INSERT INTO daily_summary (date) VALUES (?)
        """, (today,))

    # 該当カラムをインクリメント、高度も加算
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
        cur.execute(f"""UPDATE daily_summary
            SET {col} = {col} + 1,
                height_change = height_change + ?
            WHERE date = ?
        """, (delta, today))
        conn.commit()
        conn.close()
        return jsonify({"status": "ok"})
    else:
        conn.close()
        return jsonify({"status": "error", "message": "Unknown action"}), 400

@app.route("/summary", methods=["GET"])
def get_summary():
    today = get_today()
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM daily_summary WHERE date = ?", (today,))
    row = cur.fetchone()
    conn.close()

    if not row:
        return jsonify({"summary": "記録がありません"})

    summary = {
        "寝食": row[2],
        "仕事": row[3],
        "知的活動": row[4],
        "勉強": row[5],
        "運動": row[6],
        "ゲーム": row[7],
        "高度変化": row[8]
    }
    return jsonify(summary)

@app.route('/answered_slots')
def answered_slots():
    date = request.args.get('date')
    conn = get_connection()
    c = conn.cursor()
    c.execute("SELECT slot FROM logs WHERE date = ?", (date,))
    slots = [row[0] for row in c.fetchall()]
    conn.close()
    return jsonify(slots)

def init_db():
    conn = get_connection()
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            slot TEXT NOT NULL,
            activity TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

init_db()

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
    c.execute("INSERT INTO logs (date, slot, activity) VALUES (?, ?, ?)", (date, slot, activity))
    conn.commit()
    conn.close()

    return jsonify({"status": "ok"})

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



if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
