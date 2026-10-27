# Class Attendance System

Khmer attendance interface backed by JavaScript (Node.js) and a SQLite database. No npm dependencies or separate database installation required.

## Run locally

1. Install Node.js 24 or later (tested with 24.14.0).
2. Open a terminal in this folder and run:

   ```sh
   npm ci
   npm start
   ```

3. Open **http://localhost:3000** in your browser. Do not open `index.html` directly or use VS Code Live Server.
4. On first use, create an administrator username and password (at least 10 characters). Subsequent visits use the same login.
5. Add students in the student management tab, then record attendance by date and session.

Each fresh installation starts with an empty database. Create your own administrator account; there is no default username or password.

## Features

- Add, edit and delete students, with duplicate ID validation.
- Present, permission, absent and late attendance marks, saved immediately to SQLite.
- Mark all students present (confirmation required before replacing existing marks).
- Separate attendance for each date and morning, afternoon, evening or hourly session.
- Unmarked students stay unmarked and do not count as present.
- Reports for all time, the current month, or the current week (Monday through today). Filters use the browser's local date.
- Attendance rate is `(present + late × 0.8) / recorded marks × 100`. Permission and absence count in the denominator; unmarked students do not. The dashboard weights its overall rate by recorded marks.
- Khmer-compatible CSV export follows the selected report period; print using the existing print button.
- Passwords hashed with salted scrypt; server-side sessions expire after 12 hours. Student data requires authentication, and writes require a CSRF token.

Changing a student's ID preserves their attendance. **Deleting a student also permanently deletes their attendance history.**

## Files and data

- `index.html`: Khmer layout and styles.
- `app.js`: interface behavior and API calls.
- `server.js`: HTTP API, validation, authentication and SQLite schema.
- `test/`: backend integration tests and frontend behavior tests.
- `package-lock.json`: npm lockfile; commit this alongside `package.json`.
- `data/attendance.sqlite3`: persistent data, created automatically and excluded from Git.

Stop the server before copying the `data` directory to back it up. Keep the backup private: it includes student data and password hashes. The Node SQLite module may print an experimental warning on Node 24; this is expected.

This server listens only on your own computer (`127.0.0.1`). Internet access is needed for the existing Tailwind CDN, icons and Google font. Public hosting would need deployment configuration, HTTPS and an account recovery workflow.

To use another port in PowerShell:

```powershell
$env:PORT=3001
npm start
```

If you see `EADDRINUSE`, a server is already using that port. Open the running app or stop the other instance with `Ctrl+C` before starting again.

## Verify

```sh
npm run check
npm test
```

Tests cover login and access control, validation, persistence after restart, attendance separation, atomic batch writes, ID changes, deletion, report filtering, unmarked counts, HTML escaping and failed-save behavior. Tests create temporary databases and do not change your saved classroom data.

## Push to GitHub

Create an empty repository on GitHub, then run these commands from this folder. Replace `YOUR_USERNAME` and `YOUR_REPOSITORY` with your repository details.

```sh
git init -b main
git add .
git status --short
git commit -m "Add class attendance system"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

The `.gitignore` excludes the database, SQLite sidecar files, CSV reports, local secrets, logs and editor files. Your existing local data stays on your computer. Review `git status --short` before committing to confirm only project source and documentation are staged.

GitHub stores the source code. GitHub Pages cannot run this Node.js backend; run the app locally or deploy it to a host that supports Node.js and persistent storage.
