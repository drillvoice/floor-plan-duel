// The same page is the game and, opened from a room's QR code (?join=CODE),
// a phone controller. Each loads only its own code.
const join = new URLSearchParams(location.search).get('join');
if (join !== null) void import('./phone/controller').then((m) => m.startController(join));
else void import('./game');

// Offline support in production builds (the dev server stays uncached). This
// has to be here: the game loads after the page has, so a 'load' listener in
// game.ts would never fire.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // Offline play just won't be available.
    });
  });
}
