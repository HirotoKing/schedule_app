import os

import psycopg2


DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise SystemExit("DATABASE_URL is not set.")


with psycopg2.connect(DATABASE_URL) as conn:
    with conn.cursor() as cur:
        print("=== logs table ===")
        cur.execute(
            """
            SELECT id, date, slot, activity, delta, timestamp
              FROM logs
             ORDER BY id DESC
             LIMIT 50
            """
        )
        for row in cur.fetchall():
            print(row)

        print("\n=== daily_summary table ===")
        cur.execute(
            """
            SELECT date, sleep_eat_count, work_count, thinking_count,
                   study_count, exercise_count, game_count,
                   cumulative_height, height_change, bonus_given
              FROM daily_summary
             ORDER BY date DESC
             LIMIT 50
            """
        )
        for row in cur.fetchall():
            print(row)
