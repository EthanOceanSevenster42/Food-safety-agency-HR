// Shown at the top of a page when the signed-in account has View (read-only)
// access to that area — all editing controls on the page are hidden.
export default function ReadOnlyBanner({ label = 'this page' }) {
  return (
    <div className="readonly-banner" role="status">
      <span className="readonly-banner-icon" aria-hidden>👁</span>
      <span>View-only access — you can browse {label} but not make changes.</span>
    </div>
  );
}
