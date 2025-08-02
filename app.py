from flask import Flask, render_template, request, jsonify
import psycopg2
from datetime import datetime
import os
import urllib.parse as up

app = Flask(__name__)

# PostgreSQL接続情報（環境変数から取得するのがベスト）
DB_PARAMS = {
    "dbname": "your_db",
    "user": "your_user",
    "password": "your_password",
    "host": "localhost",
    "port": "5432"
}


def get_today():
    now = datetime.now()
    if now.hour < 6:
        now = now.replace(day=now.day - 1)
    return now.strftime("%Y-%m-%d")


def get_db_connection():
    # 環境変数 DATABASE_URL を使う（Render 推奨）
    url = os.environ.get('DATABASE_URL')
    if url is None:
        raise Exception("環境変数 DATABASE_URL が設定されていません")
    
    # Render のURLはURL形式なので解析が必要
    up.uses_netloc.append("postgres")
    db_url = up.urlparse(url)
    return psycopg2.connect(
        dbname=db_url.path[1:],
        user=db_url.username,
        password=db_url.password,
        host=db_url.hostname,
        port=db_url.port
    )


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/log", methods=["POST"])
def log_action():
    data = request.json
    action = data.get("action")
    delta = int(data.get("delta", 0))

    if action is None:
        return jsonify({"status": "error", "message": "Invalid data"}), 400

    today = get_today()
    conn = get_db_connection()
    cur = conn.cursor()

    # 初回なら行を作る
    cur.execute("SELECT id FROM daily_summary WHERE date = %s", (today,))
    if cur.fetchone() is None:
        cur.execute("""
            INSERT INTO daily_summary (date) VALUES (%s)
        """, (today,))

    # logs テーブルに記録
    cur.execute("""
        INSERT INTO logs (date, slot, activity)
        VALUES (%s, %s, %s)
    """, (today, "-", action))

    # 該当カラムをインクリメント
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


@app.route("/answered_slots")
def answered_slots():
    date = request.args.get("date")
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT slot FROM logs WHERE date = %s", (date,))
    rows = cur.fetchall()
    conn.close()
    return jsonify([r[0] for r in rows])


@app.route("/summary_all")
def summary_all():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT date, sleep_eat_count, work_count, thinking_count,
               study_count, exercise_count, game_count, height_change
        FROM daily_summary
        ORDER BY date
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
    conn = get_db_connection()
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS logs (
            id SERIAL PRIMARY KEY,
            date TEXT NOT NULL,
            slot TEXT NOT NULL,
            activity TEXT NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS daily_summary (
            id SERIAL PRIMARY KEY,
            date TEXT UNIQUE,
            sleep_eat_count INTEGER DEFAULT 0,
            work_count INTEGER DEFAULT 0,
            thinking_count INTEGER DEFAULT 0,
            study_count INTEGER DEFAULT 0,
            exercise_count INTEGER DEFAULT 0,
            game_count INTEGER DEFAULT 0,
            height_change INTEGER DEFAULT 0
        )
    """)

    conn.commit()
    conn.close()


if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
