// Run one host operation at a time and keep only the latest queued request.
export const createLatestTaskQueue = (run) => {
  let active = null;
  let next = null;
  const start = (task) => {
    active = task;
    run(task.value, (result) => {
      const superseded = !!next;
      try { task.callback({ ...result, superseded }); }
      finally {
        active = null;
        if (next) { const taskToRun = next; next = null; start(taskToRun); }
      }
    });
  };
  return (value, callback) => {
    const task = { value, callback };
    if (!active) { start(task); return; }
    if (next) next.callback({ ok: false, superseded: true });
    next = task;
  };
};
