
from supabase_client import supabase

BUCKET_NAME = "attendance-private"


def download_file(remote_path):
    """Download a file; return None only when it is absent."""
    try:
        return supabase.storage.from_(BUCKET_NAME).download(remote_path)

    except Exception as exc:
        status_code = (
            getattr(exc, "status", None)
            or getattr(exc, "status_code", None)
        )
        message = str(exc).lower()

        # Treat only a clear not-found response as an absent object.
        if status_code == 404:
            return None

        if (
            "object not found" in message
            or "no such file" in message
        ) and "permission" not in message and "unauthorized" not in message:
            return None

        raise RuntimeError(
            f"Could not download {remote_path} from private storage."
        ) from exc


def upload_file(
    remote_path,
    content,
    content_type,
    *,
    overwrite=False,
):
    """
    Upload a file to private storage.

    By default, refuse to replace an existing object.
    Set overwrite=True only when a deliberate database update is intended.
    """
    try:
        supabase.storage.from_(BUCKET_NAME).upload(
            path=remote_path,
            file=content,
            file_options={
                "upsert": "true" if overwrite else "false",
                "content-type": content_type,
            },
        )

    except Exception as exc:
        raise RuntimeError(
            f"Could not upload {remote_path} to private storage. "
            "The object may already exist, or the request may have failed."
        ) from exc
