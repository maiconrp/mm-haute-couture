<?php
declare(strict_types=1);

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_API_BASE = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_SCOPES = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.freebusy',
];

header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store, private');
header('Referrer-Policy: no-referrer');

$isHttps = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
session_set_cookie_params([
    'httponly' => true,
    'secure' => $isHttps,
    'samesite' => 'Lax',
]);
session_start();

$action = (string) ($_GET['action'] ?? '');

try {
    if ($action === 'authorize') {
        handleAuthorizationSetup();
    } elseif ($action === 'oauth-callback') {
        handleOAuthCallback();
    } elseif ($action === 'csrf' && $_SERVER['REQUEST_METHOD'] === 'GET') {
        $token = bin2hex(random_bytes(32));
        $_SESSION['booking_csrf'] = $token;
        jsonResponse(['csrfToken' => $token]);
    } elseif ($action === 'availability' && $_SERVER['REQUEST_METHOD'] === 'GET') {
        $date = requireString($_GET['date'] ?? null, 'date', 10, 10);
        jsonResponse(['date' => $date, 'slots' => getAvailableSlots($date)]);
    } elseif ($action === 'book' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        handleBooking();
    } else {
        jsonResponse(['error' => 'not_found', 'message' => 'The requested booking endpoint does not exist.'], 404);
    }
} catch (ApiException $error) {
    jsonResponse(['error' => $error->errorCode, 'message' => $error->getMessage()], $error->httpStatus);
} catch (Throwable $error) {
    error_log('[booking-api] ' . $error->getMessage());
    jsonResponse(['error' => 'internal_error', 'message' => 'The booking service could not complete this request. Please try again or contact the atelier.'], 500);
}

function handleAuthorizationSetup(): void
{
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        header('Content-Type: text/html; charset=utf-8');
        echo '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Google Calendar</title><body style="font:16px sans-serif;max-width:34rem;margin:10vh auto;padding:0 1rem"><h1>Connect Google Calendar</h1><p>Enter the private setup key configured on the server to authorize the atelier calendar.</p><form method="post"><label for="setup-key">Setup key</label><br><input id="setup-key" name="setup_key" type="password" required autocomplete="current-password" style="box-sizing:border-box;width:100%;margin:12px 0;padding:12px"><button type="submit" style="padding:12px 18px">Continue to Google</button></form></body></html>';
        return;
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        jsonResponse(['error' => 'method_not_allowed', 'message' => 'Use the authorization form.'], 405);
    }

    verifySameOrigin();
    $providedKey = (string) ($_POST['setup_key'] ?? '');
    $setupKey = envValue('GOOGLE_OAUTH_SETUP_KEY');
    if ($providedKey === '' || !hash_equals($setupKey, $providedKey)) {
        throw new ApiException('forbidden', 'The setup key is invalid.', 403);
    }

    $clientId = envValue('GOOGLE_CLIENT_ID');
    $redirectUri = envValue('GOOGLE_REDIRECT_URI');
    $siteOrigin = parse_url(envValue('BOOKING_SITE_ORIGIN'));
    if (($siteOrigin['scheme'] ?? '') !== 'https') {
        throw new ApiException('configuration_required', 'Set BOOKING_SITE_ORIGIN to the HTTPS origin of the production site.', 503);
    }
    if (!filter_var($redirectUri, FILTER_VALIDATE_URL) || !str_starts_with($redirectUri, rtrim(envValue('BOOKING_SITE_ORIGIN'), '/') . '/')) {
        throw new ApiException('configuration_required', 'GOOGLE_REDIRECT_URI must be an HTTPS URL on the configured site origin.', 503);
    }

    session_regenerate_id(true);
    $state = bin2hex(random_bytes(32));
    $_SESSION['google_oauth_state'] = $state;
    $_SESSION['google_oauth_created'] = time();
    $query = http_build_query([
        'client_id' => $clientId,
        'redirect_uri' => $redirectUri,
        'response_type' => 'code',
        'scope' => implode(' ', GOOGLE_SCOPES),
        'access_type' => 'offline',
        'prompt' => 'consent',
        'include_granted_scopes' => 'true',
        'state' => $state,
    ]);

    header('Location: ' . GOOGLE_AUTH_URL . '?' . $query, true, 302);
}

function handleOAuthCallback(): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        jsonResponse(['error' => 'method_not_allowed', 'message' => 'Invalid authorization callback.'], 405);
    }

    $expectedState = (string) ($_SESSION['google_oauth_state'] ?? '');
    $providedState = (string) ($_GET['state'] ?? '');
    $createdAt = (int) ($_SESSION['google_oauth_created'] ?? 0);
    unset($_SESSION['google_oauth_state'], $_SESSION['google_oauth_created']);
    if ($expectedState === '' || $providedState === '' || !hash_equals($expectedState, $providedState) || time() - $createdAt > 600) {
        throw new ApiException('invalid_oauth_state', 'The Google authorization expired or could not be verified. Start the connection again.', 400);
    }
    if (isset($_GET['error'])) {
        throw new ApiException('oauth_denied', 'Google Calendar authorization was not granted.', 400);
    }

    $code = requireString($_GET['code'] ?? null, 'code', 1, 4096);
    $token = httpJsonRequest('POST', GOOGLE_TOKEN_URL, [
        'code' => $code,
        'client_id' => envValue('GOOGLE_CLIENT_ID'),
        'client_secret' => envValue('GOOGLE_CLIENT_SECRET'),
        'redirect_uri' => envValue('GOOGLE_REDIRECT_URI'),
        'grant_type' => 'authorization_code',
    ], [], true);

    if (!isset($token['refresh_token']) || !is_string($token['refresh_token'])) {
        throw new ApiException('refresh_token_missing', 'Google did not return a refresh token. Revoke this app in Google Account permissions, then reconnect and approve offline access.', 502);
    }

    $token['expires_at'] = time() + (int) ($token['expires_in'] ?? 3600);
    savePrivateJsonFile(envValue('GOOGLE_TOKEN_FILE'), $token);

    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Calendar connected</title><body style="font:16px sans-serif;max-width:34rem;margin:10vh auto;padding:0 1rem"><h1>Google Calendar connected</h1><p>The atelier calendar has been authorized. You can close this page.</p></body></html>';
}

function handleBooking(): void
{
    verifySameOrigin();
    $input = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($input)) {
        throw new ApiException('invalid_request', 'The booking request must contain valid JSON.', 400);
    }

    $sessionToken = (string) ($_SESSION['booking_csrf'] ?? '');
    $requestToken = (string) ($input['csrfToken'] ?? '');
    if ($sessionToken === '' || $requestToken === '' || !hash_equals($sessionToken, $requestToken)) {
        throw new ApiException('csrf_failed', 'Refresh the page and submit your booking again.', 403);
    }

    $name = requireString($input['name'] ?? null, 'name', 2, 120);
    $email = requireString($input['email'] ?? null, 'email', 3, 254);
    $phone = requireString($input['phone'] ?? null, 'phone', 5, 40);
    $service = requireString($input['service'] ?? null, 'service', 2, 100);
    $mode = requireString($input['mode'] ?? null, 'mode', 1, 20);
    $date = requireString($input['date'] ?? null, 'date', 10, 10);
    $slotStart = requireString($input['slotStart'] ?? null, 'slotStart', 20, 40);
    $eventDate = optionalString($input['eventDate'] ?? '', 10);
    $address = optionalString($input['address'] ?? '', 300);
    $message = optionalString($input['message'] ?? '', 2000);
    $idempotencyKey = requireString($input['idempotencyKey'] ?? null, 'idempotencyKey', 36, 36);

    if (!preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/', $slotStart)) {
        throw new ApiException('invalid_slot', 'Choose one of the available appointment times.', 422);
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        throw new ApiException('invalid_email', 'Enter a valid email address.', 422);
    }
    if (!in_array($mode, ['atelier', 'mobile'], true)) {
        throw new ApiException('invalid_mode', 'Choose one of the available fitting modes.', 422);
    }
    if ($mode === 'mobile' && trim($address) === '') {
        throw new ApiException('address_required', 'Enter the address or area for the off-site fitting.', 422);
    }
    if ($eventDate !== '' && !validDate($eventDate)) {
        throw new ApiException('invalid_event_date', 'Enter a valid event date.', 422);
    }
    if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $idempotencyKey)) {
        throw new ApiException('invalid_idempotency_key', 'Refresh the page and submit the booking again.', 422);
    }

    $requestedStart = new DateTimeImmutable($slotStart);
    $timezone = new DateTimeZone(envValue('BOOKING_TIMEZONE', 'Australia/Brisbane'));
    if ($requestedStart->setTimezone($timezone)->format('Y-m-d') !== $date) {
        throw new ApiException('invalid_slot', 'The selected time does not match the selected date.', 422);
    }

    $payloadHash = hash('sha256', json_encode([
        $name, $email, $phone, $service, $mode, $date, $requestedStart->getTimestamp(), $eventDate, $address, $message,
    ], JSON_THROW_ON_ERROR));
    $database = bookingDatabase();
    if (!$database->exec('BEGIN IMMEDIATE')) {
        $database->close();
        throw new ApiException('booking_lock_failed', 'The booking could not be safely reserved. Please try again.', 503);
    }

    try {
        $existing = $database->prepare('SELECT payload_hash, event_id, start_utc FROM bookings WHERE idempotency_key = :key');
        $existing->bindValue(':key', $idempotencyKey, SQLITE3_TEXT);
        $existingRow = $existing->execute()->fetchArray(SQLITE3_ASSOC);
        if (is_array($existingRow)) {
            if (!hash_equals((string) $existingRow['payload_hash'], $payloadHash)) {
                throw new ApiException('duplicate_request', 'This booking request has already been used. Refresh availability before submitting another request.', 409);
            }
            $database->exec('COMMIT');
            jsonResponse([
                'bookingId' => (string) $existingRow['event_id'],
                'start' => (new DateTimeImmutable((string) $existingRow['start_utc']))->setTimezone($timezone)->format(DateTimeInterface::ATOM),
                'duplicate' => true,
            ]);
        }

        $slots = getAvailableSlots($date, $database);
        $selectedSlot = null;
        foreach ($slots as $slot) {
            if ((new DateTimeImmutable($slot['start']))->getTimestamp() === $requestedStart->getTimestamp()) {
                $selectedSlot = $slot;
                break;
            }
        }
        if ($selectedSlot === null) {
            throw new ApiException('slot_unavailable', 'That time is no longer available. Choose another time.', 409);
        }

        $end = new DateTimeImmutable($selectedSlot['end']);
        $location = $mode === 'atelier' ? 'Atelier Private Fitting, Albany Creek, QLD' : $address;
        $description = implode("\n", array_filter([
            'Client: ' . $name,
            'Email: ' . $email,
            'Phone: ' . $phone,
            'Service: ' . $service,
            'Fitting mode: ' . ($mode === 'atelier' ? 'Atelier Private Fitting' : 'Mobile / In-City Fitting'),
            $eventDate !== '' ? 'Event date: ' . $eventDate : '',
            $message !== '' ? 'Notes: ' . $message : '',
        ]));
        $event = googleApiRequest('POST', '/calendars/' . rawurlencode(envValue('GOOGLE_CALENDAR_ID', 'primary')) . '/events', [
            'summary' => 'Private fitting — ' . $name . ' — ' . $service,
            'description' => $description,
            'location' => $location,
            'start' => ['dateTime' => $selectedSlot['start'], 'timeZone' => $timezone->getName()],
            'end' => ['dateTime' => $end->format(DateTimeInterface::ATOM), 'timeZone' => $timezone->getName()],
            'visibility' => 'private',
            'transparency' => 'opaque',
            'status' => 'confirmed',
        ]);
        if (!isset($event['id']) || !is_string($event['id'])) {
            throw new ApiException('calendar_write_failed', 'Google Calendar did not confirm the appointment. No booking confirmation was issued.', 502);
        }

        $insert = $database->prepare('INSERT INTO bookings (idempotency_key, payload_hash, event_id, start_utc, end_utc, created_at) VALUES (:key, :hash, :event, :start, :end, :created)');
        $insert->bindValue(':key', $idempotencyKey, SQLITE3_TEXT);
        $insert->bindValue(':hash', $payloadHash, SQLITE3_TEXT);
        $insert->bindValue(':event', $event['id'], SQLITE3_TEXT);
        $insert->bindValue(':start', $requestedStart->setTimezone(new DateTimeZone('UTC'))->format(DateTimeInterface::ATOM), SQLITE3_TEXT);
        $insert->bindValue(':end', $end->setTimezone(new DateTimeZone('UTC'))->format(DateTimeInterface::ATOM), SQLITE3_TEXT);
        $insert->bindValue(':created', gmdate(DateTimeInterface::ATOM), SQLITE3_TEXT);
        if (!$insert->execute()) {
            throw new ApiException('booking_store_failed', 'The appointment could not be safely recorded. Contact the atelier before trying again.', 500);
        }
        $database->exec('COMMIT');
    } catch (Throwable $error) {
        $database->exec('ROLLBACK');
        throw $error;
    } finally {
        $database->close();
    }

    jsonResponse([
        'bookingId' => $event['id'],
        'start' => $selectedSlot['start'],
        'duplicate' => false,
    ], 201);
}

function getAvailableSlots(string $date, ?SQLite3 $database = null): array
{
    if (!validDate($date)) {
        throw new ApiException('invalid_date', 'Choose a valid calendar date.', 422);
    }

    $timezone = new DateTimeZone(envValue('BOOKING_TIMEZONE', 'Australia/Brisbane'));
    $localDay = DateTimeImmutable::createFromFormat('!Y-m-d', $date, $timezone);
    $today = new DateTimeImmutable('today', $timezone);
    $daysAhead = max(1, (int) envValue('BOOKING_DAYS_AHEAD', '60'));
    if ($localDay < $today || $localDay > $today->modify('+' . $daysAhead . ' days')) {
        throw new ApiException('date_out_of_range', 'Choose a date within the available booking window.', 422);
    }

    $schedule = businessHours();
    $daySchedule = $schedule[(string) $localDay->format('N')] ?? [];
    if ($daySchedule === []) {
        return [];
    }

    $durationMinutes = max(5, min(480, (int) envValue('BOOKING_SLOT_MINUTES', '30')));
    $bufferMinutes = max(0, min(240, (int) envValue('BOOKING_BUFFER_MINUTES', '0')));
    $windows = [];
    foreach ($daySchedule as $window) {
        $start = new DateTimeImmutable($date . ' ' . $window[0], $timezone);
        $end = new DateTimeImmutable($date . ' ' . $window[1], $timezone);
        if ($end <= $start) {
            throw new ApiException('invalid_schedule', 'Business hour windows must end after they start.', 503);
        }
        $windows[] = [
            'start' => $start,
            'end' => $end,
            'busy' => [],
        ];
    }

    $dayStart = $localDay->setTime(0, 0);
    $dayEnd = $dayStart->modify('+1 day');
    $busyTimes = googleApiRequest('POST', '/freeBusy', [
        'timeMin' => $dayStart->format(DateTimeInterface::ATOM),
        'timeMax' => $dayEnd->format(DateTimeInterface::ATOM),
        'timeZone' => $timezone->getName(),
        'items' => [['id' => envValue('GOOGLE_CALENDAR_ID', 'primary')]],
    ]);
    $calendarId = envValue('GOOGLE_CALENDAR_ID', 'primary');
    $calendarBusy = $busyTimes['calendars'][$calendarId]['busy'] ?? null;
    if (!is_array($calendarBusy)) {
        throw new ApiException('calendar_unavailable', 'Google Calendar returned no availability data. Please try again later.', 502);
    }

    $localBusy = $database === null ? [] : localBusyIntervals($database, $dayStart, $dayEnd);
    $busyIntervals = array_merge($calendarBusy, $localBusy);
    $now = new DateTimeImmutable('now', $timezone);
    $slots = [];
    foreach ($windows as $window) {
        $candidate = $window['start'];
        while ($candidate->modify('+' . $durationMinutes . ' minutes') <= $window['end']) {
            $candidateEnd = $candidate->modify('+' . $durationMinutes . ' minutes');
            $blocked = $candidate < $now;
            foreach ($busyIntervals as $interval) {
                $busyStart = new DateTimeImmutable($interval['start']);
                $busyEnd = new DateTimeImmutable($interval['end']);
                if ($candidate < $busyEnd && $candidateEnd->modify('+' . $bufferMinutes . ' minutes') > $busyStart) {
                    $blocked = true;
                    break;
                }
            }
            if (!$blocked) {
                $slots[] = [
                    'start' => $candidate->format(DateTimeInterface::ATOM),
                    'end' => $candidateEnd->format(DateTimeInterface::ATOM),
                    'label' => $candidate->format('g:i A'),
                ];
            }
            $candidate = $candidate->modify('+' . $durationMinutes . ' minutes');
        }
    }

    return $slots;
}

function businessHours(): array
{
    $raw = envValue('BOOKING_BUSINESS_HOURS');
    $schedule = json_decode($raw, true);
    if (!is_array($schedule) || $schedule === []) {
        throw new ApiException('booking_not_configured', 'Online booking is not available yet. Please contact the atelier to arrange your fitting.', 503);
    }

    foreach ($schedule as $day => $windows) {
        if (!in_array((string) $day, ['1', '2', '3', '4', '5', '6', '7'], true) || !is_array($windows)) {
            throw new ApiException('invalid_schedule', 'BOOKING_BUSINESS_HOURS must be valid JSON with ISO weekdays 1–7.', 503);
        }
        $lastWindowEnd = '';
        foreach ($windows as $window) {
            if (!is_array($window) || count($window) !== 2 || !validTime((string) $window[0]) || !validTime((string) $window[1])) {
                throw new ApiException('invalid_schedule', 'Each business hour window must contain a start and end time in HH:MM format.', 503);
            }
            if ($window[1] <= $window[0] || ($lastWindowEnd !== '' && $window[0] < $lastWindowEnd)) {
                throw new ApiException('invalid_schedule', 'Business hour windows must be ordered, non-overlapping, and end after they start.', 503);
            }
            $lastWindowEnd = $window[1];
        }
    }

    return $schedule;
}

function localBusyIntervals(SQLite3 $database, DateTimeImmutable $dayStart, DateTimeImmutable $dayEnd): array
{
    $query = $database->prepare('SELECT start_utc, end_utc FROM bookings WHERE start_utc < :day_end AND end_utc > :day_start');
    $query->bindValue(':day_start', $dayStart->setTimezone(new DateTimeZone('UTC'))->format(DateTimeInterface::ATOM), SQLITE3_TEXT);
    $query->bindValue(':day_end', $dayEnd->setTimezone(new DateTimeZone('UTC'))->format(DateTimeInterface::ATOM), SQLITE3_TEXT);
    $result = $query->execute();
    $intervals = [];
    while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
        $intervals[] = ['start' => $row['start_utc'], 'end' => $row['end_utc']];
    }
    return $intervals;
}

function bookingDatabase(): SQLite3
{
    if (!class_exists(SQLite3::class)) {
        throw new ApiException('server_configuration', 'The booking server requires the PHP SQLite3 extension.', 503);
    }
    $path = requirePrivatePath('BOOKING_DB_PATH');
    $database = new SQLite3($path, SQLITE3_OPEN_READWRITE | SQLITE3_OPEN_CREATE);
    $database->enableExceptions(true);
    if (!chmod($path, 0600)) {
        $database->close();
        throw new ApiException('private_storage_permissions', 'The booking database file permissions could not be restricted.', 503);
    }
    $database->busyTimeout(10000);
    $database->exec('PRAGMA journal_mode = WAL');
    $database->exec('PRAGMA synchronous = FULL');
    $database->exec('CREATE TABLE IF NOT EXISTS bookings (
        idempotency_key TEXT PRIMARY KEY,
        payload_hash TEXT NOT NULL,
        event_id TEXT NOT NULL UNIQUE,
        start_utc TEXT NOT NULL,
        end_utc TEXT NOT NULL,
        created_at TEXT NOT NULL
    )');
    $database->exec('CREATE INDEX IF NOT EXISTS bookings_time_range ON bookings (start_utc, end_utc)');
    return $database;
}

function googleApiRequest(string $method, string $path, ?array $payload = null): array
{
    $token = loadGoogleToken();
    if ((int) ($token['expires_at'] ?? 0) <= time() + 60) {
        $token = refreshGoogleToken($token);
    }
    $calendarId = envValue('GOOGLE_CALENDAR_ID', 'primary');
    $url = GOOGLE_API_BASE . $path;
    $headers = ['Authorization: Bearer ' . $token['access_token']];
    return httpJsonRequest($method, $url, $payload, $headers);
}

function loadGoogleToken(): array
{
    $path = requirePrivatePath('GOOGLE_TOKEN_FILE');
    if (!is_file($path)) {
        throw new ApiException('calendar_not_connected', 'Google Calendar has not been connected by the atelier yet.', 503);
    }
    $token = json_decode((string) file_get_contents($path), true);
    if (!is_array($token) || !isset($token['refresh_token'])) {
        throw new ApiException('calendar_token_invalid', 'The stored Google Calendar connection is invalid. Reconnect the calendar.', 503);
    }
    return $token;
}

function refreshGoogleToken(array $previousToken): array
{
    $token = httpJsonRequest('POST', GOOGLE_TOKEN_URL, [
        'client_id' => envValue('GOOGLE_CLIENT_ID'),
        'client_secret' => envValue('GOOGLE_CLIENT_SECRET'),
        'refresh_token' => $previousToken['refresh_token'],
        'grant_type' => 'refresh_token',
    ], [], true);
    $token['refresh_token'] = $previousToken['refresh_token'];
    $token['expires_at'] = time() + (int) ($token['expires_in'] ?? 3600);
    savePrivateJsonFile(envValue('GOOGLE_TOKEN_FILE'), $token);
    return $token;
}

function savePrivateJsonFile(string $configuredPath, array $data): void
{
    $path = resolvePrivatePath($configuredPath);
    $temporaryPath = $path . '.' . bin2hex(random_bytes(8)) . '.tmp';
    $json = json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
    if (file_put_contents($temporaryPath, $json, LOCK_EX) === false) {
        throw new ApiException('token_storage_failed', 'The private Google Calendar token could not be stored on the server.', 500);
    }
    if (!chmod($temporaryPath, 0600)) {
        unlink($temporaryPath);
        throw new ApiException('token_storage_permissions', 'The Google Calendar token file permissions could not be restricted.', 500);
    }
    if (!rename($temporaryPath, $path)) {
        unlink($temporaryPath);
        throw new ApiException('token_storage_failed', 'The private Google Calendar token could not be stored on the server.', 500);
    }
}

function requirePrivatePath(string $environmentName): string
{
    return resolvePrivatePath(envValue($environmentName));
}

function resolvePrivatePath(string $configuredPath): string
{
    $documentRoot = realpath((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''));
    $parent = realpath(dirname($configuredPath));
    if ($configuredPath === '' || $documentRoot === false || $parent === false) {
        throw new ApiException('private_storage_not_configured', 'Configure private token and booking database paths outside the public document root.', 503);
    }
    $fullPath = $parent . DIRECTORY_SEPARATOR . basename($configuredPath);
    if (is_link($fullPath)) {
        throw new ApiException('unsafe_private_storage', 'Private Google tokens and booking data must not use symbolic-link paths.', 503);
    }
    if ($fullPath === $documentRoot || str_starts_with($fullPath, rtrim($documentRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR)) {
        throw new ApiException('unsafe_private_storage', 'Private Google tokens and booking data must be stored outside the public document root.', 503);
    }
    return $fullPath;
}

function httpJsonRequest(string $method, string $url, ?array $payload, array $headers = [], bool $formEncoded = false): array
{
    if (!function_exists('curl_init')) {
        throw new ApiException('server_configuration', 'The PHP cURL extension is required for secure Google Calendar API requests.', 503);
    }
    $curl = curl_init($url);
    if ($curl === false) {
        throw new ApiException('calendar_connection_failed', 'Could not connect to Google Calendar. Please try again.', 502);
    }

    $body = $payload === null ? null : ($formEncoded ? http_build_query($payload) : json_encode($payload, JSON_THROW_ON_ERROR));
    if ($body !== null) {
        $headers[] = 'Content-Type: ' . ($formEncoded ? 'application/x-www-form-urlencoded' : 'application/json');
    }
    curl_setopt_array($curl, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);
    $response = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    $curlError = curl_error($curl);
    curl_close($curl);

    if (!is_string($response)) {
        error_log('[booking-api] Google request failed: ' . $curlError);
        throw new ApiException('calendar_connection_failed', 'Could not connect to Google Calendar. Please try again.', 502);
    }
    $decoded = json_decode($response, true);
    if ($status < 200 || $status >= 300 || !is_array($decoded)) {
        $reason = $decoded['error']['message'] ?? 'Google Calendar returned an unexpected response.';
        error_log('[booking-api] Google API HTTP ' . $status . ': ' . $reason);
        throw new ApiException('calendar_request_failed', 'Google Calendar could not complete the request. Please try again or contact the atelier.', $status === 401 ? 503 : 502);
    }
    return $decoded;
}

function verifySameOrigin(): void
{
    $configuredOrigin = rtrim(envValue('BOOKING_SITE_ORIGIN'), '/');
    $requestOrigin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
    if ($configuredOrigin === '' || $requestOrigin === '' || !hash_equals($configuredOrigin, $requestOrigin)) {
        throw new ApiException('origin_not_allowed', 'This request must come from the configured atelier website.', 403);
    }
}

function envValue(string $name, ?string $default = null): string
{
    $value = getenv($name);
    if ($value === false || $value === '') {
        if ($default !== null) {
            return $default;
        }
        throw new ApiException('configuration_required', 'The booking service requires server configuration for ' . $name . '.', 503);
    }
    return $value;
}

function requireString(mixed $value, string $field, int $minimum, int $maximum): string
{
    if (!is_string($value)) {
        throw new ApiException('invalid_' . $field, 'Enter a valid ' . str_replace('_', ' ', $field) . '.', 422);
    }
    $value = trim($value);
    if (mb_strlen($value) < $minimum || mb_strlen($value) > $maximum) {
        throw new ApiException('invalid_' . $field, 'Enter a valid ' . str_replace('_', ' ', $field) . '.', 422);
    }
    return $value;
}

function optionalString(mixed $value, int $maximum): string
{
    if (!is_string($value) || mb_strlen($value) > $maximum) {
        throw new ApiException('invalid_request', 'One of the submitted fields is too long or invalid.', 422);
    }
    return trim($value);
}

function validDate(string $date): bool
{
    $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date, new DateTimeZone('Australia/Brisbane'));
    return $parsed !== false && $parsed->format('Y-m-d') === $date;
}

function validTime(string $time): bool
{
    return preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/', $time) === 1;
}

function jsonResponse(array $body, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

final class ApiException extends RuntimeException
{
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly int $httpStatus = 400
    ) {
        parent::__construct($message);
    }
}
