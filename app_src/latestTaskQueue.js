// Run one host operation at a time and keep only the latest queued request.
export const createLatestTaskQueue = (run) => {
  let active = null;
  let next = null;
  const start = (task) => {
    active = task;
    let finished = false;
    const finish = (result) => {
      // A runner that calls done twice, or throws after calling it, must not
      // finish the task twice or start the next one twice.
      if (finished) return;
      finished = true;
      const superseded = !!next;
      try { task.callback({ ...result, superseded }); }
      finally {
        active = null;
        if (next) { const taskToRun = next; next = null; start(taskToRun); }
      }
    };
    try { run(task.value, finish); }
    catch (error) { finish({ ok: false, error: String((error && error.message) || error) }); }
  };
  return (value, callback) => {
    const task = { value, callback };
    if (!active) { start(task); return; }
    if (next) next.callback({ ok: false, superseded: true });
    next = task;
  };
};
