// Scroll-reveal: adds .visible to .fade-in elements when they enter the viewport
(function () {
	const targets = document.querySelectorAll('.fade-in');
	if (!targets.length) return;

	// Respect reduced-motion preference
	if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
		targets.forEach(function (el) { el.classList.add('visible'); });
		return;
	}

	var observer = new IntersectionObserver(function (entries) {
		entries.forEach(function (entry) {
			if (entry.isIntersecting) {
				entry.target.classList.add('visible');
				observer.unobserve(entry.target);
			}
		});
	}, {
		threshold: 0.12,
		rootMargin: '0px 0px -40px 0px'
	});

	targets.forEach(function (el) { observer.observe(el); });
})();
