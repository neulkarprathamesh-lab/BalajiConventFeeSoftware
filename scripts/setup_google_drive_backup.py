"""
One-time, INTERACTIVE setup for the FeeHub disaster-recovery backup's Google Drive upload.

Run this yourself, as the school's FeeHub administrator, on the Main Server PC. It opens your
default browser to a real Google sign-in/consent page - nobody else (including any automated
assistant) should run this on your behalf, since it is your Google account being authorized.

Before running this script:
  1. Go to https://console.cloud.google.com/ and create (or pick) a project.
  2. APIs & Services > Library > enable the "Google Drive API".
  3. APIs & Services > Credentials > Create Credentials > OAuth client ID.
     - Application type: "Desktop app".
     - Download the JSON and save it exactly as:
       C:\\balaji-fee\\backend\\keys\\gdrive_client_secret.json
  4. APIs & Services > OAuth consent screen: add your own Google account under "Test users" if the
     app is in Testing mode (fine for a single-school internal tool - no Google review needed).

What this script does:
  - Opens your browser, asks you to sign in and approve access to Google Drive (scoped to ONLY the
    files this app creates - "drive.file" - never your whole Drive).
  - Saves the resulting token (including the refresh token used for unattended future uploads) to
    C:\\balaji-fee\\backend\\keys\\gdrive_token.json.
  - Creates the "Balaji FeeHub Backups" folder in your Drive if it does not already exist.

This file and the client-secret file are never committed to git (backend/keys/ is excluded - see
.gitignore) and are never logged or exposed through any FeeHub API response.

Run (from this venv):
    C:\\balaji-fee\\venv\\Scripts\\python.exe scripts\\setup_google_drive_backup.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))
import backup_engine as be  # noqa: E402


def main():
    if not be.GDRIVE_CLIENT_SECRET_FILE.exists():
        print(f"ERROR: {be.GDRIVE_CLIENT_SECRET_FILE} not found.")
        print("Download your OAuth client (Desktop app type) JSON from Google Cloud Console and save it there first.")
        print("See the instructions at the top of this script.")
        sys.exit(1)

    from google_auth_oauthlib.flow import InstalledAppFlow

    print("Opening your browser for Google sign-in... approve access to Google Drive (files created by this app only).")
    flow = InstalledAppFlow.from_client_secrets_file(str(be.GDRIVE_CLIENT_SECRET_FILE), be.GDRIVE_SCOPES)
    creds = flow.run_local_server(port=0)

    be.KEYS_DIR.mkdir(parents=True, exist_ok=True)
    be.GDRIVE_TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")
    be._restrict_to_admins(be.GDRIVE_TOKEN_FILE)
    print(f"Saved token to {be.GDRIVE_TOKEN_FILE}")

    print('Creating/checking the "Balaji FeeHub Backups" folder on Google Drive...')
    service = be._gdrive_service()
    folder_id = be._get_or_create_folder(service)
    print(f"Folder ready (id: {folder_id}). Google Drive backup is now configured.")
    print("You can verify with: Admin > Backup / Disaster Recovery > Backup Now in FeeHub.")


if __name__ == "__main__":
    main()
