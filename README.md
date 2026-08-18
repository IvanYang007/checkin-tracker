# Check-In Tracker

A simple, installable web app for tracking recurring check-ins (medicine, habits, chores, etc.).

## Features

- Multiple independent check-ins
- Count-up items — track days since the last check-in and reset anytime
- Daily, weekly, monthly, or custom cron schedules
- Big "Done" button per check-in
- Automatic reset when the current period ends
- No server required; data stays on your device
- Works as a PWA (installable on Android/Chrome)

## Schedule behavior

- **Daily** – resets at the start of each day (00:00).
- **Weekly** – resets at the start of each week (Monday 00:00).
- **Monthly** – resets on the first day of each month (00:00).
- **Custom cron** – resets at the most recent cron fire time.
- **Count Up** – no schedule; shows days since the last check-in and resets whenever you tap Check In.

The scheduled time is when the check-in is due, but you can mark it done any time during that period.

## How to use

1. Open `index.html` in Chrome/Edge on your phone or computer.
2. Tap **+ Add Item** (or **+ Count Up** for a count-up item directly).
3. Give it a name and choose a schedule (or Count Up).
4. Tap **Mark Done** when you complete it.
5. The check mark clears automatically when the next period starts.

## Run locally

You can open `index.html` directly, but some features (like service worker installability) work best when served over HTTP. On your computer:

```bash
cd checkin-tracker
python -m http.server 8080
```

Then open `http://localhost:8080`.

On Windows you can also double-click `start-webapp.bat` (or run `start-webapp.ps1` in PowerShell).

## Run the quick tests

Open `test.html` in a browser. It runs checks for the cron parser, schedule descriptions, period start/reset logic, and done-state handling.

You can also run the automated Node test suite:

```bash
node run-tests.js
```

## Install on Android

1. Open the app in Chrome.
2. Open the browser menu (three dots).
3. Choose **Add to Home screen** or **Install app**.
4. It will appear like a native app on your phone.
