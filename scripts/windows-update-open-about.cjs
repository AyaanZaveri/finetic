// Only the Actions test enables the loopback WebView2 debugging endpoint.
// Navigate to the public About route in the installed app's own WebView.
async function main() {
  const response = await fetch('http://127.0.0.1:9222/json/list', { signal: AbortSignal.timeout(3000) });
  const targets = await response.json();
  const page = targets.find(item => item.type === 'page' && item.url.startsWith('http://127.0.0.1:37371/'));
  if (!page) throw Error('Navigator WebView is not ready');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  const timeout = setTimeout(() => { console.error('WebView did not confirm navigation'); process.exit(1); }, 3000);
  socket.addEventListener('open', () => socket.send(JSON.stringify({
    id: 1, method: 'Page.navigate', params: { url: 'http://127.0.0.1:37371/settings/about' },
  })));
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id !== 1) return;
    if (message.error || message.result?.errorText) {
      console.error(message.error || message.result.errorText);
      process.exitCode = 1;
    }
    clearTimeout(timeout);
    socket.close();
  });
  socket.addEventListener('error', () => { throw Error('Could not connect to Navigator WebView'); });
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
