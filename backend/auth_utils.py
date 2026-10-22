
import os
from functools import wraps

import jwt
from flask import request, jsonify, g

JWT_SECRET = os.getenv("JWT_SECRET")
JWT_ALGORITHM = "HS256"


def require_auth(route_function):
    """Verify a student JWT and attach the student's PRN to Flask's g."""
    @wraps(route_function)
    def wrapper(*args, **kwargs):
        if not JWT_SECRET or len(JWT_SECRET) < 32:
            return jsonify({
                "success": False,
                "message": "Authentication is not configured."
            }), 500

        authorization = request.headers.get("Authorization", "")
        parts = authorization.split()

        if len(parts) != 2 or parts[0].lower() != "bearer":
            return jsonify({
                "success": False,
                "message": "Authentication required."
            }), 401

        try:
            payload = jwt.decode(
                parts[1],
                JWT_SECRET,
                algorithms=[JWT_ALGORITHM],
                options={"require": ["sub", "iat", "exp"]}
            )

            # Reject teacher tokens on student-only routes.
            if payload.get("role", "student") != "student":
                raise jwt.InvalidTokenError("Invalid student role")

            prn = payload.get("sub")

            if (
                not isinstance(prn, str)
                or len(prn) != 12
                or not prn.isdigit()
            ):
                raise jwt.InvalidTokenError("Invalid student identity")

            g.student_prn = prn

        except jwt.ExpiredSignatureError:
            return jsonify({
                "success": False,
                "message": "Session expired. Please log in again."
            }), 401

        except jwt.InvalidTokenError:
            return jsonify({
                "success": False,
                "message": "Invalid authentication token."
            }), 401

        return route_function(*args, **kwargs)

    return wrapper


def require_teacher(route_function):
    """Verify a teacher JWT and attach the numeric teacher ID to Flask's g."""
    @wraps(route_function)
    def wrapper(*args, **kwargs):
        if not JWT_SECRET or len(JWT_SECRET) < 32:
            return jsonify({
                "success": False,
                "message": "Authentication is not configured."
            }), 500

        authorization = request.headers.get("Authorization", "")
        parts = authorization.split()

        if len(parts) != 2 or parts[0].lower() != "bearer":
            return jsonify({
                "success": False,
                "message": "Teacher authentication required."
            }), 401

        try:
            payload = jwt.decode(
                parts[1],
                JWT_SECRET,
                algorithms=[JWT_ALGORITHM],
                options={"require": ["sub", "iat", "exp", "role"]}
            )

            if payload.get("role") != "teacher":
                return jsonify({
                    "success": False,
                    "message": "Teacher access required."
                }), 403

            teacher_id = payload.get("sub")

            if (
                not isinstance(teacher_id, str)
                or not teacher_id.isdigit()
            ):
                raise jwt.InvalidTokenError("Invalid teacher identity")

            g.teacher_id = int(teacher_id)

        except jwt.ExpiredSignatureError:
            return jsonify({
                "success": False,
                "message": "Session expired. Please log in again."
            }), 401

        except jwt.InvalidTokenError:
            return jsonify({
                "success": False,
                "message": "Invalid authentication token."
            }), 401

        return route_function(*args, **kwargs)

    return wrapper
