import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

REGISTERED_DATASET = os.path.abspath(
    os.path.join(
        BASE_DIR,
        "..",
        "dataset",
        "registered"
    )
)

REGISTERED_EMBEDDING_FILE = os.path.join(
    BASE_DIR,
    "models",
    "registered_embeddings.pkl"
)

STUDENT_DATA_FILE = os.path.join(
    BASE_DIR,
    "models",
    "students.json"
)


THRESHOLD = 0.51