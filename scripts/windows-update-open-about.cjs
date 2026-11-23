// Preloaded by the disposable runner's packaged Next server. Direct only the
// browser's first document request to the public About page after the restart.
// Health probes, update downloads, and the native IPC bridge are untouched.
const { existsSync } = require('node:fs');
const { Server } = require('node:http');

const marker = process.env.NAVIGATOR_UPDATE_ABOUT_MARKER;
if (marker) {
  const emit = Server.prototype.emit;
  Server.prototype.emit = function (event, request, response, ...args) {
    if (event === 'request' && request.url === '/' &&
        request.headers['sec-fetch-mode'] === 'navigate' && existsSync(marker)) {
      response.writeHead(302, { Location: '/settings/about', 'Cache-Control': 'no-store' });
      response.end();
      return true;
    }
    return emit.call(this, event, request, response, ...args);
  };
}
