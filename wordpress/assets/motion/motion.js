/*
 * Scroll motion runtime for skill-built block themes — one self-wiring file.
 *
 * Detects which motion hooks the page actually uses and wires only those:
 *   .reveal-on-scroll          → adds .is-visible as each enters view (then unobserves)
 *   .counter[data-counter-*]   → counts up from 0 to data-counter-target on enter view
 *   header scroll              → toggles body.is-scrolled past 60px and
 *                                body.header-hidden while scrolling down past it
 *   <a href="#..."> + <section id> → toggles .is-active on the matching nav link
 *
 * Zero dependencies. Idempotent (guards against double-init). Bails entirely
 * under prefers-reduced-motion: reduce — motion.css's @media wrapper then keeps
 * every element in its final, fully-visible state, so nothing is hidden.
 *
 * Enqueue frontend-only from functions.php via wp_enqueue_scripts (in the footer).
 */
(function () {
    'use strict';

    if (window.__themeMotionInit) return;
    window.__themeMotionInit = true;

    function start() {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        var hasIO = typeof IntersectionObserver !== 'undefined';

        // A. Section reveal on enter view.
        var reveals = document.querySelectorAll('.reveal-on-scroll');
        if (reveals.length && hasIO) {
            var revealIO = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('is-visible');
                        revealIO.unobserve(entry.target);
                    }
                });
            }, { threshold: 0.12, rootMargin: '0px 0px -10% 0px' });
            reveals.forEach(function (el) { revealIO.observe(el); });
        }

        // E. Count-up stat numbers.
        var counters = document.querySelectorAll('.counter[data-counter-target]');
        if (counters.length && hasIO) {
            var countIO = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (!entry.isIntersecting) return;
                    runCounter(entry.target);
                    countIO.unobserve(entry.target);
                });
            }, { threshold: 0.5 });
            counters.forEach(function (el) { countIO.observe(el); });
        }

        // Header scroll states (is-scrolled past threshold, header-hidden on scroll-down).
        if (document.querySelector('.wp-site-blocks > header.wp-block-template-part')) {
            wireHeaderScroll();
        }

        // Active-anchor nav (landing-page in-page links).
        var anchorLinks = document.querySelectorAll('.wp-block-navigation a[href^="#"]');
        if (anchorLinks.length && hasIO) {
            wireActiveAnchor(anchorLinks);
        }
    }

    function runCounter(el) {
        var target = parseFloat(el.getAttribute('data-counter-target')) || 0;
        var suffix = el.getAttribute('data-counter-suffix') || '';
        var prefix = el.getAttribute('data-counter-prefix') || '';
        var duration = 1600;
        var startTime = null;
        function tick(now) {
            if (startTime === null) startTime = now;
            var p = Math.min((now - startTime) / duration, 1);
            var eased = 1 - Math.pow(1 - p, 3); // cubic ease-out
            var value = Math.round(target * eased);
            el.textContent = prefix + value.toLocaleString() + suffix;
            if (p < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }

    function wireHeaderScroll() {
        var threshold = 60;
        var lastY = window.pageYOffset;
        var ticking = false;
        function update() {
            var y = window.pageYOffset;
            document.body.classList.toggle('is-scrolled', y > threshold);
            if (y > threshold && y > lastY) {
                document.body.classList.add('header-hidden');
            } else {
                document.body.classList.remove('header-hidden');
            }
            lastY = y;
            ticking = false;
        }
        window.addEventListener('scroll', function () {
            if (!ticking) { requestAnimationFrame(update); ticking = true; }
        }, { passive: true });
        update();
    }

    function wireActiveAnchor(links) {
        var sections = [];
        links.forEach(function (link) {
            var id = link.getAttribute('href').slice(1);
            if (!id) return;
            var section = document.getElementById(id);
            if (section) sections.push({ link: link, section: section });
        });
        if (!sections.length) return;
        var anchorIO = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                var match = sections.filter(function (s) { return s.section === entry.target; })[0];
                if (match && entry.isIntersecting) {
                    sections.forEach(function (s) { s.link.classList.remove('is-active'); });
                    match.link.classList.add('is-active');
                }
            });
        }, { rootMargin: '-40% 0px -40% 0px' });
        sections.forEach(function (s) { anchorIO.observe(s.section); });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
