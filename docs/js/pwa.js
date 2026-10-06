// Registers the service worker (offline play + instant reloads) when served
// over http(s). Skipped on file:// where service workers are unavailable.
// Also skipped inside the Android app (Capacitor), which ships every file.
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.Capacitor) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.info('[PWA] SW registration failed:', err));
  });
}
