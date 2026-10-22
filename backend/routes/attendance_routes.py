
import re
from datetime import date, datetime
from uuid import UUID

from flask import Blueprint, request, jsonify, g

from auth_utils import require_teacher, require_auth
from supabase_client import supabase

attendance_bp = Blueprint("attendance", __name__)

PRN_PATTERN = re.compile(r"^[0-9]{12}$")
VALID_STATUSES = {"present", "absent"}


def error_response(message, status_code):
    return jsonify({
        "success": False,
        "message": message
    }), status_code


def get_owned_session(session_id, teacher_id):
    """Return a session only if it belongs to the authenticated teacher."""
    result = (
        supabase.table("attendance_sessions")
        .select("*")
        .eq("id", session_id)
        .eq("created_by", teacher_id)
        .limit(1)
        .execute()
    )

    return result.data[0] if result.data else None


@attendance_bp.route("/sessions", methods=["POST"])
@require_teacher
def create_session():
    """Create an attendance session for a class."""
    data = request.get_json(silent=True) or {}

    batch_name = str(data.get("batch_name", "")).strip()
    subject_name = str(data.get("subject_name", "")).strip()
    class_date = str(data.get("class_date", "")).strip()
    start_time = str(data.get("start_time", "")).strip()
    end_time = str(data.get("end_time", "")).strip()

    if not all([
        batch_name,
        subject_name,
        class_date,
        start_time,
        end_time
    ]):
        return error_response(
            "Batch, subject, date, start time and end time are required.",
            400
        )

    try:
        date.fromisoformat(class_date)
        start = datetime.strptime(start_time, "%H:%M").time()
        end = datetime.strptime(end_time, "%H:%M").time()

        if end <= start:
            return error_response(
                "End time must be later than start time.",
                400
            )

        result = (
            supabase.table("attendance_sessions")
            .insert({
                "batch_name": batch_name,
                "subject_name": subject_name,
                "class_date": class_date,
                "start_time": start.strftime("%H:%M:%S"),
                "end_time": end.strftime("%H:%M:%S"),
                "created_by": g.teacher_id,
            })
            .execute()
        )

        if not result.data:
            return error_response(
                "Could not create the session.",
                500
            )

        return jsonify({
            "success": True,
            "message": "Attendance session created.",
            "session": result.data[0]
        }), 201

    except ValueError:
        return error_response(
            "Invalid date or time. Use YYYY-MM-DD and HH:MM.",
            400
        )
    except Exception:
        return error_response(
            "Unable to create the attendance session. Check the backend logs.",
            500
        )


@attendance_bp.route("/sessions", methods=["GET"])
@require_teacher
def list_sessions():
    """List sessions created by the authenticated teacher."""
    try:
        result = (
            supabase.table("attendance_sessions")
            .select("*")
            .eq("created_by", g.teacher_id)
            .order("class_date", desc=True)
            .execute()
        )

        return jsonify({
            "success": True,
            "sessions": result.data or []
        }), 200

    except Exception:
        return error_response(
            "Unable to retrieve sessions.",
            500
        )


@attendance_bp.route("/sessions/<session_id>/records", methods=["GET"])
@require_teacher
def get_session_records(session_id):
    """Retrieve records for a session owned by this teacher."""
    try:
        UUID(session_id)

        session = get_owned_session(
            session_id,
            g.teacher_id
        )

        if not session:
            return error_response(
                "Session not found.",
                404
            )

        result = (
            supabase.table("attendance_records")
            .select("student_prn,status,marked_at")
            .eq("session_id", session_id)
            .execute()
        )

        return jsonify({
            "success": True,
            "records": result.data or []
        }), 200

    except ValueError:
        return error_response(
            "Invalid session ID.",
            400
        )
    except Exception:
        return error_response(
            "Unable to retrieve attendance records.",
            500
        )


@attendance_bp.route(
    "/sessions/<session_id>/records",
    methods=["PATCH"]
)
@require_teacher
def update_session_record(session_id):
    """
    Create or update one student's attendance record.

    Expected JSON:
    {
        "student_prn": "123456789012",
        "status": "present"
    }

    Status must be 'present' or 'absent'.
    """
    try:
        # Validate the session ID format.
        try:
            UUID(session_id)
        except (ValueError, TypeError, AttributeError):
            return error_response(
                "Invalid session ID.",
                400
            )

        data = request.get_json(silent=True) or {}

        student_prn = str(
            data.get("student_prn", "")
        ).strip()

        status = str(
            data.get("status", "")
        ).strip().lower()

        if not PRN_PATTERN.fullmatch(student_prn):
            return error_response(
                "A valid 12-digit student PRN is required.",
                400
            )

        if status not in VALID_STATUSES:
            return error_response(
                "Status must be either 'present' or 'absent'.",
                400
            )

        # Ensure this session belongs to the logged-in teacher.
        session = get_owned_session(
            session_id,
            g.teacher_id
        )

        if not session:
            return error_response(
                "Session not found or you do not have permission to edit it.",
                404
            )

        # Prevent changes after a session has been finalized,
        # if the table has and uses this field.
        if session.get("finalized") is True:
            return error_response(
                "This attendance session has been finalized and cannot be edited.",
                409
            )

        # Confirm that the PRN belongs to a registered student.
        student_result = (
            supabase.table("students")
            .select("prn")
            .eq("prn", student_prn)
            .limit(1)
            .execute()
        )

        if not student_result.data:
            return error_response(
                "No registered student was found with this PRN.",
                404
            )

        # Insert a new record or update the existing record for
        # this student and session.
        result = (
            supabase.table("attendance_records")
            .upsert(
                {
                    "session_id": session_id,
                    "student_prn": student_prn,
                    "status": status,
                    "marked_at": datetime.now().astimezone().isoformat(),
                },
                on_conflict="session_id,student_prn"
            )
            .execute()
        )

        if not result.data:
            return error_response(
                "Attendance could not be saved.",
                500
            )

        return jsonify({
            "success": True,
            "message": "Attendance saved successfully.",
            "record": result.data[0]
        }), 200

    except Exception:
        return error_response(
            "Unable to save attendance. Check the backend logs.",
            500
        )


@attendance_bp.route("/my-attendance", methods=["GET"])
@require_auth
def get_my_attendance():
    """Return attendance records for the logged-in student."""
    try:
        records = (
            supabase.table("attendance_records")
            .select(
                "status,marked_at,"
                "attendance_sessions("
                "id,batch_name,subject_name,class_date,start_time,end_time)"
            )
            .eq("student_prn", g.student_prn)
            .execute()
        )

        return jsonify({
            "success": True,
            "attendance": records.data or []
        }), 200

    except Exception:
        return error_response(
            "Unable to retrieve your attendance.",
            500
        )
