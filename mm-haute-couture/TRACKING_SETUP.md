# Analytics and conversion tracking setup

## Required IDs

Tracking is intentionally inactive until the traffic team provides both of the following IDs:

- **Meta Pixel ID** from Meta Events Manager.
- **GA4 Measurement ID** for the intended web data stream (format `G-...`).

Add the IDs to `analytics-config.js`. These identifiers are public tag IDs, not account credentials. Do not put OAuth tokens, API secrets, or other credentials in this file. No Google Tag Manager container was found or added; the site loads GA4 directly and only after analytics consent.

## Consent behavior

On pages where at least one valid ID is configured, visitors can accept all optional tracking, reject it, or select analytics and advertising separately. Their selection is stored in first-party local storage and can be changed through the persistent **Privacy settings** control. Nothing is sent to Google or Meta before the corresponding consent is granted. If browser storage is unavailable, the choice applies to the current page only.

GA4 consent signals are updated for analytics and advertising storage. Meta Pixel is only loaded after advertising consent and is revoked if that choice is withdrawn. The site does not send booking form fields or WhatsApp message text to either platform.

## Events

| Platform | Event | Trigger |
| --- | --- | --- |
| Meta Pixel | `PageView` | One view per loaded page after advertising consent |
| Meta Pixel | `Contact` | Click on a WhatsApp link |
| Meta Pixel | `Lead` | Appointment confirmed by the booking API |
| GA4 | `page_view` | One view per loaded page after analytics consent |
| GA4 | `whatsapp_click` | Click on a WhatsApp link |
| GA4 | `booking_cta_click` | Booking CTA or booking-form submit button click |
| GA4 | `booking_start` | First interaction with the booking form |
| GA4 | `booking_complete` | Appointment confirmed by the booking API |

`booking_complete` is the primary event to mark as a **key event** in GA4 Admin after the property and Measurement ID are configured. If the team also treats a WhatsApp inquiry as a conversion, `whatsapp_click` can be marked as a secondary key event. To optimize Google Ads campaigns against these events, link the GA4 property to the Ads account and import the selected key events there. The site suppresses GA4's automatic initial page view (`send_page_view: false`) and sends one explicit page view. Static page navigation is full-page navigation; no SPA/history instrumentation was found.

## Validation after IDs are supplied

1. Use Meta Pixel Helper and Meta Events Manager Test Events to confirm one `PageView` per page, `Contact` on WhatsApp clicks, and `Lead` only after a real API-confirmed appointment.
2. Use GA4 DebugView (or Tag Assistant) to verify each event and confirm `booking_complete` is marked as a key event.
3. Before granting consent, confirm neither `connect.facebook.net` nor `googletagmanager.com/gtag/js` loads. Test accepting, rejecting, changing preferences, internal page navigation, and mobile layouts.
4. Ensure no additional GTM or manually installed copies of either tag are added, to avoid duplicate page views or events. Review Meta Events Manager's automatic event tracking and disable overlapping automatic events if they duplicate the explicit `Contact` or `Lead` events.

Meta Pixel Helper, Events Manager, and GA4 DebugView cannot validate live events until the real IDs, property access, consent and production deployment are available.
