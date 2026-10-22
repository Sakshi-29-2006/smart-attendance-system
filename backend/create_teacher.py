
import getpass
import sys

from werkzeug.security import generate_password_hash
from supabase_client import supabase


def main():
    print("=== Create Teacher Account ===")

    username = input("Teacher username: ").strip()

    if not username or len(username) > 100:
        print("Error: Username must be between 1 and 100 characters.")
        sys.exit(1)

    password = getpass.getpass("Teacher password (minimum 12 characters): ")
    confirm_password = getpass.getpass("Confirm teacher password: ")

    if len(password) < 12 or len(password) > 128:
        print("Error: Password must be 12–128 characters.")
        sys.exit(1)

    if password != confirm_password:
        print("Error: Passwords do not match.")
        sys.exit(1)

    try:
        existing = (
            supabase.table("teachers")
            .select("id")
            .eq("username", username)
            .limit(1)
            .execute()
        )

        if existing.data:
            print("Error: This teacher username already exists.")
            sys.exit(1)

        password_hash = generate_password_hash(password)

        result = supabase.table("teachers").insert({
            "username": username,
            "password_hash": password_hash,
        }).execute()

        if not result.data:
            print("Error: Teacher account could not be created.")
            sys.exit(1)

        print(f"Teacher account '{username}' created successfully.")

    except Exception as exc:
        print("Error type:", type(exc).__name__)
        print("Error details:", str(exc))
        sys.exit(1)


if __name__ == "__main__":
    main()
