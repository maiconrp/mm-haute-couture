(function () {
  'use strict';

  if (window.MMAnalyticsInitialized) return;
  window.MMAnalyticsInitialized = true;

  const config = window.MM_TRACKING_CONFIG || {};
  const metaPixelId = String(config.metaPixelId || '').trim();
  const ga4MeasurementId = String(config.ga4MeasurementId || '').trim();
  const hasMeta = /^\d{5,20}$/.test(metaPixelId);
  const hasGA4 = /^G-[A-Z0-9]{10}$/i.test(ga4MeasurementId);
  const hasMarketingFeatures = hasMeta || hasGA4;

  if (!hasMeta && !hasGA4) return;

  const consentKey = 'mm_tracking_consent_v1';
  const consentDuration = 180 * 24 * 60 * 60 * 1000;
  const isPortuguese = location.pathname.toLowerCase().split('/').includes('pt-br');
  const text = isPortuguese
    ? {
        title: 'Preferências de privacidade',
        message: 'Utilizamos tecnologias opcionais de análise e publicidade para entender o uso do site e medir campanhas. Elas só serão ativadas com sua autorização.',
        policy: 'Política de Privacidade',
        accept: 'Aceitar todos',
        reject: 'Recusar opcionais',
        customize: 'Personalizar',
        save: 'Salvar preferências',
        analytics: 'Análise do site (Google Analytics 4)',
        marketing: 'Publicidade (Meta Pixel e recursos de anúncios)',
        settings: 'Preferências de privacidade',
        necessary: 'As preferências essenciais ficam armazenadas para lembrar sua escolha.'
      }
    : {
        title: 'Privacy preferences',
        message: 'We use optional analytics and advertising technologies to understand site use and measure campaigns. They are only activated with your permission.',
        policy: 'Privacy Policy',
        accept: 'Accept all',
        reject: 'Reject optional',
        customize: 'Customize',
        save: 'Save preferences',
        analytics: 'Website analytics (Google Analytics 4)',
        marketing: 'Advertising (Meta Pixel and ad features)',
        settings: 'Privacy settings',
        necessary: 'Essential preferences are stored to remember your choice.'
      };

  const savedConsent = readConsent();
  let consent = savedConsent || { analytics: false, marketing: false };
  let hasSavedConsent = savedConsent !== null;
  let gaInitialized = false;
  let metaInitialized = false;
  let gaPageViewSent = false;
  let metaPageViewSent = false;
  let bookingStartSent = false;
  const completedBookings = new Set();
  let consentPanel;
  let settingsPanel;
  let settingsTrigger;
  let analyticsCheckbox;
  let marketingCheckbox;

  function readConsent() {
    try {
      const saved = JSON.parse(localStorage.getItem(consentKey) || 'null');
      if (
        !saved ||
        saved.version !== 1 ||
        !Number.isFinite(saved.savedAt) ||
        Date.now() - saved.savedAt > consentDuration
      ) return null;
      return {
        analytics: hasGA4 && saved.analytics === true,
        marketing: hasMarketingFeatures && saved.marketing === true
      };
    } catch {
      return null;
    }
  }

  function persistConsent(nextConsent) {
    consent = {
      analytics: hasGA4 && nextConsent.analytics === true,
      marketing: hasMarketingFeatures && nextConsent.marketing === true
    };
    hasSavedConsent = true;
    try {
      localStorage.setItem(consentKey, JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        analytics: consent.analytics,
        marketing: consent.marketing
      }));
    } catch {
      // Consent still applies for this page view when browser storage is unavailable.
    }
    applyConsent();
    if (settingsTrigger) settingsTrigger.hidden = false;
  }

  function googleConsent() {
    return {
      analytics_storage: consent.analytics ? 'granted' : 'denied',
      ad_storage: consent.marketing ? 'granted' : 'denied',
      ad_user_data: consent.marketing ? 'granted' : 'denied',
      ad_personalization: consent.marketing ? 'granted' : 'denied'
    };
  }

  function safePageLocation(includeAdClickIds) {
    const url = new URL(location.href);
    const allowedParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'
    ];
    if (includeAdClickIds) {
      allowedParams.push('gclid', 'dclid', 'gbraid', 'wbraid', 'fbclid');
    }
    const search = new URLSearchParams();
    allowedParams.forEach((key) => {
      url.searchParams.getAll(key).forEach((value) => search.append(key, value));
    });
    const query = search.toString();
    return `${url.origin}${url.pathname}${query ? `?${query}` : ''}`;
  }

  function pageReferrer() {
    if (!document.referrer) return '';
    try {
      const referrer = new URL(document.referrer);
      return referrer.origin;
    } catch {
      return '';
    }
  }

  function gaEvent(name, parameters) {
    if (hasGA4 && consent.analytics && typeof window.gtag === 'function') {
      window.gtag('event', name, parameters || {});
    }
  }

  function metaEvent(name) {
    if (hasMeta && consent.marketing && typeof window.fbq === 'function') {
      window.fbq('track', name);
    }
  }

  function sendPageViews() {
    if (consent.analytics && gaInitialized && !gaPageViewSent) {
      gaPageViewSent = true;
      gaEvent('page_view', {
        page_location: safePageLocation(consent.marketing),
        page_title: document.title,
        page_referrer: pageReferrer()
      });
    }
    if (consent.marketing && metaInitialized && !metaPageViewSent) {
      metaPageViewSent = true;
      metaEvent('PageView');
    }
  }

  function loadGA4() {
    if (!hasGA4 || gaInitialized) return;
    gaInitialized = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      window.dataLayer.push(arguments);
    };
    window.gtag('consent', 'default', {
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied'
    });
    window.gtag('js', new Date());
    window.gtag('consent', 'update', googleConsent());
    window.gtag('config', ga4MeasurementId, {
      send_page_view: false,
      allow_google_signals: consent.marketing,
      allow_ad_personalization_signals: consent.marketing
    });

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4MeasurementId)}`;
    script.dataset.mmTracking = 'ga4';
    document.head.appendChild(script);
    sendPageViews();
  }

  function loadMetaPixel() {
    if (!hasMeta || metaInitialized) return;
    metaInitialized = true;

    if (typeof window.fbq !== 'function') {
      const fbq = function () {
        if (fbq.callMethod) {
          fbq.callMethod.apply(fbq, arguments);
        } else {
          fbq.queue.push(arguments);
        }
      };
      fbq.push = fbq;
      fbq.loaded = true;
      fbq.version = '2.0';
      fbq.queue = [];
      window.fbq = fbq;
      window._fbq = fbq;
    }

    window.fbq('set', 'autoConfig', false, metaPixelId);
    window.fbq('init', metaPixelId);
    window.fbq('consent', 'grant');

    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    script.dataset.mmTracking = 'meta-pixel';
    document.head.appendChild(script);
    sendPageViews();
  }

  function applyConsent() {
    if (consent.analytics) {
      loadGA4();
    } else if (gaInitialized && typeof window.gtag === 'function') {
      window.gtag('consent', 'update', googleConsent());
    }

    if (consent.marketing) {
      loadMetaPixel();
    } else if (metaInitialized && typeof window.fbq === 'function') {
      window.fbq('consent', 'revoke');
    }

    if (gaInitialized && typeof window.gtag === 'function') {
      window.gtag('consent', 'update', googleConsent());
      window.gtag('set', 'allow_google_signals', consent.marketing);
      window.gtag('set', 'allow_ad_personalization_signals', consent.marketing);
    }
    sendPageViews();
  }

  function makeButton(label, className, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  function createConsentUI() {
    const wrapper = document.createElement('section');
    wrapper.className = 'mm-consent';
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', text.title);

    const heading = document.createElement('h2');
    heading.textContent = text.title;
    const message = document.createElement('p');
    message.textContent = text.message + ' ';
    const policyLink = document.createElement('a');
    policyLink.href = isPortuguese ? 'privacidade.html' : 'privacy.html';
    policyLink.textContent = text.policy;
    policyLink.target = '_blank';
    policyLink.rel = 'noopener noreferrer';
    message.appendChild(policyLink);

    const actions = document.createElement('div');
    actions.className = 'mm-consent__actions';
    const saveButton = makeButton(text.save, 'mm-consent__button mm-consent__button--primary', () => {
      persistConsent({
        analytics: analyticsCheckbox ? analyticsCheckbox.checked : false,
        marketing: marketingCheckbox ? marketingCheckbox.checked : false
      });
      wrapper.hidden = true;
    });

    settingsPanel = document.createElement('div');
    settingsPanel.className = 'mm-consent__settings';
    settingsPanel.hidden = true;
    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = text.settings;
    fieldset.appendChild(legend);

    if (hasGA4) {
      analyticsCheckbox = document.createElement('input');
      analyticsCheckbox.type = 'checkbox';
      analyticsCheckbox.checked = Boolean(consent && consent.analytics);
      const label = document.createElement('label');
      label.append(analyticsCheckbox, document.createTextNode(text.analytics));
      fieldset.appendChild(label);
    }

    if (hasMarketingFeatures) {
      marketingCheckbox = document.createElement('input');
      marketingCheckbox.type = 'checkbox';
      marketingCheckbox.checked = Boolean(consent && consent.marketing);
      const label = document.createElement('label');
      label.append(marketingCheckbox, document.createTextNode(text.marketing));
      fieldset.appendChild(label);
    }

    const note = document.createElement('p');
    note.className = 'mm-consent__note';
    note.textContent = text.necessary;
    settingsPanel.append(fieldset, note, saveButton);

    actions.append(
      makeButton(text.accept, 'mm-consent__button mm-consent__button--primary', () => {
        persistConsent({ analytics: hasGA4, marketing: hasMarketingFeatures });
        wrapper.hidden = true;
      }),
      makeButton(text.reject, 'mm-consent__button', () => {
        persistConsent({ analytics: false, marketing: false });
        wrapper.hidden = true;
      }),
      makeButton(text.customize, 'mm-consent__button mm-consent__button--text', () => {
        settingsPanel.hidden = !settingsPanel.hidden;
        if (settingsPanel.hidden) return;
        if (analyticsCheckbox) analyticsCheckbox.checked = Boolean(consent && consent.analytics);
        if (marketingCheckbox) marketingCheckbox.checked = Boolean(consent && consent.marketing);
        (analyticsCheckbox || marketingCheckbox).focus();
      })
    );

    wrapper.append(heading, message, actions, settingsPanel);
    document.body.appendChild(wrapper);
    return wrapper;
  }

  function showConsentSettings() {
    if (!consentPanel) consentPanel = createConsentUI();
    consentPanel.hidden = false;
    settingsPanel.hidden = false;
    if (analyticsCheckbox) analyticsCheckbox.checked = Boolean(consent && consent.analytics);
    if (marketingCheckbox) marketingCheckbox.checked = Boolean(consent && consent.marketing);
    (analyticsCheckbox || marketingCheckbox).focus();
  }

  function initializeConsentUI() {
    consentPanel = createConsentUI();
    consentPanel.hidden = hasSavedConsent;
    settingsTrigger = makeButton(text.settings, 'mm-consent__trigger', showConsentSettings);
    settingsTrigger.setAttribute('aria-label', text.settings);
    settingsTrigger.hidden = !hasSavedConsent;
    document.body.appendChild(settingsTrigger);
  }

  function bookingStarted() {
    if (bookingStartSent || !consent.analytics) return;
    bookingStartSent = true;
    gaEvent('booking_start', { method: 'website' });
  }

  function bookingCompleted(bookingId) {
    if (typeof bookingId !== 'string' || !bookingId || completedBookings.has(bookingId)) return;
    completedBookings.add(bookingId);
    if (!consent.analytics && !consent.marketing) return;

    try {
      const stored = JSON.parse(sessionStorage.getItem('mm_completed_bookings') || '[]');
      if (stored.includes(bookingId)) return;
      sessionStorage.setItem('mm_completed_bookings', JSON.stringify(stored.concat(bookingId).slice(-20)));
    } catch {
      // In-memory deduplication remains active if session storage is unavailable.
    }

    gaEvent('booking_complete', { method: 'website' });
    metaEvent('Lead');
  }

  window.MMAnalytics = Object.freeze({
    trackBookingComplete: bookingCompleted
  });

  document.addEventListener('focusin', (event) => {
    if (event.target instanceof Element && event.target.closest('#booking-form')) {
      bookingStarted();
    }
  });

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest('a[href], button');
    if (!target) return;

    if (target.matches('a[href]')) {
      let destination;
      try {
        destination = new URL(target.href, location.href);
      } catch {
        destination = null;
      }

      if (destination && ['wa.me', 'api.whatsapp.com'].includes(destination.hostname.toLowerCase())) {
        gaEvent('whatsapp_click', { link_domain: destination.hostname.toLowerCase() });
        metaEvent('Contact');
        return;
      }

      if (
        target.classList.contains('btn') &&
        destination &&
        /\/(?:contact|contato)\.html$/i.test(destination.pathname)
      ) {
        gaEvent('booking_cta_click', { destination_path: destination.pathname });
      }
    }

    if (target.classList.contains('booking-submit')) {
      gaEvent('booking_cta_click', { destination_path: location.pathname });
    }
  });

  initializeConsentUI();
  applyConsent();
})();
