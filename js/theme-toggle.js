// Dark mode toggle with localStorage persistence
(function () {
	var toggle = document.getElementById('theme-toggle');
	if (!toggle) return;

	var STORAGE_KEY = 'theme';
	var DARK = 'dark';
	var LIGHT = 'light';

	function getPreferred() {
		var stored = localStorage.getItem(STORAGE_KEY);
		if (stored) return stored;
		return window.matchMedia('(prefers-color-scheme: dark)').matches ? DARK : LIGHT;
	}

	function apply(theme) {
		if (theme === DARK) {
			document.documentElement.setAttribute('data-theme', 'dark');
			toggle.textContent = '\u2600\uFE0F';
			toggle.setAttribute('aria-label', 'Switch to light mode');
		} else {
			document.documentElement.removeAttribute('data-theme');
			toggle.textContent = '\uD83C\uDF19';
			toggle.setAttribute('aria-label', 'Switch to dark mode');
		}
	}

	// Apply on load
	apply(getPreferred());

	toggle.addEventListener('click', function () {
		var current = document.documentElement.getAttribute('data-theme') === 'dark' ? DARK : LIGHT;
		var next = current === DARK ? LIGHT : DARK;
		localStorage.setItem(STORAGE_KEY, next);
		apply(next);
	});
})();
