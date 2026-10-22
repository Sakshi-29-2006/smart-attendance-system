
import os
import re
import uuid
import tempfile
import traceback

from flask import Blueprint, request, jsonify, g

from auth_utils import require_auth, require_teacher
from supabase_client import supabase


from services.face_service import (
    DATABASE_LOCK,
    generate_embedding,
    load_database,
    save_database,
)


student_bp = Blueprint("student", __name__)

REQUIRED_POSES = [
    ("front", "front_photo"),
    ("slight_left", "slight_left_photo"),
    ("slight_right", "slight_right_photo"),
    ("complete_left", "complete_left_photo"),
    ("complete_right", "complete_right_photo"),
    ("slight_up", "slight_up_photo"),
    ("slight_down", "slight_down_photo"),
]

OPTIONAL_POSES = [
    ("without_specs", "without_specs_photo"),
]

LEGACY_POSES = [
    ("front", "front_photo"),
    ("left", "left_photo"),
    ("right", "right_photo"),
]




def uploaded_file(field):
    """Return a non-empty uploaded file."""
    photo = request.files.get(field)
    return photo if photo and photo.filename else None


def validate_prn(prn):
    """Validate a 12-digit student PRN."""
    return isinstance(prn, str) and bool(
        re.fullmatch(r"[0-9]{12}", prn)
    )


def get_authenticated_student():
    """Retrieve the canonical student profile from Supabase."""
    prn = g.student_prn

    result = (
        supabase.table("students")
        .select("prn, full_name, branch, academic_year")
        .eq("prn", prn)
        .limit(1)
        .execute()
    )

    if not result.data:
        return None

    return result.data[0]


def get_photos_from_request():
    """Validate uploaded photos and support the legacy three-photo flow."""
    uses_new_flow = any(
        uploaded_file(field)
        for _, field in REQUIRED_POSES
        if field != "front_photo"
    )

    pose_fields = REQUIRED_POSES if uses_new_flow else LEGACY_POSES

    missing = [
        field
        for _, field in pose_fields
        if not uploaded_file(field)
    ]

    if missing:
        return None, {
            "error": "Missing required photos: " + ", ".join(missing)
        }

    photos = [
        (angle, field, uploaded_file(field))
        for angle, field in pose_fields
    ]

    for angle, field in OPTIONAL_POSES:
        photo = uploaded_file(field)
        if photo:
            photos.append((angle, field, photo))

    return photos, None


def create_embedding_records(prn, photos):
    """
    Generate face embeddings using temporary image files.

    Uploaded images are not permanently stored by this function.
    Temporary files are deleted after processing.
    """
    new_records = []

    with tempfile.TemporaryDirectory(
        prefix="face_registration_"
    ) as temp_dir:
        for angle, field, photo in photos:
            filename = f"{angle}_{uuid.uuid4().hex}.jpg"
            image_path = os.path.join(temp_dir, filename)

            try:
                photo.save(image_path)
                embedding = generate_embedding(image_path)

                if embedding is None:
                    raise ValueError(
                        f"Could not generate a face embedding for {field}."
                    )

                new_records.append({
                    "filename": filename,
                    "angle": angle,
                    "embedding": embedding,
                })

            finally:
                if os.path.isfile(image_path):
                    os.remove(image_path)

    return new_records


def validate_database():
    """Load and validate the encrypted face-embedding database."""
    database = load_database()

    if not isinstance(database, dict):
        raise ValueError("The existing embedding database is invalid.")

    return database


@student_bp.route("/register", methods=["POST"])
@require_auth
def register_student():
    """Register face embeddings for the authenticated student only."""
    prn = g.student_prn

    if not validate_prn(prn):
        return jsonify({"error": "Invalid authenticated PRN."}), 401

    try:
        student = get_authenticated_student()

        if student is None:
            return jsonify({
                "error": "Student account not found. Please sign up first."
            }), 404

        student_name = student["full_name"]
        branch = student["branch"]

        photos, error = get_photos_from_request()

        if error:
            return jsonify(error), 400

        with DATABASE_LOCK:
            database = validate_database()

            # The embedding database is the source of truth for
            # whether face registration already exists.
            if prn in database:
                return jsonify({
                    "error": (
                        "Face registration already exists for this account. "
                        "Use Update Face Registration instead."
                    )
                }), 409

            new_records = create_embedding_records(prn, photos)

            if not new_records:
                return jsonify({
                    "error": "No face embeddings were generated."
                }), 400

            database[prn] = new_records
            save_database(database)

        return jsonify({
            "message": "Student registered successfully.",
            "prn": prn,
            "student_name": student_name,
            "branch": branch,
            "images_registered": len(new_records),
            "total_embeddings": len(new_records),
        }), 201

    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    except Exception:
        traceback.print_exc()

        return jsonify({
            "error": "Registration failed because of a server error."
        }), 500


@student_bp.route("/register/update", methods=["POST"])
@require_auth
def update_student_faces():
    """Append face embeddings for the authenticated student only."""
    prn = g.student_prn

    if not validate_prn(prn):
        return jsonify({"error": "Invalid authenticated PRN."}), 401

    try:
        student = get_authenticated_student()

        if student is None:
            return jsonify({
                "error": "Student account not found. Please sign up first."
            }), 404

        photos, error = get_photos_from_request()

        if error:
            return jsonify(error), 400

        with DATABASE_LOCK:
            database = validate_database()

            if prn not in database:
                return jsonify({
                    "error": (
                        "Face registration does not exist. "
                        "Register your face first."
                    )
                }), 404

            existing_records = database[prn]

            if not isinstance(existing_records, list):
                return jsonify({
                    "error": "Existing face records have an invalid format."
                }), 500

            new_records = create_embedding_records(prn, photos)

            if not new_records:
                return jsonify({
                    "error": "No face embeddings were generated."
                }), 400

            database[prn] = existing_records + new_records
            save_database(database)

        return jsonify({
            "message": "Face registration updated successfully.",
            "prn": prn,
            "new_images_added": len(new_records),
            "total_embeddings": len(database[prn]),
        }), 200

    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    except Exception:
        traceback.print_exc()

        return jsonify({
            "error": (
                "Face registration update failed because of a server error."
            )
        }), 500


@student_bp.route("/", methods=["GET"])
@require_teacher
def get_students():
    """Return registered students using profiles stored in Supabase."""
    try:
        database = validate_database()

        registered_prns = list(database.keys())

        if not registered_prns:
            return jsonify({"students": []}), 200

        # Fetch student details from Supabase rather than a local JSON file.
        result = (
            supabase.table("students")
            .select("prn, full_name, branch")
            .in_("prn", registered_prns)
            .execute()
        )

        profiles = {
            student["prn"]: student
            for student in (result.data or [])
        }

        students = []

        for prn in registered_prns:
            profile = profiles.get(prn, {})

            students.append({
                "id": prn,
                "prn": prn,
                "name": profile.get("full_name") or "N/A",
                "branch": profile.get("branch") or "N/A",
            })

        return jsonify({"students": students}), 200

    except Exception:
        traceback.print_exc()

        return jsonify({
            "error": "Unable to load registered students."
        }), 500
