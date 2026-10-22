
import pickle
import shutil
import sys
from pathlib import Path

import numpy as np
from cryptography.fernet import InvalidToken

from config import REGISTERED_EMBEDDING_FILE
from services.secure_biometric_store import (
    load_encrypted_database,
    save_encrypted_database,
)


def main():
    database_path = Path(REGISTERED_EMBEDDING_FILE).resolve()

    if not database_path.exists():
        print(f"ERROR: Database not found: {database_path}")
        sys.exit(1)

    try:
        file_bytes = database_path.read_bytes()
    except OSError as exc:
        print(f"ERROR: Cannot read database: {exc}")
        sys.exit(1)

    # Fernet-encrypted files typically start with this prefix.
    if file_bytes.startswith(b"gAAAA"):
        try:
            existing = load_encrypted_database(database_path)
        except (InvalidToken, RuntimeError, ValueError) as exc:
            print(f"ERROR: Encrypted database cannot be decrypted: {exc}")
            sys.exit(1)

        if not isinstance(existing, dict):
            print("ERROR: Decrypted database is not a dictionary.")
            sys.exit(1)

        print("Database is already encrypted. No changes made.")
        print(f"Students preserved: {len(existing)}")
        return

    # Only load a trusted pickle file created by your application.
    try:
        database = pickle.loads(file_bytes)
    except Exception as exc:
        print(f"ERROR: Could not read original database: {exc}")
        sys.exit(1)

    if not isinstance(database, dict):
        print("ERROR: Expected a dictionary of student embeddings.")
        sys.exit(1)

    total_embeddings = 0

    # Validate the actual structure: student ID -> list of face records.
    for student_id, records in database.items():
        if not isinstance(records, list):
            print(f"ERROR: Records for student {student_id} are not a list.")
            sys.exit(1)

        if not records:
            print(f"ERROR: Student {student_id} has no face records.")
            sys.exit(1)

        for index, record in enumerate(records):
            if not isinstance(record, dict):
                print(
                    f"ERROR: Invalid record {index} for student {student_id}."
                )
                sys.exit(1)

            if "embedding" not in record or "filename" not in record:
                print(
                    f"ERROR: Record {index} for student {student_id} "
                    "is missing filename or embedding."
                )
                sys.exit(1)

            try:
                embedding = np.asarray(
                    record["embedding"],
                    dtype=np.float32
                )
            except (TypeError, ValueError, OverflowError):
                print(
                    f"ERROR: Invalid embedding for student {student_id}, "
                    f"record {index}."
                )
                sys.exit(1)

            if embedding.shape != (512,):
                print(
                    f"ERROR: Expected a 512-dimensional embedding for "
                    f"student {student_id}, record {index}; "
                    f"found shape {embedding.shape}."
                )
                sys.exit(1)

            if not np.isfinite(embedding).all():
                print(
                    f"ERROR: Non-finite embedding for student {student_id}, "
                    f"record {index}."
                )
                sys.exit(1)

            total_embeddings += 1

    backup_path = database_path.with_suffix(
        database_path.suffix + ".migration-backup"
    )

    if backup_path.exists():
        print(f"ERROR: Backup already exists: {backup_path}")
        print("No changes made. Inspect the existing backup first.")
        sys.exit(1)

    try:
        shutil.copy2(database_path, backup_path)
    except OSError as exc:
        print(f"ERROR: Could not create migration backup: {exc}")
        sys.exit(1)

    try:
        save_encrypted_database(database, database_path)

        restored = load_encrypted_database(database_path)

        if not isinstance(restored, dict):
            raise RuntimeError("Verification failed: database is not a dictionary.")

        if restored.keys() != database.keys():
            raise RuntimeError("Verification failed: student IDs differ.")

        restored_total = 0

        for student_id, original_records in database.items():
            restored_records = restored[student_id]

            if len(restored_records) != len(original_records):
                raise RuntimeError(
                    f"Verification failed: record count differs for "
                    f"student {student_id}."
                )

            for original, recovered in zip(
                original_records, restored_records
            ):
                if original["filename"] != recovered["filename"]:
                    raise RuntimeError(
                        f"Verification failed: filename differs for "
                        f"student {student_id}."
                    )

                if not np.array_equal(
                    np.asarray(original["embedding"]),
                    np.asarray(recovered["embedding"])
                ):
                    raise RuntimeError(
                        f"Verification failed: embedding differs for "
                        f"student {student_id}."
                    )

                restored_total += 1

        if restored_total != total_embeddings:
            raise RuntimeError("Verification failed: total embedding count differs.")

        print("Migration successful!")
        print(f"Students preserved: {len(restored)}")
        print(f"Face embeddings preserved: {restored_total}")
        print(f"Encrypted database: {database_path}")
        print(f"Original backup: {backup_path}")

    except Exception as exc:
        try:
            shutil.copy2(backup_path, database_path)
            print("Original database restored from backup.")
        except OSError as restore_exc:
            print(f"CRITICAL: Automatic restoration failed: {restore_exc}")
            print(f"Restore manually from: {backup_path}")

        print(f"ERROR: Migration failed: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
