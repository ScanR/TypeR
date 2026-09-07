// Bound the complete request, including body consumption, even without AbortController.
export const fetchBody = (url, options = {}, body = 'json', timeout = 20000, fetchImpl = fetch) => new Promise((resolve, reject) => {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => {
    if (controller) controller.abort();
    reject(new Error('requestTimeout'));
  }, timeout);
  const settings = controller && !options.signal ? { ...options, signal: controller.signal } : options;
  Promise.resolve().then(() => fetchImpl(url, settings)).then(response => {
    if (!response.ok) {
      const error = new Error(response.status === 429 ? 'rateLimited' : 'requestFailed');
      error.status = response.status;
      throw error;
    }
    return response[body]();
  }).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
});
