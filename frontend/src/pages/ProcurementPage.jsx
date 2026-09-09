import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { auth } from '../auth.js';
import { canEdit as canEditSeg } from '../roles.js';
import CompanyGrid from '../components/CompanyGrid.jsx';
import CompanyModal from '../components/CompanyModal.jsx';
import ProjectModal from '../components/ProjectModal.jsx';
import SowTemplateLibrary from '../components/SowTemplateLibrary.jsx';
import Whiteboard from '../components/Whiteboard.jsx';
import ReadOnlyBanner from '../components/ReadOnlyBanner.jsx';
import { confirmDialog } from '../confirm.js';
import useAutoSelectCompany from '../useAutoSelectCompany.js';

function fmtDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString();
}

/**
 * The Procurement and Human Resources pages are both backed by this
 * component — they show the same company grid, project list, and
 * whiteboard, but each route passes a different `department` so the
 * project / task data is partitioned. Templates and company branding
 * are still shared across workspaces (a template authored under HR can
 * still be picked when creating a Procurement task — they live at the
 * company level).
 */
export default function ProcurementPage({ department = 'Procurement', pageLabel = 'Procurement Process', segment = 'procurement' }) {
  const me = auth.getUser();
  const canEdit = canEditSeg(me, segment);
  const canEditCompanies = canEditSeg(me, 'companies');
  const [companies, setCompanies] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  // One company means nothing to choose — go straight in.
  useAutoSelectCompany(companies, selectedId, setSelectedId);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [companyModal, setCompanyModal] = useState(null);
  const [projectModal, setProjectModal] = useState(null);
  const [whiteboardProject, setWhiteboardProject] = useState(null);
  const [templateLibrary, setTemplateLibrary] = useState(false);
  // 'active' shows in-progress projects (default landing tab),
  // 'completed' is the "done" bucket. Toggled via the tab strip on
  // the company-detail view.
  const [projectStatus, setProjectStatus] = useState('active');

  const selectedCompany = companies.find((c) => c.id === selectedId) || null;

  async function loadCompanies({ silent = false } = {}) {
    if (!silent) setLoading(true);
    setError('');
    try {
      setCompanies(await api.listCompanies());
    } catch (err) {
      setError(err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function loadProjects(companyId, status = projectStatus) {
    if (!companyId) { setProjects([]); return; }
    try {
      setProjects(await api.listProjects(companyId, status, department));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { loadCompanies(); }, []);
  // Reload when the selected company, status filter, or department
  // changes (the latter only happens on route swap but it's cheap to
  // include in the dep list).
  useEffect(() => { loadProjects(selectedId); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [selectedId, projectStatus, department]);

  async function toggleProjectComplete(p) {
    try {
      const updated = p.completedAt
        ? await api.reopenProject(p.id)
        : await api.completeProject(p.id);
      // Filter the project out of the current view if its status no
      // longer matches the active tab; otherwise patch it in place.
      setProjects((prev) => {
        const matchesTab = projectStatus === 'all'
          || (projectStatus === 'active'    && !updated.completedAt)
          || (projectStatus === 'completed' &&  updated.completedAt);
        if (!matchesTab) return prev.filter((x) => x.id !== updated.id);
        return prev.map((x) => (x.id === updated.id ? updated : x));
      });
    } catch (err) {
      setError(err.message);
    }
  }

  // Re-fetch when the user comes back to this tab so changes from
  // Asset Control flow through immediately. Suppressed while any modal is
  // open — otherwise the OS file picker closing fires a window focus event,
  // which races with the modal's state and silently breaks uploads. The
  // refresh is also `silent` (no global loading splash) so it can never
  // unmount an open modal: switching tabs used to flip `loading: true`,
  // which short-circuited the whole page to a loader and lost the
  // template-creation editor's internal state.
  useEffect(() => {
    function onFocus() {
      if (companyModal || projectModal || whiteboardProject || templateLibrary) return;
      loadCompanies({ silent: true });
      if (selectedId) loadProjects(selectedId);
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [selectedId, companyModal, projectModal, whiteboardProject, templateLibrary]);

  async function handleSaveCompany(form) {
    if (companyModal.mode === 'edit') {
      await api.updateCompany(companyModal.company.id, form);
    } else {
      await api.createCompany(form);
    }
    await loadCompanies();
    setCompanyModal(null);
  }

  async function handleDeleteCompany(company = selectedCompany) {
    if (!company) return;
    if (!(await confirmDialog({
      title: `Delete "${company.name}"?`,
      body: 'Every employee, asset and project on this company is deleted with it. This cannot be undone.',
      tone: 'danger',
      confirmLabel: 'Delete company',
    }))) return;
    try {
      await api.deleteCompany(company.id);
      if (selectedId === company.id) setSelectedId(null);
      await loadCompanies();
    } catch (e) { setError(e.message); }
  }

  async function handleSaveProject(form) {
    if (projectModal.mode === 'edit') {
      await api.updateProject(projectModal.project.id, form);
    } else {
      await api.createProject({ companyId: selectedId, department, ...form });
    }
    setProjectModal(null);
    await loadProjects(selectedId);
  }

  async function handleDeleteProject() {
    await api.deleteProject(projectModal.project.id);
    setProjectModal(null);
    await loadProjects(selectedId);
  }

  if (loading) return <div className="page"><div className="muted">Loading…</div></div>;

  // ----- Whiteboard view (a project is open) -----
  if (whiteboardProject) {
    const base = projects.find((p) => p.id === whiteboardProject.id) || whiteboardProject;
    const ownerCompany = companies.find((c) => c.id === base.companyId);
    const liveProject = { ...base, companyName: ownerCompany?.name || '' };
    return (
      <>
        <Whiteboard
          project={liveProject}
          department={department}
          readOnly={!canEdit}
          onClose={() => setWhiteboardProject(null)}
          onEditProject={() => setProjectModal({ mode: 'edit', project: liveProject })}
        />
        {projectModal && (
          <ProjectModal
            mode={projectModal.mode}
            project={projectModal.project}
            onClose={() => setProjectModal(null)}
            onSave={async (form) => {
              await handleSaveProject(form);
              // Keep the whiteboard open after edit
              setWhiteboardProject(null);
              setTimeout(() => {
                const refreshed = projects.find((p) => p.id === liveProject.id);
                if (refreshed) setWhiteboardProject(refreshed);
              }, 0);
            }}
            onDelete={projectModal.mode === 'edit' ? async () => {
              await handleDeleteProject();
              setWhiteboardProject(null);
            } : undefined}
          />
        )}
      </>
    );
  }

  // ----- Company drill-down view (projects) -----
  if (selectedCompany) {
    const brandStyle = selectedCompany.brandColor ? { '--co-brand': selectedCompany.brandColor } : undefined;
    return (
      <div className="page procurement-page" style={brandStyle} data-brand={selectedCompany.brandColor || undefined}>
        {/* The back link, the company header and the Active/Completed strip
            used to be three separate horizontal bands stacked above the
            content, so a page with one project began 290px down. They are one
            header row now. */}
        <header className="page-header company-header">
          <div className="company-detail-head">
            <button
              type="button"
              className="company-back"
              onClick={() => setSelectedId(null)}
              title="All companies"
              aria-label="Back to all companies"
            >
              <i className="fas fa-arrow-left" aria-hidden="true" />
            </button>
            {canEditCompanies ? (
              <button
                type="button"
                className="logo-edit-trigger"
                onClick={() => setCompanyModal({ mode: 'edit', company: selectedCompany })}
                title="Edit company branding"
                aria-label="Edit company branding"
              >
                {selectedCompany.logoUrl ? (
                  <img className="company-logo-lg" src={selectedCompany.logoUrl} alt={selectedCompany.name} />
                ) : (
                  <div className="company-logo-lg company-logo-placeholder">
                    {selectedCompany.name.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <span className="logo-edit-overlay" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                </span>
              </button>
            ) : (
              selectedCompany.logoUrl ? (
                <img className="company-logo-lg" src={selectedCompany.logoUrl} alt={selectedCompany.name} />
              ) : (
                <div className="company-logo-lg company-logo-placeholder">{selectedCompany.name.slice(0, 2).toUpperCase()}</div>
              )
            )}
            <div>
              <h1>{selectedCompany.name}</h1>
              <p className="muted">{projects.length} project{projects.length === 1 ? '' : 's'}</p>
            </div>
          </div>
          <div className="page-header-actions">
            <button className="btn-ghost" onClick={() => setTemplateLibrary(true)}>
              Task templates
            </button>
            {canEdit && (
              <button className="btn-primary" onClick={() => setProjectModal({ mode: 'create' })}>
                + New project
              </button>
            )}
            {/* Destructive, so it is a ghost button rather than a solid one —
                secondary to "+ New project" without becoming an unreadable
                grey text link on the photographic ground. */}
            {canEditCompanies && (
              <button
                className="btn-ghost danger"
                onClick={() => handleDeleteCompany(selectedCompany)}
                title={`Delete ${selectedCompany.name} and everything on it`}
              >
                Delete company
              </button>
            )}
          </div>
        </header>

        {!canEdit && <ReadOnlyBanner label="Procurement" />}
        {error && <div className="error">{error}</div>}

        {/* Active / Completed bucket tabs. The page-header keeps the
            same "+ New project" button; this strip just switches what
            the grid below shows. */}
        <div className="project-tabs" role="tablist" aria-label="Project status filter">
          <button
            type="button"
            role="tab"
            aria-selected={projectStatus === 'active'}
            className={'project-tab' + (projectStatus === 'active' ? ' is-active' : '')}
            onClick={() => setProjectStatus('active')}
          >Active</button>
          <button
            type="button"
            role="tab"
            aria-selected={projectStatus === 'completed'}
            className={'project-tab' + (projectStatus === 'completed' ? ' is-active' : '')}
            onClick={() => setProjectStatus('completed')}
          >Completed</button>
        </div>

        {projects.length === 0 ? (
          <div className="empty-state">
            {projectStatus === 'completed' ? (
              <p>No completed projects yet.</p>
            ) : (
              <>
                <p>No projects for {selectedCompany.name} yet.</p>
                {canEdit && (
                  <button className="btn-primary" onClick={() => setProjectModal({ mode: 'create' })}>
                    Create the first project
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <ul className="project-grid">
            {projects.map((p) => {
              const done = !!p.completedAt;
              return (
                <li
                  key={p.id}
                  className={'project-card' + (done ? ' project-card-done' : '')}
                  style={{ '--proj-color': p.color || 'var(--brand-teal)' }}
                  onClick={() => setWhiteboardProject(p)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') setWhiteboardProject(p); }}
                >
                  <span className="project-card-stripe" aria-hidden />
                  <div className="project-card-body">
                    <div className="project-card-head-row">
                      <div className="project-card-name">{p.name}</div>
                      {canEdit && (
                        <div className="project-card-actions">
                          <button
                            type="button"
                            className="project-card-edit"
                            onClick={(e) => { e.stopPropagation(); toggleProjectComplete(p); }}
                            title={done ? 'Reopen this project' : 'Mark this project as complete'}
                            aria-label={done ? 'Reopen project' : 'Complete project'}
                          >
                            {done ? '↺' : '✓'}
                          </button>
                          <button
                            type="button"
                            className="project-card-edit"
                            onClick={(e) => { e.stopPropagation(); setProjectModal({ mode: 'edit', project: p }); }}
                            title="Edit project details"
                            aria-label="Edit project details"
                          >
                            ✎
                          </button>
                        </div>
                      )}
                    </div>
                    {done && (
                      <div className="project-card-badge">Completed {fmtDate(p.completedAt)}</div>
                    )}
                    {p.description && <p className="project-card-desc">{p.description}</p>}
                    <div className="project-card-foot muted small">
                      Created {fmtDate(p.createdAt)}
                      {p.createdBy && <> · by <strong>{p.createdBy}</strong></>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {companyModal && (
          <CompanyModal
            mode={companyModal.mode}
            company={companyModal.company}
            onClose={() => setCompanyModal(null)}
            onSave={handleSaveCompany}
          />
        )}
        {projectModal && (
          <ProjectModal
            mode={projectModal.mode}
            project={projectModal.project}
            onClose={() => setProjectModal(null)}
            onSave={handleSaveProject}
            onDelete={projectModal.mode === 'edit' ? handleDeleteProject : undefined}
          />
        )}
        {templateLibrary && (
          <SowTemplateLibrary
            company={selectedCompany}
            allCompanies={companies}
            department={department}
            readOnly={!canEdit}
            onClose={() => setTemplateLibrary(false)}
          />
        )}
      </div>
    );
  }

  // ----- Company grid -----
  return (
    <div className="page procurement-page">
      <header className="page-header">
        <div>
          <h1>{pageLabel}</h1>
          <p className="muted">
            Manage the companies you work with and track {department === 'Human Resources' ? 'HR' : 'procurement'} projects within each.
            Companies are shared across all workspaces (Asset Control, Procurement, HR).
          </p>
        </div>
        {/* No "+ Add company" button here. The grid below ends with a "New
            company" card that does exactly this, so the button was a second
            control for one action — and because this header centres its
            content, it sat on its own in the middle of the page above the
            thing it duplicated. */}
      </header>

      {!canEdit && <ReadOnlyBanner label="Procurement" />}
      {error && <div className="error">{error}</div>}

      {companies.length === 0 ? (
        <div className="empty-state">
          <p>No companies yet.</p>
          {canEditCompanies && (
            <button className="btn-primary" onClick={() => setCompanyModal({ mode: 'create' })}>
              Create your first company
            </button>
          )}
        </div>
      ) : (
        <CompanyGrid
          companies={companies}
          onSelect={(c) => setSelectedId(c.id)}
          onAddCompany={() => setCompanyModal({ mode: 'create' })}
          onDelete={canEditCompanies ? handleDeleteCompany : undefined}
          canAdd={canEditCompanies}
          countLabel={(c) => {
            const projects = c.projectCount ?? 0;
            return `${projects} project${projects === 1 ? '' : 's'}`;
          }}
        />
      )}

      {companyModal && (
        <CompanyModal
          mode={companyModal.mode}
          company={companyModal.company}
          onClose={() => setCompanyModal(null)}
          onSave={handleSaveCompany}
        />
      )}
    </div>
  );
}
