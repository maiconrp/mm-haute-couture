/* ==========================================================================
   MM HAUTE COUTURE — INTERACTIVE VANILLA JAVASCRIPT
   Author: Senior Front-End & Luxury UI/UX Specialist
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  /* ------------------------------------------------------------------------
     1. STICKY HEADER BACKGROUND ON SCROLL
     ------------------------------------------------------------------------ */
  const header = document.querySelector('.header');

  const handleScroll = () => {
    if (header) {
      if (window.scrollY > 40) {
        header.classList.add('scrolled');
      } else {
        header.classList.remove('scrolled');
      }
    }
  };

  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll(); // Initial check

  /* ------------------------------------------------------------------------
     2. MOBILE MENU DRAWER TOGGLE
     ------------------------------------------------------------------------ */
  const mobileToggle = document.querySelector('.mobile-toggle');
  const navMenu = document.querySelector('.nav-menu');
  const navLinks = document.querySelectorAll('.nav-link');

  if (mobileToggle && navMenu) {
    const toggleMenu = () => {
      const isExpanded = mobileToggle.classList.contains('active');
      mobileToggle.classList.toggle('active');
      navMenu.classList.toggle('active');
      mobileToggle.setAttribute('aria-expanded', !isExpanded);
      document.body.style.overflow = !isExpanded ? 'hidden' : '';
    };

    mobileToggle.addEventListener('click', toggleMenu);

    // Close mobile menu when clicking any navigation link
    navLinks.forEach(link => {
      link.addEventListener('click', () => {
        if (navMenu.classList.contains('active')) {
          toggleMenu();
        }
      });
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (navMenu.classList.contains('active') &&
        !navMenu.contains(e.target) &&
        !mobileToggle.contains(e.target)) {
        toggleMenu();
      }
    });
  }

  /* ------------------------------------------------------------------------
     3. INTERSECTION OBSERVER FOR ACTIVE NAV LINKS
     ------------------------------------------------------------------------ */
  const sections = document.querySelectorAll('section[id]');

  if (sections.length > 0 && navLinks.length > 0) {
    const observerOptions = {
      root: null,
      rootMargin: '-20% 0px -60% 0px',
      threshold: 0
    };

    const sectionObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.getAttribute('id');
          navLinks.forEach(link => {
            const href = link.getAttribute('href');
            // Apenas remove ou adiciona a classe se o link for uma âncora interna (começa com #)
            if (href && href.startsWith('#')) {
              link.classList.remove('active');
              if (href === `#${id}`) {
                link.classList.add('active');
              }
            }
          });
        }
      });
    }, observerOptions);

    sections.forEach(section => sectionObserver.observe(section));
  }

  /* ------------------------------------------------------------------------
     4. INTERACTIVE BOOKING FORM & VALIDATION
     ------------------------------------------------------------------------ */
  const bookingForm = document.getElementById('booking-form');
  const feedbackModal = document.getElementById('feedback-modal');
  const closeModalBtn = document.getElementById('close-modal-btn');
  const modalClientName = document.getElementById('modal-client-name');

  if (bookingForm) {
    const apiUrl = bookingForm.dataset.bookingApi;
    const appointmentDate = document.getElementById('appointment-date');
    const slotContainer = document.getElementById('appointment-slots');
    const bookingStatus = document.getElementById('booking-status');
    const submitButton = bookingForm.querySelector('.booking-submit');
    const refreshAvailabilityButton = document.getElementById('refresh-availability');
    const offsiteFields = document.getElementById('offsite-fields');
    const fittingAddress = document.getElementById('fitting-address');
    const confirmationMessage = document.getElementById('booking-confirmation-message');
    const isPortuguese = document.documentElement.lang.toLowerCase().startsWith('pt');
    const bookingText = isPortuguese ? {
      selectDate: 'Selecione uma data para consultar a disponibilidade.',
      loading: 'Consultando a agenda do atelier...',
      empty: 'Não há horários disponíveis nesta data. Escolha outro dia.',
      loadError: 'Não foi possível consultar os horários. Tente novamente.',
      selectTime: 'Selecione um horário disponível para continuar.',
      selected: 'Horário selecionado. Preencha seus dados e confirme o agendamento.',
      submitting: 'Confirmando seu horário na agenda...',
      success: 'Seu atendimento foi confirmado na agenda do atelier.',
      unavailable: 'O agendamento online ainda não está configurado ou está temporariamente indisponível. Entre em contato com o atelier.',
      conflict: 'Esse horário acabou de ser reservado. Atualize os horários disponíveis e escolha outro.',
      submitError: 'Não foi possível confirmar o agendamento. Nenhuma confirmação foi emitida. Tente novamente ou entre em contato com o atelier.'
    } : {
      selectDate: 'Choose a date to check appointment availability.',
      loading: 'Checking the atelier calendar...',
      empty: 'No appointment times are available on this date. Please choose another day.',
      loadError: 'Could not load appointment times. Please try again.',
      selectTime: 'Choose an available appointment time to continue.',
      selected: 'Time selected. Complete your details and confirm your appointment.',
      submitting: 'Confirming your appointment in the atelier calendar...',
      success: 'Your fitting has been confirmed in the atelier calendar.',
      unavailable: 'Online booking is not configured yet or is temporarily unavailable. Please contact the atelier.',
      conflict: 'That time was just booked. Refresh availability and choose another time.',
      submitError: 'The appointment could not be confirmed. No confirmation was issued. Please try again or contact the atelier.'
    };
    let csrfToken = '';
    let selectedSlotStart = '';
    let submitting = false;
    let checkingAvailability = false;
    let idempotencyKey = '';
    let availabilityController;

    const setBookingStatus = (message, state) => {
      if (bookingStatus) {
        bookingStatus.textContent = message;
        bookingStatus.dataset.state = state || '';
      }
    };

    const updateSubmitButton = () => {
      if (submitButton) {
        submitButton.disabled = submitting || checkingAvailability || !csrfToken || !selectedSlotStart;
        submitButton.classList.toggle('is-loading', submitting);
      }
    };

    const newIdempotencyKey = () => {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    };

    const loadAvailability = async () => {
      const date = appointmentDate?.value;
      if (!date || !slotContainer || !apiUrl) {
        selectedSlotStart = '';
        checkingAvailability = false;
        slotContainer?.replaceChildren();
        updateSubmitButton();
        setBookingStatus(bookingText.selectDate, '');
        return;
      }

      if (availabilityController) {
        availabilityController.abort();
      }
      availabilityController = new AbortController();
      const previousSelection = selectedSlotStart;
      checkingAvailability = true;
      slotContainer.replaceChildren();
      updateSubmitButton();
      setBookingStatus(bookingText.loading, 'loading');

      try {
        const url = new URL(apiUrl, window.location.href);
        url.searchParams.set('action', 'availability');
        url.searchParams.set('date', date);
        const response = await fetch(url, {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          signal: availabilityController.signal
        });
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || 'availability_failed');
        }

        let selectionAvailable = false;
        result.slots.forEach((slot, index) => {
          const label = document.createElement('label');
          label.className = 'appointment-slot';
          const input = document.createElement('input');
          input.type = 'radio';
          input.name = 'appointment-slot';
          input.value = slot.start;
          input.required = index === 0;
          input.checked = slot.start === previousSelection;
          if (input.checked) selectionAvailable = true;
          const text = document.createElement('span');
          text.textContent = slot.label;
          label.append(input, text);
          slotContainer.append(label);
        });

        selectedSlotStart = selectionAvailable ? previousSelection : '';
        if (!selectionAvailable) idempotencyKey = '';
        checkingAvailability = false;
        updateSubmitButton();
        if (result.slots.length === 0) {
          setBookingStatus(bookingText.empty, 'notice');
        } else if (selectionAvailable) {
          setBookingStatus(bookingText.selected, 'notice');
        } else {
          setBookingStatus(bookingText.selectTime, 'notice');
        }
      } catch (error) {
        if (error.name === 'AbortError') return;
        selectedSlotStart = '';
        checkingAvailability = false;
        updateSubmitButton();
        setBookingStatus(error.message === 'booking_not_configured' ||
          error.message === 'calendar_not_connected' ||
          error.message === 'configuration_required'
          ? bookingText.unavailable
          : bookingText.loadError, 'error');
      }
    };

    const updateFittingMode = () => {
      const mode = bookingForm.querySelector('input[name="fitting-mode"]:checked')?.value;
      const isMobile = mode === 'mobile';
      if (offsiteFields) offsiteFields.hidden = !isMobile;
      if (fittingAddress) fittingAddress.required = isMobile;
      updateSubmitButton();
    };

    const getTodayInBrisbane = () => {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Australia/Brisbane',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(new Date());
      const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
      return `${values.year}-${values.month}-${values.day}`;
    };

    if (appointmentDate) {
      appointmentDate.min = getTodayInBrisbane();
      appointmentDate.addEventListener('change', loadAvailability);
    }

    refreshAvailabilityButton?.addEventListener('click', loadAvailability);
    bookingForm.querySelectorAll('input[name="fitting-mode"]').forEach(input => {
      input.addEventListener('change', updateFittingMode);
    });
    updateFittingMode();

    slotContainer?.addEventListener('change', event => {
      if (event.target.matches('input[name="appointment-slot"]')) {
        selectedSlotStart = event.target.value;
        idempotencyKey = '';
        setBookingStatus(bookingText.selected, 'notice');
        updateSubmitButton();
      }
    });

    if (apiUrl) {
      const csrfUrl = new URL(apiUrl, window.location.href);
      csrfUrl.searchParams.set('action', 'csrf');
      fetch(csrfUrl, { credentials: 'same-origin', cache: 'no-store' })
        .then(async response => {
          const result = await response.json();
          if (!response.ok || !result.csrfToken) {
            throw new Error(result.error || 'csrf_failed');
          }
          csrfToken = result.csrfToken;
          updateSubmitButton();
        })
        .catch(() => {
          setBookingStatus(bookingText.unavailable, 'error');
        });
    }

    window.setInterval(() => {
      if (appointmentDate?.value && !document.hidden && !submitting) {
        loadAvailability();
      }
    }, 60000);

    bookingForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const name = document.getElementById('full-name')?.value.trim();
      const email = document.getElementById('email')?.value.trim();
      const phone = document.getElementById('phone')?.value.trim();
      const service = document.getElementById('service-type')?.value;
      const mode = bookingForm.querySelector('input[name="fitting-mode"]:checked')?.value;

      if (!name || !email || !phone || !service || !appointmentDate?.value || !selectedSlotStart || !mode) {
        setBookingStatus(bookingText.selectTime, 'error');
        return;
      }

      if (mode === 'mobile' && !fittingAddress?.value.trim()) {
        fittingAddress?.focus();
        return;
      }

      if (!apiUrl || !csrfToken) {
        setBookingStatus(bookingText.unavailable, 'error');
        return;
      }

      submitting = true;
      idempotencyKey = idempotencyKey || newIdempotencyKey();
      updateSubmitButton();
      setBookingStatus(bookingText.submitting, 'loading');

      const requestUrl = new URL(apiUrl, window.location.href);
      requestUrl.searchParams.set('action', 'book');
      try {
        const response = await fetch(requestUrl, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            csrfToken,
            idempotencyKey,
            name,
            email,
            phone,
            service,
            mode,
            date: appointmentDate.value,
            slotStart: selectedSlotStart,
            eventDate: document.getElementById('event-date')?.value || '',
            address: fittingAddress?.value.trim() || '',
            message: document.getElementById('message')?.value.trim() || ''
          })
        });
        const result = await response.json();
        if (!response.ok) {
          if (response.status === 409) {
            selectedSlotStart = '';
            await loadAvailability();
            setBookingStatus(bookingText.conflict, 'error');
          } else if (response.status >= 500) {
            setBookingStatus(bookingText.unavailable, 'error');
          } else {
            setBookingStatus(bookingText.submitError, 'error');
          }
          return;
        }

        window.MMAnalytics?.trackBookingComplete(result.bookingId);
        if (modalClientName) modalClientName.textContent = name;
        if (confirmationMessage) confirmationMessage.textContent = bookingText.success;
        if (feedbackModal) {
          feedbackModal.classList.add('active');
          feedbackModal.setAttribute('aria-hidden', 'false');
          document.body.style.overflow = 'hidden';
        }
        bookingForm.reset();
        selectedSlotStart = '';
        idempotencyKey = '';
        csrfToken = result.csrfToken || csrfToken;
        slotContainer?.replaceChildren();
        appointmentDate.value = '';
        updateFittingMode();
        updateSubmitButton();
        setBookingStatus(bookingText.selectDate, '');
      } catch {
        setBookingStatus(bookingText.submitError, 'error');
      } finally {
        submitting = false;
        updateSubmitButton();
      }
    });
  }

  // Close Modal Event Listener
  if (closeModalBtn && feedbackModal) {
    closeModalBtn.addEventListener('click', () => {
      feedbackModal.classList.remove('active');
      feedbackModal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    });

    feedbackModal.addEventListener('click', (e) => {
      if (e.target === feedbackModal) {
        feedbackModal.classList.remove('active');
        feedbackModal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
      }
    });
  }

  /* ------------------------------------------------------------------------
     5. SMOOTH SCROLL FOR ALL INTERNAL ANCHOR LINKS
     ------------------------------------------------------------------------ */
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#') return;

      const targetSection = document.querySelector(targetId);
      if (targetSection) {
        e.preventDefault();
        const headerOffset = 80;
        const elementPosition = targetSection.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth'
        });
      }
    });
  });

  /* ------------------------------------------------------------------------
     6. FADE-IN SCROLL REVEAL ANIMATIONS (TOP LEVEL)
     ------------------------------------------------------------------------ */
  const revealElements = document.querySelectorAll('.reveal-on-scroll');

  if (revealElements.length > 0) {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('reveal-active');
          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.05,
      rootMargin: '0px 0px 50px 0px'
    });

    revealElements.forEach(el => revealObserver.observe(el));
  }

/* --------------------------------------------------------------------------
   7. INSTAGRAM GALLERY LIKE INTERACTION
   -------------------------------------------------------------------------- */
const instaCards = document.querySelectorAll('.instagram-card');

instaCards.forEach(card => {
  card.addEventListener('click', function(e) {
    e.preventDefault();
    this.classList.toggle('is-liked');
  });
});
/* =========================================
   8. HERO CAROUSEL AUTO-SLIDE
   ========================================= */
const carouselImages = document.querySelectorAll('#hero-carousel .carousel-img');
let currentImgIndex = 0;

if (carouselImages.length > 0) {
  setInterval(() => {
    carouselImages[currentImgIndex].classList.remove('active');
    
    currentImgIndex = (currentImgIndex + 1) % carouselImages.length;
    
    carouselImages[currentImgIndex].classList.add('active');
    
  }, 4000);
}
});


/* ==========================================================================
   TOGGLE DA GALERIA EXPANDÍVEL (SUPORTE PT / EN)
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  const expandBtn = document.getElementById('btn-expand-gallery');
  const collapseBtn = document.getElementById('btn-collapse-gallery');
  const expandableGallery = document.getElementById('gallery-more');
  const carouselPreview = document.getElementById('gallery-preview-carousel');

  // 1. Deteção automática do idioma lendo o <html lang="...">
  const currentLang = document.documentElement.lang || 'pt-BR';
  const isEnglish = currentLang.toLowerCase().includes('en');

  // 2. Definição dos textos com base no idioma
  const textView = isEnglish ? 'View in detail' : 'Ver Detalhes';
  const textClose = isEnglish ? 'Close details' : 'Ocultar Detalhes';

  const toggleGallery = (expand) => {
    if (!expandableGallery) return;

    if (expand) {
      // Oculta o carrossel e expande a Bento Grid
      if (carouselPreview) carouselPreview.classList.add('is-hidden');
      expandableGallery.classList.remove('is-collapsed');
      expandableGallery.classList.add('is-expanded');

      // Altera o texto do botão superior
      if (expandBtn) expandBtn.textContent = textClose;

      // Ativa as imagens
      const hiddenReveals = expandableGallery.querySelectorAll('.reveal-on-scroll');
      hiddenReveals.forEach(el => el.classList.add('reveal-active'));

    } else {
      // Localiza o bloco do título da galeria
      const galleryTitle = document.querySelector('.gallery-title-block');

      if (galleryTitle) {
        // Posição exata do título
        const headerOffset = 100;
        const elementPosition = galleryTitle.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

        // Rola INSTANTANEAMENTE para o título
        window.scrollTo({
          top: offsetPosition,
          behavior: 'instant'
        });
      }

      // Recolhe a Bento Grid, devolve o carrossel e restaura o texto do botão
      requestAnimationFrame(() => {
        expandableGallery.classList.remove('is-expanded');
        expandableGallery.classList.add('is-collapsed');

        if (carouselPreview) carouselPreview.classList.remove('is-hidden');
        
        // Restaura o texto original do botão superior
        if (expandBtn) expandBtn.textContent = textView;
      });
    }
  };

  if (expandBtn) {
    expandBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const isCurrentlyExpanded = expandableGallery.classList.contains('is-expanded');
      toggleGallery(!isCurrentlyExpanded);
    });
  }

  if (collapseBtn) {
    collapseBtn.addEventListener('click', (e) => {
      e.preventDefault();
      toggleGallery(false);
    });
  }
});