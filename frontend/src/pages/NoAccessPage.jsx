// Shown to a standard account that has been granted no pages. They can still
// sign out (via the sidebar); an admin needs to grant them access.
export default function NoAccessPage() {
  return (
    <div className="page">
      <div className="empty-state" style={{ maxWidth: 520, margin: '80px auto', textAlign: 'center' }}>
        <h1 style={{ marginBottom: 8 }}>No pages assigned</h1>
        <p className="muted">
          Your account doesn’t have access to any pages yet. Please ask an
          administrator to grant you access from the Users page.
        </p>
      </div>
    </div>
  );
}
