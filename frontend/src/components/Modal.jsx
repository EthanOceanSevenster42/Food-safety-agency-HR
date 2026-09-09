import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function Modal({
  title, onClose, children, footer,
  // Extra class on the modal card — e.g. "modal-wide" for data-heavy modals.
  cardClassName = '',
  // Set to false on modals that wrap a heavy editor (e.g. the SOW editor)
  // where an accidental backdrop click would drop unsaved work. The user
  // can still close via the × header button, the Close button in actions,
  // or — when `dismissOnEscape` is true — the Escape key.
  dismissOnBackdrop = true,
  dismissOnEscape   = true,
}) {
  // Track whether the *mousedown* happened on the overlay vs inside the card.
  // A click that starts inside the card but releases on the overlay should
  // NOT close the modal (e.g. dragging a selection or releasing after a
  // native file picker closes). This is the most common false-close cause.
  const downOnOverlayRef = useRef(false);

  useEffect(() => {
    if (!dismissOnEscape) return;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, dismissOnEscape]);

  function onOverlayMouseDown(e) {
    if (!dismissOnBackdrop) return;
    downOnOverlayRef.current = e.target === e.currentTarget;
  }

  function onOverlayClick(e) {
    if (!dismissOnBackdrop) return;
    // Only close when the entire click (down + up) happened on the overlay
    // backdrop itself, not on any child of the card.
    if (e.target === e.currentTarget && downOnOverlayRef.current) {
      onClose();
    }
    downOnOverlayRef.current = false;
  }

  // Render through a portal attached to document.body so the modal escapes
  // any CSS-transformed ancestor (e.g. the pan/zoom container on the
  // whiteboard). `position: fixed` is reinterpreted as `position: absolute`
  // when an ancestor has a transform, which previously collapsed modals
  // opened from inside the whiteboard down to a sliver.
  // React's synthetic events bubble through the React component tree, NOT
  // the DOM. So even though the portal moves this markup to <body>, a wheel
  // event inside the modal would still propagate up to whatever component
  // mounted us — for the whiteboard's modals, that's the canvas's onWheel
  // zoom handler. Stop wheel/touchmove at the overlay so scrolling inside
  // the modal doesn't pan/zoom the whiteboard underneath.
  function stopScrollPropagation(e) { e.stopPropagation(); }

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={onOverlayMouseDown}
      onClick={onOverlayClick}
      onWheel={stopScrollPropagation}
      onTouchMove={stopScrollPropagation}
    >
      <div className={'modal-card' + (cardClassName ? ' ' + cardClassName : '')}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
