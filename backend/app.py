import os
from flask import Flask
from flask_cors import CORS
from dotenv import load_dotenv

# Load environment variables before importing route modules.
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

from routes.student_routes import student_bp
from routes.group_routes import group_routes
from routes.auth_routes import auth_bp
from routes.attendance_routes import attendance_bp
app = Flask(__name__)

# Maximum upload size: 200 MB
app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024

# Development configuration.
# Restrict CORS to your React development server.
CORS(
    app,
    resources={
        r"/api/*": {
            "origins": [
                "http://localhost:5173",
                "https://smart-attendance-system-3of.pages.dev"
            ]
        }
    }
)

# Existing student registration routes
app.register_blueprint(
    student_bp,
    url_prefix="/api/students"
)

# Existing group recognition routes
app.register_blueprint(
    group_routes,
    url_prefix="/api"
)

# New student authentication routes
app.register_blueprint(
    auth_bp,
    url_prefix="/api/auth"
)

app.register_blueprint(attendance_bp, url_prefix="/api/attendance")

@app.route("/")
def home():
    return {
        "message": "Attendance System Backend Running"
    }


if __name__ == "__main__":
    # Keep debug mode for local development only.
    app.run(
        host="127.0.0.1",
        port=5000,
        debug=True
    )
