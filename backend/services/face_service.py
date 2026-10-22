
import os
import cv2
import numpy as np

from insightface.app import FaceAnalysis

from config import REGISTERED_EMBEDDING_FILE
from services.secure_biometric_store import (
    load_encrypted_database,
    save_encrypted_database,
)


app = FaceAnalysis(
    name="buffalo_l",
    providers=["CPUExecutionProvider"]
)

app.prepare(
    ctx_id=0,
    det_size=(640, 640)
)


def normalize_embedding(embedding):
    norm = np.linalg.norm(embedding)

    if norm == 0:
        return embedding

    return embedding / norm


def load_database():
    database = load_encrypted_database(
        REGISTERED_EMBEDDING_FILE
    )

    if database is None:
        return {}

    return database


def save_database(database):
    os.makedirs(
        os.path.dirname(
            os.path.abspath(REGISTERED_EMBEDDING_FILE)
        ),
        exist_ok=True
    )

    print(
        "Saving encrypted embeddings to:",
        os.path.abspath(REGISTERED_EMBEDDING_FILE)
    )

    print(
        "Students in database:",
        list(database.keys())
    )

    save_encrypted_database(
        database,
        REGISTERED_EMBEDDING_FILE
    )

    print("Encrypted embeddings database saved successfully.")


def generate_embedding(image_path):
    image = cv2.imread(image_path)

    if image is None:
        raise ValueError(
            "Could not read image"
        )

    faces = app.get(image)

    if len(faces) == 0:
        raise ValueError(
            "No face detected"
        )

    if len(faces) > 1:
        raise ValueError(
            "Multiple faces detected"
        )

    embedding = faces[0].embedding

    embedding = normalize_embedding(
        embedding
    )

    return embedding
