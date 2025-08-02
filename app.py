from flask import Flask, render_template, request, jsonify
from datetime import datetime
import os
import psycopg2

app = Flask(__name__)
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
    today = get_today()

    conn = get_connection()
    cur = conn.cursor()

    cur.execute("SELECT id FROM daily_summary WHERE date = %s", (today,))
    if cur.fetchone() is None:
        cur.execute("""
            INSERT INTO daily_summary (date, height, bonus_given)
            VALUES (%s, %s, %s)
        """, (today, 100, False))

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
                height_change = height_change + %s,
                cumulative_height = cumulative_height + %s
            WHERE date = %s
        """, (delta, delta, today))

        cur.execute("INSERT INTO logs (date, slot, activity) VALUES (%s, %s, %s)",
                    (today, data.get("slot"), action))
        conn.commit()
    conn.close()
    return jsonify({"status": "ok"})

@app.route("/summary")
def get_summary():
    today = get_today()
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM daily_summary WHERE date = %s", (today,))
    row = cur.fetchone()
    conn.close()
    if not row:
        return jsonify({"summary": "記録がありません"})

    return jsonify({
        "寝食": row[2], "仕事": row[3], "知的活動": row[4],
        "勉強": row[5], "運動": row[6], "ゲーム": row[7],
        "高度": row[8]
    })

@app.route("/summary_all")
def summary_all():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT date, sleep_eat_count, work_count, thinking_count,
               study_count, exercise_count, game_count, cumulative_height
        FROM daily_summary ORDER BY date
    """)
    rows = cur.fetchall()
    conn.close()
    return jsonify([
        {
            "date": r[0], "寝食": r[1], "仕事": r[2],
            "知的活動": r[3], "勉強": r[4], "運動": r[5],
            "ゲーム": r[6], "高度": r[7]
        } for r in rows
    ])

@app.route("/answered_slots")
def answered_slots():
    date = request.args.get("date")
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT slot FROM logs WHERE date = %s", (date,))
    rows = cur.fetchall()
    conn.close()
    return jsonify([r[0] for r in rows])

@app.route("/bonus_status")
def bonus_status():
    today = get_today()
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT bonus_given FROM daily_summary WHERE date = %s", (today,))
    row = cur.fetchone()
    conn.close()
    return jsonify({"bonusGiven": row[0] if row else False})

@app.route("/apply_bonus", methods=["POST"])
def apply_bonus():
    data = request.json
    bonus = data.get("bonus", 0)
    today = get_today()
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        UPDATE daily_summary
        SET height = height + %s, bonus_given = true
        WHERE date = %s
    """, (bonus, today))
    conn.commit()
    conn.close()
    return jsonify({"status": "ok"})

@app.route("/current_altitude")
def current_altitude():
    today = get_today()
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT cumulative_height FROM daily_summary WHERE date = %s", (today,))
    row = cur.fetchone()
    conn.close()
    return jsonify({"altitude": row[0] if row else 100})


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
            date TEXT UNIQUE,
            sleep_eat_count INTEGER DEFAULT 0,
            work_count INTEGER DEFAULT 0,
            thinking_count INTEGER DEFAULT 0,
            study_count INTEGER DEFAULT 0,
            exercise_count INTEGER DEFAULT 0,
            game_count INTEGER DEFAULT 0,
            height INTEGER DEFAULT 100,
            bonus_given BOOLEAN DEFAULT FALSE
        )
    ''')
    conn.commit()
    conn.close()

init_db()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
