// An in-app replacement for window.confirm / window.alert.
//
// The native dialogs are styled by the browser, sit outside the design, say
// "localhost:5173 says", and cannot express a destructive action. This renders
// a real dialog and resolves a promise, so call sites read almost the same:
//
//   if (!(await confirmDialog({ title: 'Delete this note?' }))) return;
//   await confirmDialog({ variant: 'alert', title: 'Not available here' });
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { setConfirmHandler } from '../confirm.js';

export default function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);
  const resolverRef = useRef(null);

  const ask = useCallback((opts = {}) => new Promise((resolve) => {
    resolverRef.current = resolve;
    setRequest({
      variant: 'confirm',      // 'confirm' | 'alert'
      tone: 'default',         // 'default' | 'danger'
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel',
      ...opts,
    });
  }), []);

  const settle = useCallback((value) => {
    setRequest(null);
    const resolve = resolverRef.current;
    resolverRef.current = null;
    if (resolve) resolve(value);
  }, []);

  // Register once so confirmDialog() anywhere in the app reaches this dialog.
  useEffect(() => {
    setConfirmHandler(ask);
    return () => setConfirmHandler(null);
  }, [ask]);

  return (
    <>
      {children}
      {request && <ConfirmDialog request={request} onSettle={settle} />}
    </>
  );
}

function ConfirmDialog({ request, onSettle }) {
  const { variant, tone, title, body, confirmLabel, cancelLabel } = request;
  const isAlert = variant === 'alert';
  const isDanger = tone === 'danger';
  const confirmRef = useRef(null);

  // The confirming action takes focus, so Enter resolves and Escape cancels
  // exactly the way the native dialog behaved.
  useEffect(() => {
    confirmRef.current?.focus();
    function onKey(e) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      // Capture phase plus stopImmediatePropagation: the modal underneath also
      // listens for Escape on document, and one press was closing both it and
      // this dialog. The topmost dialog consumes the key.
      e.stopImmediatePropagation();
      onSettle(false);
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onSettle]);

  return createPortal(
    <div
      className="confirm-overlay"
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onSettle(false); }}
    >
      <div
        className="confirm-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={body ? 'confirm-body' : undefined}
      >
        <div className={'confirm-icon' + (isDanger ? ' is-danger' : isAlert ? ' is-info' : '')}>
          <i
            className={isAlert ? 'fas fa-circle-info' : isDanger ? 'fas fa-triangle-exclamation' : 'fas fa-circle-question'}
            aria-hidden="true"
          />
        </div>

        <h2 className="confirm-title" id="confirm-title">{title}</h2>
        {body && <p className="confirm-body" id="confirm-body">{body}</p>}

        <div className="confirm-actions">
          {!isAlert && (
            <button type="button" className="aps-btn aps-btn--ghost" onClick={() => onSettle(false)}>
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            ref={confirmRef}
            className={'aps-btn ' + (isDanger ? 'aps-btn--danger-solid' : 'aps-btn--primary')}
            onClick={() => onSettle(true)}
          >
            {isAlert ? 'OK' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
