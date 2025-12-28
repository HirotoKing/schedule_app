import sqlite3

conn = sqlite3.connect("schedule.db")
c = conn.cursor()

# logs テーブルの中身を表示
print("=== logs テーブル ===")
for row in c.execute("SELECT * FROM logs"):
    print(row)

print("\n=== daily_summary テーブル ===")
for row in c.execute("SELECT * FROM daily_summary"):
    print(row)

conn.close()