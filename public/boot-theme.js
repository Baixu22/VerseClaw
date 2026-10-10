(() => {
  const params = new URLSearchParams(window.location.search);
  const requestedTheme = params.get("bootTheme");
  const theme = requestedTheme === "dark" || requestedTheme === "light"
    ? requestedTheme
    : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  const platform = /Macintosh|Mac OS X/.test(navigator.userAgent) ? "mac" : "desktop";
  document.documentElement.classList.add(theme);
  document.documentElement.dataset.bootTheme = theme;
  document.documentElement.dataset.bootPlatform = platform;
  document.documentElement.dataset.bootStartedAt = String(performance.now());
})();