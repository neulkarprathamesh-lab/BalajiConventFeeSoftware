BALAJI FEEHUB CLIENT {{VERSION}} - INSTALLATION AND USE
=======================================================

Files in this package
  BalajiFeeHub-Client-Setup.exe          Installer (Windows Program Files install)
  BalajiFeeHub-Client-Windows-x64.zip    Portable copy - extract and run, no install
  README-Client-Installation.txt         This file
  CLIENT-DEPENDENCIES.txt                What the client needs (nothing to install by hand)

1. INSTALL (Setup.exe)
  1. Double-click BalajiFeeHub-Client-Setup.exe.
  2. Approve the Windows administrator prompt (the client installs under
     Program Files, as earlier versions did).
  3. Finish the wizard. Tick "Create a desktop shortcut" if wanted.
  4. Open Balaji FeeHub from the desktop or Start menu.
  The installer does NOT ask for a server address and needs no other software.

2. PORTABLE ZIP (no installer)
  1. Extract BalajiFeeHub-Client-Windows-x64.zip anywhere, for example
     D:\BalajiFeeHub-Client.
  2. Open the BalajiFeeHub-Client folder and double-click BalajiFeeHub.exe.
  Keep the whole folder together. It is the complete client.

3. FIRST START AND THE MAIN SERVER ADDRESS
  - The client opens its own screens immediately. It does not need the Main
    Server to start.
  - Default Main Server address: 192.168.0.116, port 8001.
  - To change it: File > Server Settings. Enter the IP address (or host
    name) and port, use Test connection, then Save. The client reloads at
    once. No restart and no editing of files is needed.
  - The address is kept at  %APPDATA%\BalajiFeeHub\config.json
    It survives restarts, Windows restarts and client updates. Reinstalling
    the client does not reset it.

4. STATUS BADGE (bottom of the left menu)
  - Connected       Synced <time>          Server reachable, data up to date
  - Syncing         N changes pending      Sending and receiving data
  - Offline         Server unavailable     Local mode - keep working
  - Sign in to sync Changes waiting        Server reachable; sign in again
  - Sync problem    <reason>               See the message; use Diagnostic Report
  Clicking the badge checks the Main Server immediately.

5. WORKING WITHOUT THE MAIN SERVER (LOCAL MODE)
  Works offline:
    - Student search and student view (last synced data)
    - Fee lookup and new receipts
    - New expenses and new bills
    - Bus master (read only)
  Waits for the Main Server (shown as "needs the Main Server"):
    - Student profile edits and admission/identity changes
    - Fee adjustments, fee structure and fee head changes
    - Bus master changes, user and role changes, Master PIN, device administration
  A receipt, expense or bill entered offline is saved on this PC, marked as
  waiting, and sent automatically when the Main Server returns. The Main
  Server gives it its real receipt/expense/bill number at that moment, so
  numbers never repeat and nothing is entered twice.

6. SIGNING IN OFFLINE
  - After a successful sign-in with the Main Server, this PC can sign that
    user in while the Main Server is off, using the same password.
  - The password itself is never stored on this PC. Only a salted,
    slow-to-compute hash is kept.
  - Offline sign-in is limited to users who signed in on this PC before, and
    it stops working after 90 days without a sign-in to the Main Server.
  - An administrator who deactivates a user on the Main Server removes that
    user's offline access the next time that user tries to sign in here.

7. WHEN THE MAIN SERVER RETURNS
  Nothing to do. The client notices the server within about 30 seconds,
  reconnects, sends waiting changes, and pulls the latest data. The badge
  shows Connected again. If the sign-in has expired, the badge says
  "Sign in to sync": sign in once and the waiting changes are sent.

8. UPDATES
  Help > Check for Updates. Updates come from the Main Server and are
  signature-checked before they are applied.

9. TROUBLESHOOTING
  - Badge stays Offline with the server on: check the address in File >
    Server Settings and press Test connection. Check that Windows Firewall
    on the Main Server allows port 8001.
  - Help > Create Diagnostic Report writes a file to the Desktop. Send it to
    the administrator.

10. UNINSTALL
  Settings > Apps > Balaji FeeHub > Uninstall removes the program files only.
  The local data folder (%APPDATA%\BalajiFeeHub) stays, including the server
  address and any changes that have not been sent yet. Reinstalling the
  client picks them up again.
