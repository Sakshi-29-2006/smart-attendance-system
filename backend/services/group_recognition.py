import os
import cv2
import numpy as np
from insightface.app import FaceAnalysis

from services.secure_biometric_store import load_encrypted_database

# Resolve the database path relative to the backend directory.
BASE_DIR = os.path.dirname(
    os.path.dirname(os.path.abspath(__file__))
)

EMBEDDING_FILE = os.path.join(
    BASE_DIR,
    "models",
    "registered_embeddings.pkl"
)

THRESHOLD = 0.51
DETECTION_SIZE = (960, 960)

# Maximum number of frames to process when recognizing
# a video directly through recognize_video().
DEFAULT_FRAME_INTERVAL = 1.5
DEFAULT_MAX_FRAMES = 300

app = FaceAnalysis(
    name="buffalo_l",
    providers=["CPUExecutionProvider"]
)

app.prepare(
    ctx_id=0,
    det_size=DETECTION_SIZE
)


def normalize_embedding(embedding):
    """Normalize an embedding for cosine similarity."""
    embedding = np.asarray(embedding, dtype=np.float32)

    norm = np.linalg.norm(embedding)

    if norm == 0:
        return embedding

    return embedding / norm


def cosine_similarity(a, b):
    """Calculate cosine similarity between embeddings."""
    a = normalize_embedding(a)
    b = normalize_embedding(b)

    return float(np.dot(a, b))


def load_database():
    """Load registered student embeddings from the encrypted database."""
    if not os.path.isfile(EMBEDDING_FILE):
        raise FileNotFoundError(
            f"Embedding database not found: {EMBEDDING_FILE}"
        )

    database = load_encrypted_database(EMBEDDING_FILE)

    if not isinstance(database, dict):
        raise ValueError(
            "Invalid embedding database format. Expected a dictionary."
        )

    return database

# --------------------------------------------------
# FACE BOUNDING BOX
# --------------------------------------------------

def get_face_bbox(face, image_width, image_height):
    """
    Return a valid face bounding box.

    Coordinates correspond to the original image dimensions.
    The box is clamped to the image boundaries.
    """
    bbox = np.asarray(face.bbox, dtype=np.float32)

    if bbox.size != 4 or not np.all(np.isfinite(bbox)):
        return None

    x1, y1, x2, y2 = bbox

    x1 = int(np.floor(np.clip(x1, 0, image_width - 1)))
    y1 = int(np.floor(np.clip(y1, 0, image_height - 1)))
    x2 = int(np.ceil(np.clip(x2, 0, image_width)))
    y2 = int(np.ceil(np.clip(y2, 0, image_height)))

    if x2 <= x1 or y2 <= y1:
        return None

    return [x1, y1, x2, y2]


# --------------------------------------------------
# RECOGNIZE FACES IN AN IMAGE
# --------------------------------------------------

def recognize_image(image):
    """
    Detect and recognize faces in an image already loaded
    into an OpenCV/Numpy array.

    Returns a list of dictionaries containing:
        face_number
        student_id
        similarity
        bbox
    """
    if image is None:
        raise ValueError("The supplied image is empty.")

    if not isinstance(image, np.ndarray):
        raise ValueError("Image must be an OpenCV/Numpy array.")

    if image.ndim not in (2, 3):
        raise ValueError("Unsupported image dimensions.")

    image_height, image_width = image.shape[:2]

    if image_height == 0 or image_width == 0:
        raise ValueError("Image has invalid dimensions.")

    # Load the database for the recognition request.
    database = load_database()

    # Detect faces in this image/frame.
    faces = app.get(image)

    results = []

    for face_number, face in enumerate(faces, start=1):
        bbox = get_face_bbox(
            face,
            image_width,
            image_height
        )

        if bbox is None:
            continue

        test_embedding = normalize_embedding(face.embedding)

        best_student = None
        best_score = -1.0

        # Compare the detected face against registered embeddings.
        for student_id, records in database.items():
            if not isinstance(records, (list, tuple)):
                continue

            for record in records:
                if not isinstance(record, dict):
                    continue

                if "embedding" not in record:
                    continue

                stored_embedding = normalize_embedding(
                    record["embedding"]
                )

                # Ignore incompatible or invalid embeddings.
                if (
                    test_embedding.shape != stored_embedding.shape
                    or not np.all(np.isfinite(stored_embedding))
                ):
                    continue

                score = cosine_similarity(
                    test_embedding,
                    stored_embedding
                )

                if score > best_score:
                    best_score = score
                    best_student = student_id

        if best_student is not None and best_score >= THRESHOLD:
            prediction = best_student
        else:
            prediction = "UNKNOWN"

        results.append({
            "face_number": face_number,
            "student_id": prediction,
            "similarity": float(best_score),
            "bbox": bbox
        })

    return results


def recognize_group(image_path):
    """
    Detect and recognize faces in a group photo loaded from disk.

    This function retains the same interface as your existing
    implementation so existing Flask routes can continue using it.
    """
    if not os.path.isfile(image_path):
        raise FileNotFoundError(
            f"Image file not found: {image_path}"
        )

    image = cv2.imread(image_path)

    if image is None:
        raise ValueError(
            f"Could not read image: {image_path}"
        )

    return recognize_image(image)


# --------------------------------------------------
# RECOGNIZE FACES IN A VIDEO
# --------------------------------------------------

def recognize_video(
    video_path,
    frame_interval=DEFAULT_FRAME_INTERVAL,
    max_frames=DEFAULT_MAX_FRAMES
):
    """
    Recognize faces in sampled video frames.

    Args:
        video_path: Path to a video file.
        frame_interval: Seconds between sampled frames.
        max_frames: Maximum number of frames to process.

    Returns:
        A list of frame results. Each item contains:
            timestamp_seconds
            faces

    Note:
        This function does not mark attendance in a database.
        The Flask route or frontend should aggregate recognized
        student IDs and apply the attendance rules.
    """
    if not os.path.isfile(video_path):
        raise FileNotFoundError(
            f"Video file not found: {video_path}"
        )

    if frame_interval <= 0:
        raise ValueError(
            "frame_interval must be greater than zero."
        )

    if max_frames <= 0:
        raise ValueError(
            "max_frames must be greater than zero."
        )

    capture = cv2.VideoCapture(video_path)

    if not capture.isOpened():
        capture.release()

        raise ValueError(
            f"Could not open video: {video_path}"
        )

    fps = capture.get(cv2.CAP_PROP_FPS)

    if not fps or not np.isfinite(fps) or fps <= 0:
        capture.release()

        raise ValueError(
            "Could not determine the video's frame rate."
        )

    total_frames = capture.get(cv2.CAP_PROP_FRAME_COUNT)

    duration_seconds = (
        total_frames / fps
        if total_frames and total_frames > 0
        else 0
    )

    frame_step = max(
        1,
        int(round(fps * frame_interval))
    )

    results = []
    frame_index = 0
    processed_frames = 0

    try:
        while processed_frames < max_frames:
            success, frame = capture.read()

            if not success:
                break

            if frame_index % frame_step == 0:
                timestamp_seconds = frame_index / fps

                faces = recognize_image(frame)

                results.append({
                    "timestamp_seconds": round(
                        timestamp_seconds, 3
                    ),
                    "faces": faces
                })

                processed_frames += 1

            frame_index += 1

    finally:
        capture.release()

    return {
        "video_path": video_path,
        "duration_seconds": round(duration_seconds, 3),
        "frames_processed": processed_frames,
        "results": results
    }