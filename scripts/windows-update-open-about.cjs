// Only the Actions test enables the loopback WebView2 debugging endpoint.
// Navigate to the public About route in the installed app's own WebView.
async function main() {
  let page;
  let reason;
  for (let attempt = 0; attempt < 12 && !page; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:9222/json/list', { signal: AbortSignal.timeout(1500) });
      const targets = await response.json();
      page = targets.find(item => item.type === 'page' && item.url.startsWith('http://127.0.0.1:37371/'));
      reason = page ? undefined : 'Navigator WebView was absent from the target list';
    } catch (error) {
      reason = error.cause?.message || error.message;
    }
    if (!page) await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!page) throw Error(reason);
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
