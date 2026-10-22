
import os
import re
from datetime import datetime, timedelta, timezone

import jwt
from flask import Blueprint, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash

from supabase_client import supabase

auth_bp = Blueprint("auth", __name__)

JWT_SECRET = os.getenv("JWT_SECRET")
JWT_ALGORITHM = "HS256"
TOKEN_LIFETIME_HOURS = 1


def create_access_token(subject, role="student"):
    """Create a short-lived token with an explicit user role."""
    now = datetime.now(timezone.utc)

    payload = {
        "sub": subject,
        "role": role,
        "iat": now,
        "exp": now + timedelta(hours=TOKEN_LIFETIME_HOURS),
    }

    return jwt.encode(
        payload,
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )


def authentication_configured():
    return bool(JWT_SECRET and len(JWT_SECRET) >= 32)


@auth_bp.route("/signup", methods=["POST"])
def signup():
    """Create a student account."""
    data = request.get_json(silent=True) or {}

    prn = str(data.get("prn", "")).strip()
    full_name = str(data.get("full_name", "")).strip()
    branch = str(data.get("branch", "")).strip()
    academic_year = str(data.get("academic_year", "")).strip()
    password = data.get("password", "")

    if not authentication_configured():
        return jsonify({
            "success": False,
            "message": "Authentication is not configured.",
        }), 500

    if not (
        re.fullmatch(r"[0-9]{12}", prn)
        and full_name
        and len(full_name) <= 150
        and branch
        and len(branch) <= 100
        and academic_year
        and len(academic_year) <= 30
        and isinstance(password, str)
        and 12 <= len(password) <= 128
    ):
        return jsonify({
            "success": False,
            "message": (
                "Check your details. PRN must contain 12 digits "
                "and password must be 12–128 characters."
            ),
        }), 400

    try:
        password_hash = generate_password_hash(password)

        result = supabase.table("students").insert({
            "prn": prn,
            "full_name": full_name,
            "branch": branch,
            "academic_year": academic_year,
            "password_hash": password_hash,
        }).execute()

        if not result.data:
            return jsonify({
                "success": False,
                "message": "Account could not be created.",
            }), 500

        return jsonify({
            "success": True,
            "message": "Account created. You can now log in.",
        }), 201

    except Exception as exc:
        # Do not expose database errors to clients.
        if (
            "duplicate key" in str(exc).lower()
            or "23505" in str(exc)
        ):
            return jsonify({
                "success": False,
                "message": "An account with this PRN already exists.",
            }), 409

        return jsonify({
            "success": False,
            "message": "Unable to create account. Please try again.",
        }), 500


@auth_bp.route("/login", methods=["POST"])
def login():
    """Authenticate a student."""
    data = request.get_json(silent=True) or {}

    prn = str(data.get("prn", "")).strip()
    password = data.get("password", "")

    if not authentication_configured():
        return jsonify({
            "success": False,
            "message": "Authentication is not configured.",
        }), 500

    if not (
        re.fullmatch(r"[0-9]{12}", prn)
        and isinstance(password, str)
        and 1 <= len(password) <= 128
    ):
        return jsonify({
            "success": False,
            "message": "Invalid PRN or password.",
        }), 401

    try:
        result = (
            supabase.table("students")
            .select(
                "prn, full_name, branch, academic_year, password_hash"
            )
            .eq("prn", prn)
            .limit(1)
            .execute()
        )

        if not result.data or not check_password_hash(
            result.data[0]["password_hash"], password
        ):
            return jsonify({
                "success": False,
                "message": "Invalid PRN or password.",
            }), 401

        student = result.data[0]
        token = create_access_token(
            subject=student["prn"],
            role="student",
        )

        return jsonify({
            "success": True,
            "message": "Login successful.",
            "access_token": token,
            "token_type": "Bearer",
            "expires_in": TOKEN_LIFETIME_HOURS * 3600,
            "student": {
                "prn": student["prn"],
                "full_name": student["full_name"],
                "branch": student["branch"],
                "academic_year": student["academic_year"],
            },
        }), 200

    except Exception:
        return jsonify({
            "success": False,
            "message": "Unable to log in. Please try again.",
        }), 500


@auth_bp.route("/teacher/login", methods=["POST"])
def teacher_login():
    """Authenticate a teacher against the trusted teachers table."""
    data = request.get_json(silent=True) or {}

    username = data.get("username", "")
    password = data.get("password", "")

    if not authentication_configured():
        return jsonify({
            "success": False,
            "message": "Authentication is not configured.",
        }), 500

    if not (
        isinstance(username, str)
        and 1 <= len(username.strip()) <= 100
        and isinstance(password, str)
        and 1 <= len(password) <= 128
    ):
        return jsonify({
            "success": False,
            "message": "Invalid username or password.",
        }), 401

    username = username.strip()

    try:
        result = (
            supabase.table("teachers")
            .select("id, username, password_hash")
            .eq("username", username)
            .limit(1)
            .execute()
        )

        if not result.data:
            return jsonify({
                "success": False,
                "message": "Invalid username or password.",
            }), 401

        teacher = result.data[0]

        if not check_password_hash(
            teacher["password_hash"], password
        ):
            return jsonify({
                "success": False,
                "message": "Invalid username or password.",
            }), 401

        token = create_access_token(
            subject=str(teacher["id"]),
            role="teacher",
        )

        return jsonify({
            "success": True,
            "message": "Teacher login successful.",
            "access_token": token,
            "token_type": "Bearer",
            "expires_in": TOKEN_LIFETIME_HOURS * 3600,
            "teacher": {
                "id": teacher["id"],
                "username": teacher["username"],
            },
        }), 200

    except Exception:
        return jsonify({
            "success": False,
            "message": "Unable to log in. Please try again.",
        }), 500
