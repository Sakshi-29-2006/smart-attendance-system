
import os
import re
import uuid
import base64
import tempfile
import logging
import math

import cv2
from flask import Blueprint, request, jsonify, g
from werkzeug.utils import secure_filename

from services.group_recognition import recognize_group, recognize_image
from auth_utils import require_teacher
from supabase_client import supabase


group_routes = Blueprint("group_routes", __name__)

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}

MAX_VIDEO_FRAMES = 300
FRAME_INTERVAL_SECONDS = 1.25

PREVIEW_MAX_WIDTH = 960
PREVIEW_JPEG_QUALITY = 80

# Used only if OpenCV returns invalid or implausible FPS metadata.
FALLBACK_FPS = 30.0

logger = logging.getLogger(__name__)

# PRNs in this project contain exactly 12 digits.
PRN_PATTERN = re.compile(r"^[0-9]{12}$")


def save_upload(upload, allowed_extensions):
    """Save an uploaded file to a temporary path."""
    filename = secure_filename(upload.filename or "")
    extension = os.path.splitext(filename)[1].lower()

    if not filename or extension not in allowed_extensions:
        raise ValueError("Unsupported file type.")

    temp_file = tempfile.NamedTemporaryFile(
        suffix=extension,
        delete=False
    )
    path = temp_file.name
    temp_file.close()

    try:
        upload.save(path)
    except Exception:
        if os.path.exists(path):
            os.remove(path)
        raise

    return path


def encode_frame_preview(frame):
    """Encode a resized frame as a JPEG data URL."""
    if frame is None or frame.size == 0:
        return None

    height, width = frame.shape[:2]

    if width > PREVIEW_MAX_WIDTH:
        new_height = max(
            1,
            round(height * PREVIEW_MAX_WIDTH / width)
        )
        frame = cv2.resize(
            frame,
            (PREVIEW_MAX_WIDTH, new_height),
            interpolation=cv2.INTER_AREA
        )

    success, encoded_frame = cv2.imencode(
        ".jpg",
        frame,
        [int(cv2.IMWRITE_JPEG_QUALITY), PREVIEW_JPEG_QUALITY]
    )

    if not success:
        logger.warning("Could not encode preview frame.")
        return None

    frame_base64 = base64.b64encode(
        encoded_frame.tobytes()
    ).decode("utf-8")

    return f"data:image/jpeg;base64,{frame_base64}"


def validate_active_session(session_id):
    """
    Verify that the attendance session exists, belongs to the
    authenticated teacher, and has not been finalized.

    Returns the session ID as a UUID string.
    """
    if not session_id:
        raise ValueError(
            "Missing attendance session ID. Create an attendance "
            "session before running recognition."
        )

    try:
        normalized_session_id = str(uuid.UUID(str(session_id)))
    except (ValueError, TypeError, AttributeError):
        raise ValueError("Invalid attendance session ID.")

    response = (
        supabase.table("attendance_sessions")
        .select("id, created_by, finalized")
        .eq("id", normalized_session_id)
        .eq("created_by", g.teacher_id)
        .limit(1)
        .execute()
    )

    sessions = response.data or []

    if not sessions:
        # Do not reveal whether another teacher owns the session.
        raise PermissionError(
            "Attendance session was not found or does not belong "
            "to your account."
        )

    session = sessions[0]

    if session.get("finalized"):
        raise ValueError(
            "This attendance session is finalized and cannot be changed."
        )

    return normalized_session_id


def save_recognized_attendance(session_id, recognized_ids):
    """
    Save recognized, registered students as Present.

    This intentionally does not mark any student Absent. Students
    not recognized by a photo/video must be reviewed by the teacher.
    """
    valid_prns = set()

    for student_id in recognized_ids:
        if student_id is None:
            continue

        prn = str(student_id).strip()

        if PRN_PATTERN.fullmatch(prn):
            valid_prns.add(prn)

    if not valid_prns:
        return 0

    # Only save PRNs that actually exist in the Supabase students table.
    student_response = (
        supabase.table("students")
        .select("prn")
        .in_("prn", list(valid_prns))
        .execute()
    )

    registered_prns = {
        str(student.get("prn", "")).strip()
        for student in (student_response.data or [])
    }

    if not registered_prns:
        logger.info(
            "No recognized PRNs were found in the registered students table."
        )
        return 0

    records = [
        {
            "session_id": session_id,
            "student_prn": prn,
            "status": "present",
        }
        for prn in sorted(registered_prns)
    ]

    # The database has UNIQUE(session_id, student_prn).
    # Re-running recognition updates the existing record rather
    # than creating duplicate attendance records.
    supabase.table("attendance_records").upsert(
        records,
        on_conflict="session_id,student_prn"
    ).execute()

    logger.info(
        "Saved %s recognized Present record(s) for session %s.",
        len(records),
        session_id
    )

    return len(records)


def error_response(error, status_code):
    """Return a consistent JSON error response."""
    return jsonify({
        "success": False,
        "error": str(error)
    }), status_code


@group_routes.route("/recognize-group", methods=["POST"])
@require_teacher
def recognize_group_route():
    # Validate the teacher's session before running face recognition.
    try:
        session_id = validate_active_session(
            request.form.get("session_id", "").strip()
        )
    except ValueError as error:
        return error_response(error, 400)
    except PermissionError as error:
        return error_response(error, 403)
    except Exception:
        logger.exception("Could not validate image attendance session")
        return error_response(
            "Could not validate the attendance session. Check backend logs.",
            500
        )

    if "image" not in request.files:
        return error_response("No image provided.", 400)

    image = request.files["image"]

    if not image.filename:
        return error_response("No image selected.", 400)

    image_path = None

    try:
        image_path = save_upload(image, IMAGE_EXTENSIONS)

        results = recognize_group(image_path)

        if not isinstance(results, list):
            raise RuntimeError(
                "Image recognition returned an unexpected result."
            )

        recognized_ids = [
            face.get("student_id")
            for face in results
            if isinstance(face, dict)
        ]

        saved_count = save_recognized_attendance(
            session_id,
            recognized_ids
        )

        return jsonify({
            "success": True,
            "faces": results,
            "session_id": session_id,
            "attendance_saved": saved_count,
            "message": (
                f"Image processed. {saved_count} recognized "
                "student(s) saved as Present."
            )
        })

    except ValueError as error:
        return error_response(error, 400)

    except Exception:
        logger.exception("Image recognition or attendance saving failed")
        return error_response(
            "Image recognition or attendance saving failed. "
            "Check backend logs.",
            500
        )

    finally:
        if image_path and os.path.exists(image_path):
            try:
                os.remove(image_path)
            except OSError:
                logger.exception("Could not remove temporary image.")


@group_routes.route("/recognize-video", methods=["POST"])
@require_teacher
def recognize_video_route():
    # Validate the teacher's session before processing the video.
    try:
        session_id = validate_active_session(
            request.form.get("session_id", "").strip()
        )
    except ValueError as error:
        return error_response(error, 400)
    except PermissionError as error:
        return error_response(error, 403)
    except Exception:
        logger.exception("Could not validate video attendance session")
        return error_response(
            "Could not validate the attendance session. Check backend logs.",
            500
        )

    if "video" not in request.files:
        return error_response("No video provided.", 400)

    video = request.files["video"]

    if not video.filename:
        return error_response("No video selected.", 400)

    video_path = None
    capture = None

    try:
        video_path = save_upload(video, VIDEO_EXTENSIONS)
        capture = cv2.VideoCapture(video_path)

        if not capture.isOpened():
            return error_response(
                "Could not open the uploaded video.",
                400
            )

        reported_fps = float(
            capture.get(cv2.CAP_PROP_FPS) or 0
        )
        reported_total_frames = float(
            capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0
        )

        # Reject non-finite, non-positive, or implausible metadata.
        if (
            not math.isfinite(reported_fps)
            or reported_fps < 1
            or reported_fps > 120
        ):
            logger.warning(
                "Implausible FPS from OpenCV: %s. "
                "Using fallback FPS %.1f; timestamps may be inaccurate.",
                reported_fps,
                FALLBACK_FPS
            )
            fps = FALLBACK_FPS
        else:
            fps = reported_fps

        total_frames = (
            int(reported_total_frames)
            if math.isfinite(reported_total_frames)
            and reported_total_frames > 0
            else 0
        )

        duration = total_frames / fps if total_frames > 0 else 0.0

        frame_step = max(
            1,
            int(round(fps * FRAME_INTERVAL_SECONDS))
        )

        logger.info(
            "Starting video recognition: reported_fps=%s, "
            "sampling_fps=%.2f, reported_total_frames=%s, "
            "duration=%.2fs, interval=%.2fs, frame_step=%s",
            reported_fps,
            fps,
            total_frames,
            duration,
            FRAME_INTERVAL_SECONDS,
            frame_step
        )

        frames_processed = 0
        frame_index = 0
        frame_results = []
        recognized_students = {}

        while frames_processed < MAX_VIDEO_FRAMES:
            success, frame = capture.read()

            if not success or frame is None or frame.size == 0:
                logger.info(
                    "Video reading stopped at frame index %s; "
                    "%s preview frames processed.",
                    frame_index,
                    frames_processed
                )
                break

            if frame_index % frame_step == 0:
                timestamp = round(frame_index / fps, 3)

                original_height, original_width = frame.shape[:2]

                # Do not silently return partial success if recognition
                # fails for a sampled frame.
                faces = recognize_image(frame)

                if not isinstance(faces, list):
                    raise RuntimeError(
                        "Video frame recognition returned an unexpected result."
                    )

                frame_image = encode_frame_preview(frame)

                frame_results.append({
                    "timestamp_seconds": timestamp,
                    "frame_image": frame_image,
                    "original_width": original_width,
                    "original_height": original_height,
                    "faces": faces
                })

                for face in faces:
                    if not isinstance(face, dict):
                        continue

                    student_id = face.get("student_id")

                    if student_id is None:
                        continue

                    student_id_text = str(student_id).strip()

                    if (
                        not student_id_text
                        or student_id_text.upper()
                        in {"UNKNOWN", "NONE", "NULL"}
                    ):
                        continue

                    key = student_id_text

                    try:
                        similarity = float(
                            face.get("similarity") or 0
                        )
                    except (TypeError, ValueError):
                        similarity = 0.0

                    if key not in recognized_students:
                        recognized_students[key] = {
                            "student_id": student_id,
                            "similarity": similarity,
                            "timestamps": [timestamp]
                        }
                    else:
                        record = recognized_students[key]
                        record["timestamps"].append(timestamp)
                        record["similarity"] = max(
                            similarity,
                            record["similarity"]
                        )

                frames_processed += 1

                logger.info(
                    "Processed preview %s/%s at %.3fs; faces=%s",
                    frames_processed,
                    MAX_VIDEO_FRAMES,
                    timestamp,
                    len(faces)
                )

            frame_index += 1

        # Estimate duration if video metadata was unavailable.
        if total_frames > 0:
            duration = total_frames / fps
        elif frame_index > 0:
            duration = frame_index / fps

        for record in recognized_students.values():
            record["timestamps"] = sorted(
                set(record["timestamps"])
            )

        # Save recognized registered students after the video has
        # finished processing successfully.
        saved_count = save_recognized_attendance(
            session_id,
            [
                record["student_id"]
                for record in recognized_students.values()
            ]
        )

        logger.info(
            "Video recognition finished: frames_processed=%s, "
            "frames_returned=%s, recognized_students=%s, "
            "attendance_saved=%s",
            frames_processed,
            len(frame_results),
            len(recognized_students),
            saved_count
        )

        return jsonify({
            "success": True,
            "session_id": session_id,
            "duration_seconds": round(duration, 2),
            "frames_processed": frames_processed,
            "frame_interval_seconds": FRAME_INTERVAL_SECONDS,
            "frames": frame_results,
            "recognized_students": list(
                recognized_students.values()
            ),
            "attendance_saved": saved_count,
            "message": (
                f"Video processed. {saved_count} recognized "
                "student(s) saved as Present."
            )
        })

    except ValueError as error:
        return error_response(error, 400)

    except Exception:
        logger.exception("Video recognition or attendance saving failed")
        return error_response(
            "Video recognition or attendance saving failed. "
            "Check backend logs.",
            500
        )

    finally:
        if capture is not None:
            capture.release()

        if video_path and os.path.exists(video_path):
            try:
                os.remove(video_path)
            except OSError:
                logger.exception("Could not remove temporary video.")
