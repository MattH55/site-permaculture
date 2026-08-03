// Expanding Edge Permaculture — Interactive Features

// Mobile Menu Toggle
function initMobileMenu() {
  const header = document.querySelector('.site-header');
  const nav = document.querySelector('.nav-main');

  if (!header || !nav) return;

  // Create hamburger button if on mobile
  if (window.innerWidth <= 768 && !document.querySelector('.hamburger')) {
    const hamburger = document.createElement('button');
    hamburger.className = 'hamburger';
    hamburger.innerHTML = '☰';
    hamburger.setAttribute('aria-label', 'Toggle menu');

    header.querySelector('.inner').appendChild(hamburger);

    hamburger.addEventListener('click', () => {
      nav.classList.toggle('active');
      hamburger.classList.toggle('active');
    });
  }

  // Close menu on link click
  document.querySelectorAll('.nav-main a').forEach(link => {
    link.addEventListener('click', () => {
      nav.classList.remove('active');
      document.querySelector('.hamburger')?.classList.remove('active');
    });
  });
}

// Smooth Scroll to Anchor
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const href = this.getAttribute('href');
      if (href === '#') return;

      e.preventDefault();
      const target = document.querySelector(href);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
}

// Scroll Animations - Fade in elements as they come into view
function initScrollAnimations() {
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('fade-in');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  // Observe cards, steps, benefits
  document.querySelectorAll('.service-card, .step, .benefit, .feature-box, .faq-item').forEach(el => {
    el.classList.add('fade-on-scroll');
    observer.observe(el);
  });
}

// Form Handling - Enhanced with validation
function initFormHandling() {
  const contactForm = document.getElementById('contact-form');
  if (!contactForm) return;

  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const form = e.target;
    const btn = form.querySelector('button[type="submit"]');
    const statusDiv = document.getElementById('form-status');

    // Basic validation
    const email = document.getElementById('email').value.trim();
    const name = document.getElementById('name').value.trim();

    if (!name) {
      statusDiv.className = 'form-status error';
      statusDiv.textContent = 'Please enter your name';
      return;
    }

    if (!email || !email.includes('@')) {
      statusDiv.className = 'form-status error';
      statusDiv.textContent = 'Please enter a valid email';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Sending...';
    statusDiv.textContent = '';

    try {
      const response = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: document.getElementById('name').value,
          email: document.getElementById('email').value,
          phone: document.getElementById('phone').value,
          location: document.getElementById('location')?.value || '',
          property_type: document.getElementById('property-type')?.value || '',
          interest: document.getElementById('interest')?.value || '',
          message: document.getElementById('message')?.value || '',
        })
      });

      if (response.ok) {
        statusDiv.className = 'form-status success';
        statusDiv.textContent = 'Thank you! We\'ll be in touch within 24 hours.';
        form.reset();

        // Reset button after 3 seconds
        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = 'Send Message';
        }, 3000);
      } else {
        const data = await response.json();
        statusDiv.className = 'form-status error';
        statusDiv.textContent = data.error || 'Something went wrong. Please try again.';
        btn.disabled = false;
        btn.textContent = 'Send Message';
      }
    } catch (error) {
      statusDiv.className = 'form-status error';
      statusDiv.textContent = 'Network error. Please try again or call us at (780) 236-3630';
      btn.disabled = false;
      btn.textContent = 'Send Message';
    }
  });
}

// Scroll to Top Button
function initScrollToTop() {
  let scrollBtn = document.querySelector('.scroll-to-top');
  if (!scrollBtn) {
    scrollBtn = document.createElement('button');
    scrollBtn.className = 'scroll-to-top';
    scrollBtn.innerHTML = '↑';
    scrollBtn.setAttribute('aria-label', 'Scroll to top');
    document.body.appendChild(scrollBtn);
  }

  window.addEventListener('scroll', () => {
    if (window.scrollY > 300) {
      scrollBtn.classList.add('visible');
    } else {
      scrollBtn.classList.remove('visible');
    }
  });

  scrollBtn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// Service Cards - Hover effect with flip animation
function initServiceCards() {
  document.querySelectorAll('.service-card').forEach(card => {
    card.addEventListener('mouseenter', function() {
      this.style.transform = 'translateY(-8px) scale(1.02)';
    });

    card.addEventListener('mouseleave', function() {
      this.style.transform = 'translateY(0) scale(1)';
    });
  });
}

// Accordion for FAQ (if present)
function initAccordion() {
  document.querySelectorAll('.faq-item h3').forEach(heading => {
    heading.style.cursor = 'pointer';
    heading.addEventListener('click', function() {
      const item = this.closest('.faq-item');
      const para = item.querySelector('p');

      para.style.maxHeight = para.style.maxHeight ? null : (para.scrollHeight + 'px');
      item.classList.toggle('expanded');
    });
  });
}

// Counter Animation (if any numbers are present)
function animateCounters() {
  const counters = document.querySelectorAll('[data-count]');
  if (counters.length === 0) return;

  const observerOptions = { threshold: 0.5 };

  const counterObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !entry.target.dataset.animated) {
        entry.target.dataset.animated = 'true';
        const target = parseInt(entry.target.dataset.count);
        const duration = 2000;
        const increment = target / (duration / 50);
        let current = 0;

        const timer = setInterval(() => {
          current += increment;
          if (current >= target) {
            entry.target.textContent = target;
            clearInterval(timer);
          } else {
            entry.target.textContent = Math.floor(current);
          }
        }, 50);

        counterObserver.unobserve(entry.target);
      }
    });
  }, observerOptions);

  counters.forEach(counter => counterObserver.observe(counter));
}

// Page Load Animations
function initPageLoadAnimation() {
  document.body.style.opacity = '0';
  window.addEventListener('load', () => {
    setTimeout(() => {
      document.body.style.transition = 'opacity 0.6s ease-in';
      document.body.style.opacity = '1';
    }, 100);
  });
}

// Active Navigation Link
function updateActiveNav() {
  const currentPath = window.location.pathname;
  document.querySelectorAll('.nav-main a').forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPath || (href === '/' && currentPath === '/index.html')) {
      link.style.borderBottomColor = 'var(--berry)';
      link.style.color = 'var(--berry)';
    } else {
      link.style.borderBottomColor = 'transparent';
      link.style.color = 'inherit';
    }
  });
}

// Initialize all features when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initPageLoadAnimation();
  initMobileMenu();
  initSmoothScroll();
  initScrollAnimations();
  initFormHandling();
  initScrollToTop();
  initServiceCards();
  initAccordion();
  animateCounters();
  updateActiveNav();

  // Re-init mobile menu on resize
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      document.querySelector('.nav-main')?.classList.remove('active');
      document.querySelector('.hamburger')?.classList.remove('active');
    }
  });
});
