import csv
import os
import sys
from datetime import datetime, timezone
from flask import Flask, send_from_directory, request, jsonify, make_response
import resend

app = Flask(__name__, static_folder='.')

SUBSCRIBERS_FILE = os.path.join(os.path.dirname(__file__), 'subscribers.csv')
NOTIFY_TO        = os.environ.get('NOTIFY_EMAIL', 'philip@worklytics.co')
RESEND_API_KEY   = os.environ.get('RESEND_API_KEY', '')

def send_notification(name: str, email: str, role: str, ts: str):
    """Send an email notification via Resend (no-op if API key not set)."""
    if not RESEND_API_KEY:
        return
    try:
        resend.api_key = RESEND_API_KEY
        resend.Emails.send({
            'from':    'Meeting Score Tool <onboarding@resend.dev>',
            'to':      [NOTIFY_TO],
            'subject': f'New opt-in: {name} ({email})',
            'html':    f'''
                <p>A new visitor opted in to Worklytics marketing emails via the Meeting Efficiency Score tool.</p>
                <table>
                  <tr><td><b>Name</b></td><td>{name}</td></tr>
                  <tr><td><b>Email</b></td><td>{email}</td></tr>
                  <tr><td><b>Role</b></td><td>{role}</td></tr>
                  <tr><td><b>Time</b></td><td>{ts}</td></tr>
                </table>
            ''',
        })
    except Exception as e:
        print(f"[SUBSCRIBER] Email notification failed: {e}", file=sys.stderr, flush=True)

def append_subscriber(name: str, email: str, role: str):
    """Log subscriber, write to CSV, and send email notification."""
    ts = datetime.now(timezone.utc).isoformat()

    print(f"[SUBSCRIBER] {ts} | {email} | {name} | {role}", flush=True)

    file_exists = os.path.isfile(SUBSCRIBERS_FILE)
    try:
        with open(SUBSCRIBERS_FILE, 'a', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            if not file_exists:
                writer.writerow(['timestamp', 'email', 'name', 'role'])
            writer.writerow([ts, email, name, role])
    except Exception as e:
        print(f"[SUBSCRIBER] CSV write failed: {e}", file=sys.stderr, flush=True)

    send_notification(name, email, role, ts)


@app.route('/api/subscribe', methods=['POST', 'OPTIONS'])
def subscribe():
    if request.method == 'OPTIONS':
        resp = make_response('', 204)
        resp.headers['Access-Control-Allow-Origin']  = '*'
        resp.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
        resp.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        return resp
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    name  = (data.get('name')  or '').strip()
    role  = (data.get('role')  or '').strip()

    if not email or '@' not in email:
        resp = make_response(jsonify({'error': 'invalid email'}), 400)
        resp.headers['Access-Control-Allow-Origin'] = '*'
        return resp

    append_subscriber(name, email, role)
    resp = make_response(jsonify({'ok': True}), 200)
    resp.headers['Access-Control-Allow-Origin'] = '*'
    return resp


@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/styles.css')
def styles():
    resp = make_response(send_from_directory('.', 'styles.css', mimetype='text/css'))
    resp.headers['Access-Control-Allow-Origin'] = '*'
    return resp

@app.route('/app.js')
def appjs():
    resp = make_response(send_from_directory('.', 'app.js', mimetype='application/javascript'))
    resp.headers['Access-Control-Allow-Origin'] = '*'
    return resp

@app.route('/loader.js')
def loaderjs():
    resp = make_response(send_from_directory('.', 'loader.js', mimetype='application/javascript'))
    resp.headers['Access-Control-Allow-Origin'] = '*'
    return resp

@app.route('/animal-icons/<path:filename>')
def animal_icons(filename):
    return send_from_directory('animal-icons', filename)

@app.route('/logos/<path:filename>')
def logos(filename):
    return send_from_directory('logos', filename)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port)
