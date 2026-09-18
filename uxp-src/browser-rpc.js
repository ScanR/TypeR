let serial = 0;
const pending = new Map();
export function showError(error) {
  let notice = document.getElementById('typer-error');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'typer-error';
    notice.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;padding:12px;background:#642d26;color:white;cursor:pointer';
    notice.title = 'Cliquer pour fermer';
    notice.onclick = () => notice.remove();
    document.body.appendChild(notice);
  }
  notice.textContent = error.message || String(error);
  console.error(error);
}

window.addEventListener('message', event => {
  if (event.source !== window.uxpHost) return;
  const data = event.data;
  if (!data || data.channel !== 'typer-uxp' || !pending.has(data.id)) return;
  const task = pending.get(data.id);
  pending.delete(data.id);
  clearTimeout(task.timeout);
  if (data.error) task.reject(new Error(data.error));
  else task.resolve(data.result);
});

export function request(method, ...args) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Photoshop ne répond pas. Vérifiez qu’aucune boîte de dialogue ne bloque TypeR.')); }, 120000);
    pending.set(id, {resolve, reject, timeout});
    window.uxpHost.postMessage({channel: 'typer-uxp', id, method, args});
  });
}
