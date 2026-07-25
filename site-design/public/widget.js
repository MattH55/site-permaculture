/**
 * Expanding Edge recommendation widget — drop-in for expandingedge.ca
 *
 * Usage:
 *   <div id="ee-rec-widget"></div>
 *   <script
 *     src="https://site-permaculture.onrender.com/widget.js"
 *     data-ee-widget
 *     data-target="#ee-rec-widget"
 *     data-preset="sturgeon"
 *     data-height="720"
 *     async></script>
 *
 * Or auto-mount on any [data-ee-recommendations] element.
 */
(function () {
  'use strict';

  var script =
    document.currentScript ||
    document.querySelector('script[data-ee-widget][src*="widget.js"]');

  function attr(name, fallback) {
    if (!script) return fallback;
    var v = script.getAttribute(name);
    return v == null || v === '' ? fallback : v;
  }

  function baseUrl() {
    if (script && script.src) {
      try {
        var u = new URL(script.src);
        return u.origin;
      } catch (e) { /* fall through */ }
    }
    return 'https://site-permaculture.onrender.com';
  }

  function mount(el, opts) {
    if (!el || el.getAttribute('data-ee-mounted') === '1') return;
    el.setAttribute('data-ee-mounted', '1');

    var base = opts.base || baseUrl();
    var preset = opts.preset || 'sturgeon';
    var height = opts.height || '720';
    var ha = opts.ha || '';
    var autorun = opts.autorun !== false && opts.autorun !== '0';

    var qs = new URLSearchParams();
    if (preset) qs.set('preset', preset);
    if (ha) qs.set('ha', ha);
    if (autorun) qs.set('autorun', '1');
    if (opts.theme) qs.set('theme', opts.theme);

    var iframe = document.createElement('iframe');
    iframe.src = base.replace(/\/$/, '') + '/embed?' + qs.toString();
    iframe.title = 'Expanding Edge site recommendations';
    iframe.loading = 'lazy';
    iframe.style.cssText =
      'width:100%;max-width:560px;height:' +
      (String(height).match(/px|%|vh/) ? height : height + 'px') +
      ';border:1px solid #d9cfc4;border-radius:10px;background:#f7f2eb;display:block;margin:0 auto;';
    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    iframe.setAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox'
    );

    // Optional heading
    if (opts.heading !== '0') {
      var h = document.createElement('div');
      h.style.cssText =
        'font-family:Georgia,serif;font-size:1.15rem;margin:0 0 0.5rem;color:#1c1410;text-align:center';
      h.textContent =
        opts.heading || 'What does your Alberta parcel need?';
      el.appendChild(h);
    }

    el.appendChild(iframe);

    var foot = document.createElement('p');
    foot.style.cssText =
      'font-family:system-ui,sans-serif;font-size:0.75rem;color:#5c5048;text-align:center;margin:0.5rem 0 0';
    foot.innerHTML =
      'Powered by <a href="https://www.expandingedge.ca/" target="_blank" rel="noopener" style="color:#5b3a73">Expanding Edge</a> · ' +
      '<a href="' +
      base.replace(/\/$/, '') +
      '/" target="_blank" rel="noopener" style="color:#5b3a73">Full map tool</a>';
    el.appendChild(foot);
  }

  function boot() {
    var base = baseUrl();
    var targetSel = attr('data-target', '');
    var defaults = {
      base: base,
      preset: attr('data-preset', 'sturgeon'),
      height: attr('data-height', '720'),
      ha: attr('data-ha', ''),
      autorun: attr('data-autorun', '1'),
      heading: attr('data-heading', ''),
      theme: attr('data-theme', ''),
    };

    if (targetSel) {
      var t = document.querySelector(targetSel);
      if (t) mount(t, defaults);
    }

    document.querySelectorAll('[data-ee-recommendations]').forEach(function (el) {
      mount(el, {
        base: base,
        preset: el.getAttribute('data-preset') || defaults.preset,
        height: el.getAttribute('data-height') || defaults.height,
        ha: el.getAttribute('data-ha') || defaults.ha,
        autorun: el.getAttribute('data-autorun') || defaults.autorun,
        heading: el.getAttribute('data-heading') || defaults.heading,
        theme: el.getAttribute('data-theme') || defaults.theme,
      });
    });

    // Global helper for WP / custom pages
    window.ExpandingEdgeRecommendations = {
      mount: mount,
      baseUrl: baseUrl,
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
