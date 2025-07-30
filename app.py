from flask import Flask, request, redirect, render_template
from werkzeug.security import check_password_hash, generate_password_hash
from functools import wraps
import sqlite3
import datetime
from flask import Response

app = Flask(__name__)

USERNAME = "admin"
PASSWORD_HASH = generate_password_hash("yourpassword")

def init_db():
    conn = sqlite3.connect('schedule.db')
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS schedule (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            content TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

init_db()

def check_auth(username, password):
    return username == USERNAME and check_password_hash(PASSWORD_HASH, password)

def authenticate():
    return Response(
        '認証が必要です', 401,
        {'WWW-Authenticate': 'Basic realm="Login Required"'}
    )

def requires_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth = request.authorization
        if not auth or not check_auth(auth.username, auth.password):
            return authenticate()
        return f(*args, **kwargs)
    return decorated

@app.route("/", methods=["GET", "POST"])
@requires_auth
def index():
    conn = sqlite3.connect('schedule.db')
    c = conn.cursor()

    if request.method == "POST":
        date = request.form.get("date")
        content = request.form.get("content")
        if date and content:
            c.execute("INSERT INTO schedule (date, content) VALUES (?, ?)", (date, content))
            conn.commit()

    c.execute("SELECT * FROM schedule ORDER BY date")
    schedules = c.fetchall()
    conn.close()
    return render_template("index.html", schedules=schedules)

@app.route("/delete/<int:item_id>")
@requires_auth
def delete(item_id):
    conn = sqlite3.connect('schedule.db')
    c = conn.cursor()
    c.execute("DELETE FROM schedule WHERE id=?", (item_id,))
    conn.commit()
    conn.close()
    return redirect("/")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)