# Google Calendar booking setup

## What the site does

The public pages are static HTML. The previous form collected an optional event date and showed a success message in the browser; it did not store appointment dates or times and did not connect to a calendar.

The new form selects an atelier or mobile fitting, requests live appointment availability, and confirms a selected 30-minute slot through the PHP endpoint at `/api/calendar.php`. The endpoint checks Google Calendar again before inserting a private event. A private SQLite database outside the website document root serializes bookings made through the site and makes retries idempotent. Availability is refreshed when a date is selected and every 60 seconds while the booking page is open.

Google credentials and OAuth tokens are only read or written by PHP on the server. No calendar credentials or access tokens are included in browser code.

## Required server configuration

Configure these as PHP/server environment variables in the hosting control panel or PHP-FPM configuration. Do not put secret values in HTML, JavaScript, a publicly served `.env` file, or source control.

| Variable | Required value |
| --- | --- |
| `BOOKING_SITE_ORIGIN` | Exact public HTTPS origin, with no trailing slash; for example `https://marciamorais.com`. Use the canonical `www` host instead if that is the site's actual canonical host. |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 client ID for a Google **Web application**. |
| `GOOGLE_CLIENT_SECRET` | Secret for that OAuth client. |
| `GOOGLE_REDIRECT_URI` | Exact callback URL registered in Google Cloud, for example `https://marciamorais.com/api/calendar.php?action=oauth-callback`. Its origin must match `BOOKING_SITE_ORIGIN`. |
| `GOOGLE_OAUTH_SETUP_KEY` | Strong, unique secret used to authorize the one-time calendar connection. Generate one with `openssl rand -hex 32`. |
| `GOOGLE_CALENDAR_ID` | `primary` for the Google account that completes OAuth, or an explicitly shared calendar ID. |
| `GOOGLE_TOKEN_FILE` | Absolute writable path for the OAuth token JSON, **outside** the public document root. Example: `/home/ACCOUNT/private/marcia-google-token.json`. |
| `BOOKING_DB_PATH` | Absolute writable path for SQLite booking records, **outside** the public document root. Example: `/home/ACCOUNT/private/marcia-bookings.sqlite`. |
| `BOOKING_BUSINESS_HOURS` | Required JSON schedule in Brisbane local time. No hours have been assumed; online slots stay unavailable until the atelier's actual days/hours are supplied and configured. |
| `BOOKING_SLOT_MINUTES` | Appointment duration in minutes. Set to `30` as requested. |
| `BOOKING_TIMEZONE` | `Australia/Brisbane`. |
| `BOOKING_DAYS_AHEAD` | Optional booking horizon in days; defaults to `60`. |
| `BOOKING_BUFFER_MINUTES` | Optional buffer after each appointment; defaults to `0`. |

`BOOKING_BUSINESS_HOURS` uses ISO weekdays (`1` = Monday through `7` = Sunday) and ordered, non-overlapping `HH:MM` start/end windows. Example syntax only — replace these example hours with the atelier's confirmed schedule:

```json
{"1":[["09:00","17:00"]],"2":[["09:00","17:00"]],"3":[["09:00","17:00"]],"4":[["09:00","17:00"]],"5":[["09:00","17:00"]]}
```

Create the private storage directory before connecting the calendar. It must not be within the website's `public_html`/document root and must be writable only by the PHP hosting account. The PHP runtime needs PHP 8.1+, cURL, OpenSSL, sessions, and SQLite3. The Google Calendar API must be reachable over HTTPS.

## Google Cloud and OAuth

1. Select or create a Google Cloud project and enable **Google Calendar API**.
2. Configure the OAuth consent screen. Add the atelier's Google account as an allowed test user during setup. Google refresh tokens for an external app left in testing expire after seven days; before relying on ongoing bookings, move the app to production and complete any Google verification required for its Calendar scopes.
3. Create an OAuth client of type **Web application**. Add the exact `GOOGLE_REDIRECT_URI` above as an authorized redirect URI.
4. Set the client ID and secret in the hosting environment. The app requests `calendar.events` and `calendar.freebusy` access so it can check conflicts and create events.
5. After deploying the PHP endpoint over HTTPS, visit `https://marciamorais.com/api/calendar.php?action=authorize`, enter `GOOGLE_OAUTH_SETUP_KEY`, and sign in to the Google account whose calendar will be used. The callback stores the refresh token in `GOOGLE_TOKEN_FILE`; it never returns the token to the browser.
6. Confirm the selected account's calendar is the calendar identified by `GOOGLE_CALENDAR_ID`.

The form creates a private, confirmed Calendar event only after the user selects a currently free time and submits the form. It does not send calendar invitations to the client.

## Turn booking on

After confirming the atelier's real opening days and hours, set `BOOKING_BUSINESS_HOURS`, deploy the files, connect Google Calendar, and verify that an occupied calendar time is absent from the returned slots and cannot be booked. Until the opening schedule and calendar connection are both configured, the form displays an unavailable message instead of a simulated success.

Atelier and Mobile / In-City fittings use the same calendar availability. Mobile appointments collect the requested address and show the travel-fee notice. Configure the actual travel fee policy separately with the atelier; this integration does not calculate or charge a fee.
