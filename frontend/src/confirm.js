// Imperative confirm/alert, replacing window.confirm and window.alert.
//
// Deliberately not a hook: the calls it replaces are scattered through event
// handlers and nested components, and a hook would mean threading a value into
// thirteen files. ConfirmProvider registers the real implementation once at
// mount; until then (and in tests) this falls back to the native dialog rather
// than silently returning false and swallowing a destructive action.
//
//   if (!(await confirmDialog({ title: 'Delete this note?', tone: 'danger',
//                               confirmLabel: 'Delete' }))) return;
//   await confirmDialog({ variant: 'alert', title: 'Not available here' });

let handler = null;

export function setConfirmHandler(fn) {
  handler = fn;
}

export function confirmDialog(opts = {}) {
  if (handler) return handler(opts);

  const text = [opts.title, opts.body].filter(Boolean).join('\n\n');
  if (opts.variant === 'alert') {
    window.alert(text);
    return Promise.resolve(true);
  }
  return Promise.resolve(window.confirm(text));
}
