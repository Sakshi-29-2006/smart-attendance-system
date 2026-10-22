
import os
import pickle
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

KEY = os.getenv("BIOMETRIC_ENCRYPTION_KEY")

if not KEY:
    raise RuntimeError(
        "BIOMETRIC_ENCRYPTION_KEY is missing from backend/.env"
    )

try:
    FERNET = Fernet(KEY.encode("utf-8"))
except (ValueError, TypeError) as exc:
    raise RuntimeError(
        "BIOMETRIC_ENCRYPTION_KEY is invalid"
    ) from exc


def save_encrypted_database(data, file_path):
    """Encrypt and save a trusted biometric database."""
    path = Path(file_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    serialized_data = pickle.dumps(data)
    encrypted_data = FERNET.encrypt(serialized_data)

    temp_path = path.with_suffix(path.suffix + ".tmp")

    try:
        with open(temp_path, "wb") as file:
            file.write(encrypted_data)
            file.flush()
            os.fsync(file.fileno())

        os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            temp_path.unlink()


def load_encrypted_database(file_path):
    """Load and decrypt a database created by this application."""
    path = Path(file_path)

    if not path.exists():
        return None

    encrypted_data = path.read_bytes()

    try:
        serialized_data = FERNET.decrypt(encrypted_data)
    except InvalidToken as exc:
        raise RuntimeError(
            "Cannot decrypt biometric database. "
            "Check the encryption key and database file."
        ) from exc

    # Only decrypt and unpickle files created by this trusted application.
    return pickle.loads(serialized_data)
