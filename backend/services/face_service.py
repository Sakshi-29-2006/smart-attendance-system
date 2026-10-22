
import os
import threading

import cv2
import numpy as np
from insightface.app import FaceAnalysis

from config import REGISTERED_EMBEDDING_FILE
from services.secure_biometric_store import (
    load_encrypted_database,
    save_encrypted_database,
)
from services.supabase_storage import download_file, upload_file


REMOTE_DATABASE_PATH = "registered_embeddings.enc"

# Shared lock for database operations within this Python process.
DATABASE_LOCK = threading.RLock()


app = FaceAnalysis(
    name="buffalo_l",
    providers=["CPUExecutionProvider"],
)
app.prepare(ctx_id=0, det_size=(320, 320))


def normalize_embedding(embedding):
    norm = np.linalg.norm(embedding)

    if norm == 0:
        return embedding

    return embedding / norm


def _write_encrypted_file_atomically(content):
    local_path = os.path.abspath(REGISTERED_EMBEDDING_FILE)
    directory = os.path.dirname(local_path)
    os.makedirs(directory, exist_ok=True)

    temp_path = local_path + ".download"

    try:
        with open(temp_path, "wb") as file:
            file.write(content)
            file.flush()
            os.fsync(file.fileno())

        os.replace(temp_path, local_path)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


def _sync_from_remote():
    """
    Download the encrypted remote database if it exists.
    Never initialize remote storage from the local file automatically.
    """
    remote_data = download_file(REMOTE_DATABASE_PATH)

    if remote_data is None:
        return False

    _write_encrypted_file_atomically(remote_data)
    return True


def load_database():
    with DATABASE_LOCK:
        _sync_from_remote()

        database = load_encrypted_database(
            REGISTERED_EMBEDDING_FILE
        )

        if database is None:
            return {}

        if not isinstance(database, dict):
            raise ValueError(
                "The existing embedding database is invalid."
            )

        return database


def save_database(database):
    with DATABASE_LOCK:
        if not isinstance(database, dict):
            raise ValueError(
                "Cannot save an invalid embedding database."
            )

        # Do not overwrite or initialize the remote database implicitly.
        remote_data = download_file(REMOTE_DATABASE_PATH)

        if remote_data is None:
            raise RuntimeError(
                "The remote biometric database is not initialized. "
                "Complete the reviewed migration before saving embeddings."
            )

        # Start from the current remote encrypted copy.
        _write_encrypted_file_atomically(remote_data)

        # Encrypt before saving locally.
        save_encrypted_database(
            database,
            REGISTERED_EMBEDDING_FILE,
        )

        with open(REGISTERED_EMBEDDING_FILE, "rb") as file:
            encrypted_data = file.read()

        upload_file(
            REMOTE_DATABASE_PATH,
            encrypted_data,
            "application/octet-stream",
            overwrite=True,
        )

def generate_embedding(image_path):
    image = cv2.imread(image_path)

    if image is None:
        raise ValueError("Could not read image")

    faces = app.get(image)

    if len(faces) == 0:
        raise ValueError("No face detected")

    if len(faces) > 1:
        raise ValueError("Multiple faces detected")

    return normalize_embedding(faces[0].embedding)
