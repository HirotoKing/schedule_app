# Schedule App

スマホ向けのFlask + PostgreSQLスケジュール記録アプリです。

## 構成

- `app.py`: Flask API、PostgreSQL接続、テーブル初期化
- `templates/index.html`: 画面テンプレート
- `static/script.js`: 画面ロジックとAPI呼び出し
- `static/style.css`: スタイル
- `inspect_db.py`: PostgreSQLの直近データ確認用スクリプト
- `deploy/lightsail/`: AWS Lightsail向け設定例

## 必要な環境変数

`DATABASE_URL` は必須です。

```bash
export DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require'
export PORT=5000
```

## ローカル起動

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
gunicorn app:app --bind 0.0.0.0:${PORT:-5000}
```

開発時にFlask組み込みサーバーで起動する場合:

```bash
python app.py
```

## Lightsailデプロイ方針

Lightsailでは、Gunicornを`systemd`で常駐化し、Nginxから`127.0.0.1:8000`へリバースプロキシする構成を想定しています。

設定例:

- `deploy/lightsail/schedule-app.service.example`
- `deploy/lightsail/nginx-schedule-app.conf.example`

本番サーバーでは、`DATABASE_URL`をサービス環境変数として設定してください。

## DB確認

```bash
python inspect_db.py
```

`inspect_db.py`も`DATABASE_URL`を使います。
