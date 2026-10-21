// The same page is the game and, opened from a room's QR code (?join=CODE),
// a phone controller. Each loads only its own code.
const join = new URLSearchParams(location.search).get('join');
if (join !== null) void import('./phone/controller').then((m) => m.startController(join));
else void import('./game');
