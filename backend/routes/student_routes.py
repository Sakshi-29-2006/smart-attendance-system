
import os
import re
import json
import uuid
import tempfile
import threading
import traceback

from flask import Blueprint, request, jsonify, g

from auth_utils import require_auth, require_teacher
from config import REGISTERED_DATASET
from supabase_client import supabase

from services.face_service import (
    generate_embedding,
    load_database,
    save_database,
)

student_bp = Blueprint("student", __name__)

STUDENT_DETAILS_FILE = os.path.join(
    os.path.dirname(os.path.abspath(REGISTERED_DATASET)),
    "student_details.json",
)

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

DATABASE_LOCK = threading.Lock()


def uploaded_file(field):
    """Return a non-empty uploaded file."""
    photo = request.files.get(field)
    return photo if photo and photo.filename else None


def load_student_details():
    """Load face-registration details from JSON."""
    if not os.path.exists(STUDENT_DETAILS_FILE):
        return {}

    try:
        with open(STUDENT_DETAILS_FILE, "r", encoding="utf-8") as file:
            details = json.load(file)

        return details if isinstance(details, dict) else {}

    except (json.JSONDecodeError, OSError):
        return {}


def save_student_details(details):
    """Atomically save student face-registration details."""
    directory = os.path.dirname(STUDENT_DETAILS_FILE)

    if directory:
        os.makedirs(directory, exist_ok=True)

    temp_path = STUDENT_DETAILS_FILE + ".tmp"

    try:
        with open(temp_path, "w", encoding="utf-8") as file:
            json.dump(details, file, indent=4, ensure_ascii=False)

        os.replace(temp_path, STUDENT_DETAILS_FILE)

    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


def validate_prn(prn):
    return isinstance(prn, str) and bool(
        re.fullmatch(r"[0-9]{12}", prn)
    )


def get_authenticated_student():
    """Retrieve the canonical student profile for the verified token PRN."""
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
    Generate embeddings from temporary image files.

    Uploaded registration photos are not retained in REGISTERED_DATASET.
    Temporary files are removed after processing, including on errors.
    """
    new_records = []

    # Use the operating system's temporary directory, not the permanent
    # registered-photo dataset.
    with tempfile.TemporaryDirectory(prefix="face_registration_") as temp_dir:
        for angle, field, photo in photos:
            # Preserve a useful filename in the embedding record.
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
                # Remove the temporary image as soon as this photo has
                # been processed. TemporaryDirectory also cleans up the
                # directory if processing fails.
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
            student_details = load_student_details()

            if prn in database or prn in student_details:
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

            # Save encrypted embeddings before updating student details.
            save_database(database)

            student_details[prn] = {
                "name": student_name,
                "branch": branch,
            }

            try:
                save_student_details(student_details)
            except Exception:
                # Roll back the newly added student in the embedding
                # database if saving the details fails.
                database.pop(prn, None)
                save_database(database)
                raise

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
            student_details = load_student_details()

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

            if prn not in student_details:
                return jsonify({
                    "error": (
                        "Student face details are missing. "
                        "The record needs to be repaired first."
                    )
                }), 409

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
            "error": "Face registration update failed because of a server error."
        }), 500


@student_bp.route("/", methods=["GET"])
@require_teacher
def get_students():
    """Return registered students to an authenticated teacher."""
    try:
        database = validate_database()
    except (FileNotFoundError, ValueError):
        return jsonify({
            "error": "Unable to load registered students."
        }), 500

    student_details = load_student_details()
    students = []

    for prn in database:
        details = student_details.get(prn, {})

        if not isinstance(details, dict):
            details = {}

        students.append({
            "id": prn,
            "prn": prn,
            "name": details.get("name") or "N/A",
            "branch": details.get("branch") or "N/A",
        })

    return jsonify({"students": students}), 200
