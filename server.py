import csv
import os
import sys
from datetime import datetime, timezone
from flask import Flask, send_from_directory, request, jsonify

app = Flask(__name__, static_folder='.')

SUBSCRIBERS_FILE = os.path.join(os.path.dirname(__file__), 'subscribers.csv')

def append_subscriber(name: str, email: str, role: str):
    """Append a subscriber to the CSV and log to stdout (Railway captures logs)."""
    ts = datetime.now(timezone.utc).isoformat()
    row = [ts, email, name, role]

    # Always log to stdout — Railway retains these even across redeploys
    print(f"[SUBSCRIBER] {ts} | {email} | {name} | {role}", flush=True)

    # Also write to CSV (note: ephemeral on Railway unless a volume is mounted)
    file_exists = os.path.isfile(SUBSCRIBERS_FILE)
    try:
        with open(SUBSCRIBERS_FILE, 'a', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            if not file_exists:
                writer.writerow(['timestamp', 'email', 'name', 'role'])
            writer.writerow(row)
    except Exception as e:
        print(f"[SUBSCRIBER] CSV write failed: {e}", file=sys.stderr, flush=True)


@app.route('/api/subscribe', methods=['POST'])
def subscribe():
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    name  = (data.get('name')  or '').strip()
    role  = (data.get('role')  or '').strip()

    if not email or '@' not in email:
        return jsonify({'error': 'invalid email'}), 400

    append_subscriber(name, email, role)
    return jsonify({'ok': True}), 200


@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/animal-icons/<path:filename>')
def animal_icons(filename):
    return send_from_directory('animal-icons', filename)

@app.route('/logos/<path:filename>')
def logos(filename):
    return send_from_directory('logos', filename)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port)
