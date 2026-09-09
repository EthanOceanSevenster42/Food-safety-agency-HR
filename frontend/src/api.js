import { auth } from './auth.js';

async function request(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const headers = { ...(options.headers || {}) };
  if (!isFormData && options.body) headers['Content-Type'] = 'application/json';
  const token = auth.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, { ...options, headers });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : null;

  if (res.status === 401 && path !== '/auth/login') {
    auth.clear();
    if (window.location.pathname !== '/login') {
      window.location.assign('/login');
    }
    throw new Error('Your session has expired. Please sign in again.');
  }

  if (!res.ok) {
    const message = body?.error || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body;
}

export const api = {
  login(email, password) {
    return request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },
  me() {
    return request('/auth/me');
  },

  listCompanies() {
    return request('/companies');
  },
  createCompany(p) {
    const fd = new FormData();
    fd.append('name', p.name);
    if (p.logoFile)               fd.append('logo', p.logoFile);
    if (p.sowHeaderFile)          fd.append('sowHeader', p.sowHeaderFile);
    if (p.sowFooterFile)          fd.append('sowFooter', p.sowFooterFile);
    if (p.docLandscapeHeaderFile) fd.append('docLandscapeHeader', p.docLandscapeHeaderFile);
    if (p.docLandscapeFooterFile) fd.append('docLandscapeFooter', p.docLandscapeFooterFile);
    if (p.brandColor   != null)   fd.append('brandColor', p.brandColor);
    if (p.registrationNumber != null) fd.append('registrationNumber', p.registrationNumber);
    if (p.sowFontFamily)          fd.append('sowFontFamily', p.sowFontFamily);
    if (p.sowBodyFontSize     != null && p.sowBodyFontSize     !== '') fd.append('sowBodyFontSize', p.sowBodyFontSize);
    if (p.sowHeading1FontSize != null && p.sowHeading1FontSize !== '') fd.append('sowHeading1FontSize', p.sowHeading1FontSize);
    if (p.sowHeading2FontSize != null && p.sowHeading2FontSize !== '') fd.append('sowHeading2FontSize', p.sowHeading2FontSize);
    if (p.sowHeading3FontSize != null && p.sowHeading3FontSize !== '') fd.append('sowHeading3FontSize', p.sowHeading3FontSize);
    if (p.docH1AllCaps != null) fd.append('docH1AllCaps', p.docH1AllCaps ? 'true' : 'false');
    if (p.docH2AllCaps != null) fd.append('docH2AllCaps', p.docH2AllCaps ? 'true' : 'false');
    if (p.docH3AllCaps != null) fd.append('docH3AllCaps', p.docH3AllCaps ? 'true' : 'false');
    if (p.docHeaderSideMargin != null) fd.append('docHeaderSideMargin', p.docHeaderSideMargin ? 'true' : 'false');
    if (p.docFooterSideMargin != null) fd.append('docFooterSideMargin', p.docFooterSideMargin ? 'true' : 'false');
    if (p.docSectionSeparator != null) fd.append('docSectionSeparator', p.docSectionSeparator ? 'true' : 'false');
    if (p.docPageNumberPosition)       fd.append('docPageNumberPosition', p.docPageNumberPosition);
    if (p.docFooterPlacement)          fd.append('docFooterPlacement', p.docFooterPlacement);
    if (p.docHeaderPlacement)          fd.append('docHeaderPlacement', p.docHeaderPlacement);
    if (p.sowProviderName)        fd.append('sowProviderName', p.sowProviderName);
    if (p.sowProviderDesignation) fd.append('sowProviderDesignation', p.sowProviderDesignation);
    if (p.sowProviderLocation)    fd.append('sowProviderLocation', p.sowProviderLocation);
    if (Array.isArray(p.coreValues)) fd.append('coreValuesJson', JSON.stringify(p.coreValues));
    if (Array.isArray(p.companyFacets)) fd.append('companyFacetsJson', JSON.stringify(p.companyFacets));
    return request('/companies', { method: 'POST', body: fd });
  },
  updateCompany(id, p) {
    const fd = new FormData();
    fd.append('name', p.name);
    if (p.logoFile)               fd.append('logo', p.logoFile);
    if (p.removeLogo)             fd.append('removeLogo', 'true');
    if (p.sowHeaderFile)          fd.append('sowHeader', p.sowHeaderFile);
    if (p.removeSowHeader)        fd.append('removeSowHeader', 'true');
    if (p.sowFooterFile)          fd.append('sowFooter', p.sowFooterFile);
    if (p.removeSowFooter)        fd.append('removeSowFooter', 'true');
    if (p.docLandscapeHeaderFile) fd.append('docLandscapeHeader', p.docLandscapeHeaderFile);
    if (p.removeDocLandscapeHeader) fd.append('removeDocLandscapeHeader', 'true');
    if (p.docLandscapeFooterFile) fd.append('docLandscapeFooter', p.docLandscapeFooterFile);
    if (p.removeDocLandscapeFooter) fd.append('removeDocLandscapeFooter', 'true');
    // pass empty string to clear; omit field to leave unchanged
    if (p.brandColor !== undefined)         fd.append('brandColor', p.brandColor ?? '');
    if (p.registrationNumber !== undefined) fd.append('registrationNumber', p.registrationNumber ?? '');
    if (p.sowFontFamily !== undefined)      fd.append('sowFontFamily', p.sowFontFamily ?? '');
    if (p.sowBodyFontSize     !== undefined) fd.append('sowBodyFontSize', p.sowBodyFontSize ?? '');
    if (p.sowHeading1FontSize !== undefined) fd.append('sowHeading1FontSize', p.sowHeading1FontSize ?? '');
    if (p.sowHeading2FontSize !== undefined) fd.append('sowHeading2FontSize', p.sowHeading2FontSize ?? '');
    if (p.sowHeading3FontSize !== undefined) fd.append('sowHeading3FontSize', p.sowHeading3FontSize ?? '');
    if (p.docH1AllCaps !== undefined) fd.append('docH1AllCaps', p.docH1AllCaps == null ? '' : (p.docH1AllCaps ? 'true' : 'false'));
    if (p.docH2AllCaps !== undefined) fd.append('docH2AllCaps', p.docH2AllCaps == null ? '' : (p.docH2AllCaps ? 'true' : 'false'));
    if (p.docH3AllCaps !== undefined) fd.append('docH3AllCaps', p.docH3AllCaps == null ? '' : (p.docH3AllCaps ? 'true' : 'false'));
    if (p.docHeaderSideMargin !== undefined) fd.append('docHeaderSideMargin', p.docHeaderSideMargin ? 'true' : 'false');
    if (p.docFooterSideMargin !== undefined) fd.append('docFooterSideMargin', p.docFooterSideMargin ? 'true' : 'false');
    if (p.docSectionSeparator !== undefined) fd.append('docSectionSeparator', p.docSectionSeparator ? 'true' : 'false');
    if (p.docPageNumberPosition !== undefined) fd.append('docPageNumberPosition', p.docPageNumberPosition ?? '');
    if (p.docFooterPlacement !== undefined) fd.append('docFooterPlacement', p.docFooterPlacement ?? '');
    if (p.docHeaderPlacement !== undefined) fd.append('docHeaderPlacement', p.docHeaderPlacement ?? '');
    if (p.sowProviderName        !== undefined) fd.append('sowProviderName',        p.sowProviderName        ?? '');
    if (p.sowProviderDesignation !== undefined) fd.append('sowProviderDesignation', p.sowProviderDesignation ?? '');
    if (p.sowProviderLocation    !== undefined) fd.append('sowProviderLocation',    p.sowProviderLocation    ?? '');
    if (p.coreValues !== undefined) fd.append('coreValuesJson', JSON.stringify(Array.isArray(p.coreValues) ? p.coreValues : []));
    if (p.companyFacets !== undefined) fd.append('companyFacetsJson', JSON.stringify(Array.isArray(p.companyFacets) ? p.companyFacets : []));
    return request(`/companies/${id}`, { method: 'PUT', body: fd });
  },
  deleteCompany(id) {
    return request(`/companies/${id}`, { method: 'DELETE' });
  },

  listEmployees(companyId) {
    return request(`/companies/${companyId}/employees`);
  },
  // Organogram PDF for a company (name · department · email in a reporting
  // tree). Auth header required, so fetch a blob rather than linking directly.
  async downloadCompanyOrgPdf(companyId) {
    const token = auth.getToken();
    const res = await fetch(`/api/companies/${companyId}/org-pdf`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) {
      let message = `Export failed (${res.status})`;
      try { const j = await res.json(); if (j?.error) message = j.error; } catch {}
      throw new Error(message);
    }
    const blob = await res.blob();
    const filename = parseContentDispositionFilename(res.headers.get('content-disposition')) || 'Org Chart.pdf';
    return { blob, filename };
  },

  getCategoryDefaults(companyId) {
    return request(`/companies/${companyId}/category-defaults`);
  },
  updateCategoryDefaults(companyId, items) {
    return request(`/companies/${companyId}/category-defaults`, {
      method: 'PUT',
      body: JSON.stringify({ items }),
    });
  },
  createEmployee(payload) {
    return request('/employees', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  updateEmployee(id, payload) {
    return request(`/employees/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },
  deleteEmployee(id) {
    return request(`/employees/${id}`, { method: 'DELETE' });
  },

  listAssets(companyId) {
    return request(`/assets?companyId=${companyId}`);
  },
  listAllRepairs() {
    return request('/assets/repairs');
  },
  sendToRepairs(assetId, payload) {
    return request(`/assets/${assetId}/send-to-repairs`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  getRepairDetail(assetId) {
    return request(`/assets/${assetId}/repair`);
  },
  getRepairHistory(assetId) {
    return request(`/assets/${assetId}/repair-history`);
  },
  transferAsset(assetId, companyId) {
    return request(`/assets/${assetId}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ companyId }),
    });
  },
  addRepairNote(assetId, message) {
    return request(`/assets/${assetId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  },
  deleteRepairNote(noteId) {
    return request(`/assets/notes/${noteId}`, { method: 'DELETE' });
  },
  addRepairRecipient(assetId, email) {
    return request(`/assets/${assetId}/recipients`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },
  deleteRepairRecipient(recipientId) {
    return request(`/assets/recipients/${recipientId}`, { method: 'DELETE' });
  },
  createAsset(payload) {
    return request('/assets', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  updateAsset(id, payload) {
    return request(`/assets/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },
  deleteAsset(id) {
    return request(`/assets/${id}`, { method: 'DELETE' });
  },
  uploadAssetImages(assetId, files) {
    const fd = new FormData();
    for (const f of files) fd.append('images', f);
    return request(`/assets/${assetId}/images`, { method: 'POST', body: fd });
  },
  deleteAssetImage(imageId) {
    return request(`/assets/images/${imageId}`, { method: 'DELETE' });
  },

  getAnalytics({ companyId, department, eolWindow } = {}) {
    const params = new URLSearchParams();
    if (companyId) params.set('companyId', companyId);
    if (department) params.set('department', department);
    if (eolWindow) params.set('eolWindow', eolWindow);
    const qs = params.toString();
    return request('/analytics' + (qs ? '?' + qs : ''));
  },

  listUsers() {
    return request('/users');
  },
  createUser(payload) {
    return request('/users', { method: 'POST', body: JSON.stringify(payload) });
  },
  updateUser(id, payload) {
    return request(`/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  },
  deleteUser(id) {
    return request(`/users/${id}`, { method: 'DELETE' });
  },

  listProjects(companyId, status = 'active', department = 'Procurement') {
    const params = new URLSearchParams({
      companyId: String(companyId),
      status,
      department,
    });
    return request(`/projects?${params.toString()}`);
  },
  createProject(payload) {
    return request('/projects', { method: 'POST', body: JSON.stringify(payload) });
  },
  updateProject(id, payload) {
    return request(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  },
  deleteProject(id) {
    return request(`/projects/${id}`, { method: 'DELETE' });
  },
  completeProject(id) {
    return request(`/projects/${id}/complete`, { method: 'POST', body: JSON.stringify({}) });
  },
  reopenProject(id) {
    return request(`/projects/${id}/reopen`, { method: 'POST', body: JSON.stringify({}) });
  },

  listProcesses(projectId) {
    return request(`/projects/${projectId}/processes`);
  },
  createProcess(projectId, payload) {
    return request(`/projects/${projectId}/processes`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  updateProcess(processId, payload) {
    return request(`/projects/processes/${processId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },
  deleteProcess(processId) {
    return request(`/projects/processes/${processId}`, { method: 'DELETE' });
  },
  getSow(processId) {
    return request(`/projects/processes/${processId}/sow`);
  },
  saveSow(processId, data) {
    return request(`/projects/processes/${processId}/sow`, {
      method: 'PUT',
      body: JSON.stringify({ data }),
    });
  },
  // KPA-formulation task data — { employeeId, kpas: [{ name, department, weight }] }.
  // Lives on its own pair of routes (parallel to /sow) so the SOW editor
  // and the KPA editor stay strictly separate.
  getKpa(processId) {
    return request(`/projects/processes/${processId}/kpa`);
  },
  saveKpa(processId, payload) {
    return request(`/projects/processes/${processId}/kpa`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },
  listKpaVersions(processId) {
    return request(`/projects/processes/${processId}/kpa/versions`);
  },
  getKpaVersion(processId, versionId) {
    return request(`/projects/processes/${processId}/kpa/versions/${versionId}`);
  },
  // Job Description task data. GET also returns the resolved sibling
  // KPA process payload so the editor can render Key Responsibilities
  // pulled from the first KPA-kind task in the same project.
  getJd(processId) {
    return request(`/projects/processes/${processId}/jd`);
  },
  saveJd(processId, data) {
    return request(`/projects/processes/${processId}/jd`, {
      method: 'PUT',
      body: JSON.stringify({ data }),
    });
  },
  // Live JD preview — returns the PDF blob. Same pattern as previewSowPdf.
  async previewJdPdf(processId, data) {
    const token = auth.getToken();
    const res = await fetch(`/api/projects/processes/${processId}/jd/preview-pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ data }),
    });
    if (!res.ok) {
      let message = `Preview failed (${res.status})`;
      try { const j = await res.json(); if (j?.error) message = j.error; } catch {}
      throw new Error(message);
    }
    return await res.blob();
  },
  listJdVersions(processId) {
    return request(`/projects/processes/${processId}/jd/versions`);
  },
  getJdVersion(processId, versionId) {
    return request(`/projects/processes/${processId}/jd/versions/${versionId}`);
  },
  // KPI Document task data. Pulls static columns from the project's KPA
  // task; persists only the editable review fields.
  getKpidoc(processId) {
    return request(`/projects/processes/${processId}/kpidoc`);
  },
  saveKpidoc(processId, data) {
    return request(`/projects/processes/${processId}/kpidoc`, {
      method: 'PUT',
      body: JSON.stringify({ data }),
    });
  },
  listKpidocVersions(processId) {
    return request(`/projects/processes/${processId}/kpidoc/versions`);
  },
  getKpidocVersion(processId, versionId) {
    return request(`/projects/processes/${processId}/kpidoc/versions/${versionId}`);
  },
  async previewKpidocPdf(processId, data) {
    const token = auth.getToken();
    const res = await fetch(`/api/projects/processes/${processId}/kpidoc/preview-pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ data }),
    });
    if (!res.ok) {
      let message = `Preview failed (${res.status})`;
      try { const j = await res.json(); if (j?.error) message = j.error; } catch {}
      throw new Error(message);
    }
    return await res.blob();
  },

  // Role, KPI & EDP Pack — composition-only task. No data of its own;
  // GET returns the status of the three source siblings, preview-pdf
  // stitches them into one combined PDF.
  getPack(processId) {
    return request(`/projects/processes/${processId}/pack`);
  },
  async previewPackPdf(processId) {
    const token = auth.getToken();
    const res = await fetch(`/api/projects/processes/${processId}/pack/preview-pdf`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) {
      let message = `Preview failed (${res.status})`;
      try { const j = await res.json(); if (j?.error) message = j.error; } catch {}
      throw new Error(message);
    }
    const blob = await res.blob();
    const filename = parseContentDispositionFilename(res.headers.get('content-disposition')) || 'Document Pack.pdf';
    return { blob, filename };
  },

  // EDP Alignment Notes task data. Same versioned pattern as JD/KPA.
  getEdp(processId) {
    return request(`/projects/processes/${processId}/edp`);
  },
  saveEdp(processId, data) {
    return request(`/projects/processes/${processId}/edp`, {
      method: 'PUT',
      body: JSON.stringify({ data }),
    });
  },
  listEdpVersions(processId) {
    return request(`/projects/processes/${processId}/edp/versions`);
  },
  getEdpVersion(processId, versionId) {
    return request(`/projects/processes/${processId}/edp/versions/${versionId}`);
  },
  async previewSowPdf(processId, data) {
    const token = auth.getToken();
    const res = await fetch(`/api/projects/processes/${processId}/sow/preview-pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ data }),
    });
    if (!res.ok) {
      let message = `Preview failed (${res.status})`;
      try { const j = await res.json(); if (j?.error) message = j.error; } catch {}
      throw new Error(message);
    }
    return await res.blob();
  },
  uploadSowSignature(processId, file) {
    const fd = new FormData();
    fd.append('signature', file);
    return request(`/projects/processes/${processId}/sow/signature`, {
      method: 'POST',
      body: fd,
    });
  },
  listSowVersions(processId) {
    return request(`/projects/processes/${processId}/sow/versions`);
  },
  getSowVersion(processId, versionId) {
    return request(`/projects/processes/${processId}/sow/versions/${versionId}`);
  },
  uploadSignedVersion(processId, versionId, file) {
    const fd = new FormData();
    fd.append('signed', file);
    return request(`/projects/processes/${processId}/sow/versions/${versionId}/signed`, {
      method: 'POST',
      body: fd,
    });
  },
  deleteSignedVersion(processId, versionId) {
    return request(`/projects/processes/${processId}/sow/versions/${versionId}/signed`, {
      method: 'DELETE',
    });
  },
  runProjectMigrations() {
    return request('/projects/admin/run-migrations', { method: 'POST', body: JSON.stringify({}) });
  },

  // ----- Task templates -----
  // (Internal endpoint path is /api/sow-templates for now; the user-facing
  // label is "Task templates" because the same plumbing will host other
  // document types in future.)
  listSowTemplates(companyId, department = 'Procurement') {
    const params = new URLSearchParams({
      companyId: String(companyId),
      department,
    });
    return request(`/sow-templates?${params.toString()}`);
  },
  getSowTemplate(id) {
    return request(`/sow-templates/${id}`);
  },
  createSowTemplate(payload) {
    return request('/sow-templates', { method: 'POST', body: JSON.stringify(payload) });
  },
  updateSowTemplate(id, payload) {
    return request(`/sow-templates/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  },
  duplicateSowTemplate(id, payload = {}) {
    return request(`/sow-templates/${id}/duplicate`, { method: 'POST', body: JSON.stringify(payload) });
  },
  deleteSowTemplate(id) {
    return request(`/sow-templates/${id}`, { method: 'DELETE' });
  },
  // Live preview for the task-template editor. Returns the raw PDF blob,
  // same pattern as previewSowPdf — companyId selects whose branding the
  // preview uses (the template's owner company).
  async previewSowTemplatePdf(companyId, data, documentName = '') {
    const token = auth.getToken();
    const res = await fetch('/api/sow-templates/preview-pdf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ companyId, data, documentName }),
    });
    if (!res.ok) {
      let message = `Preview failed (${res.status})`;
      try { const j = await res.json(); if (j?.error) message = j.error; } catch {}
      throw new Error(message);
    }
    return await res.blob();
  },

  // ----- KPI tracker (HR) -----
  getKpiAnalytics(companyId) {
    return request(`/kpi/analytics?companyId=${companyId}`);
  },
  getCompanyKpiSettings(companyId) {
    return request(`/kpi/companies/${companyId}/settings`);
  },
  updateCompanyKpiSettings(companyId, payload) {
    return request(`/kpi/companies/${companyId}/settings`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },
  updateEmployeeKpiSettings(employeeId, payload) {
    return request(`/kpi/employees/${employeeId}/settings`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },
  listKpiSessions(employeeId) {
    return request(`/kpi/employees/${employeeId}/sessions`);
  },
  listKpiSessionsByCompany(companyId) {
    return request(`/kpi/sessions/by-company/${companyId}`);
  },
  createKpiSession(employeeId, { periodLabel, sessionDate, notes, documentFile }) {
    const fd = new FormData();
    fd.append('periodLabel', periodLabel);
    if (sessionDate)  fd.append('sessionDate', sessionDate);
    if (notes)        fd.append('notes', notes);
    if (documentFile) fd.append('document', documentFile);
    return request(`/kpi/employees/${employeeId}/sessions`, {
      method: 'POST',
      body: fd,
    });
  },
  updateKpiSession(sessionId, { periodLabel, sessionDate, notes, documentFile, removeDocument } = {}) {
    const fd = new FormData();
    if (periodLabel !== undefined) fd.append('periodLabel', periodLabel);
    if (sessionDate !== undefined) fd.append('sessionDate', sessionDate ?? '');
    if (notes !== undefined)       fd.append('notes', notes ?? '');
    if (documentFile)              fd.append('document', documentFile);
    if (removeDocument)            fd.append('removeDocument', 'true');
    return request(`/kpi/sessions/${sessionId}`, {
      method: 'PUT',
      body: fd,
    });
  },
  deleteKpiSession(sessionId) {
    return request(`/kpi/sessions/${sessionId}`, { method: 'DELETE' });
  },

  // ----- KPI review workflow -----
  listKpaSources(companyId, employeeId) {
    const q = employeeId ? `?companyId=${companyId}&employeeId=${employeeId}` : `?companyId=${companyId}`;
    return request(`/kpi/kpa-sources${q}`);
  },
  listKpiReviews(companyId) {
    return request(`/kpi/reviews?companyId=${companyId}`);
  },
  getKpiReview(id) {
    return request(`/kpi/reviews/${id}`);
  },
  deleteKpiReview(id) {
    return request(`/kpi/reviews/${id}`, { method: 'DELETE' });
  },
  resendReviewEmail(id, party) {
    return request(`/kpi/reviews/${id}/resend`, {
      method: 'POST',
      body: JSON.stringify({ party }),
    });
  },
  createKpiReview({ employeeId, sourceProcessId, periodLabel, selectedKpiIndices, managerId }) {
    return request('/kpi/reviews', {
      method: 'POST',
      body: JSON.stringify({ employeeId, sourceProcessId, periodLabel, selectedKpiIndices, managerId }),
    });
  },
  // Staff self-assessment + account activation
  validateInvite(token) {
    return request(`/auth/invite/${encodeURIComponent(token)}`);
  },
  setPassword(token, password) {
    return request('/auth/set-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    });
  },
  listMyKpiReviews() {
    return request('/kpi/reviews/mine');
  },
  getEmployeeAssessment(id) {
    return request(`/kpi/reviews/${id}/employee-assessment`);
  },
  saveEmployeeAssessment(id, { ratings, submit }) {
    return request(`/kpi/reviews/${id}/employee-assessment`, {
      method: 'PUT',
      body: JSON.stringify({ ratings, submit }),
    });
  },
  listTeamKpiReviews() {
    return request('/kpi/reviews/team');
  },
  getManagerAssessment(id) {
    return request(`/kpi/reviews/${id}/manager-assessment`);
  },
  saveManagerAssessment(id, { ratings, submit, sessionPassword }) {
    return request(`/kpi/reviews/${id}/manager-assessment`, {
      method: 'PUT',
      body: JSON.stringify({ ratings, submit, sessionPassword }),
    });
  },
  getReviewSession(id) {
    return request(`/kpi/reviews/${id}/session`);
  },
  unlockReviewSession(id, password) {
    return request(`/kpi/reviews/${id}/unlock`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  },
  completeReview(id) {
    return request(`/kpi/reviews/${id}/complete`, { method: 'POST' });
  },
  // Joint-session sign-off: confirm the feedback was discussed. `party` is
  // 'manager' or 'employee' (optional — the server infers it from the actor).
  acknowledgeReview(id, party) {
    return request(`/kpi/reviews/${id}/acknowledge`, {
      method: 'POST',
      body: JSON.stringify(party ? { party } : {}),
    });
  },
  saveSessionNotes(id, notes) {
    return request(`/kpi/reviews/${id}/session-notes`, {
      method: 'PUT',
      body: JSON.stringify({ notes }),
    });
  },
  // Per-employee performance for the analysis view (completed reviews →
  // per-KPA / per-KPI manager scores, newest first).
  getEmployeePerformance(employeeId) {
    return request(`/kpi/employees/${employeeId}/performance`);
  },
  // Fetch the branded, signed KPI document PDF for a review (auth header
  // required, so we fetch a blob rather than linking directly).
  async downloadReviewDocument(id) {
    const token = auth.getToken();
    const res = await fetch(`/api/kpi/reviews/${id}/document-pdf`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) {
      let message = `Download failed (${res.status})`;
      try { const j = await res.json(); if (j?.error) message = j.error; } catch {}
      throw new Error(message);
    }
    const blob = await res.blob();
    const filename = parseContentDispositionFilename(res.headers.get('content-disposition')) || 'KPI Review.pdf';
    return { blob, filename };
  },

  getSettings() {
    return request('/settings');
  },
  updateRepairCoordinator({ email, name }) {
    return request('/settings/repair-coordinator', {
      method: 'PUT',
      body: JSON.stringify({ email, name }),
    });
  },
  async exportAssets(companyId) {
    return downloadXlsx(`/api/assets/export?companyId=${companyId}`, `assets-${Date.now()}.xlsx`);
  },
  async exportRepairs() {
    return downloadXlsx('/api/assets/repairs/export', `FSA-Repairs-${new Date().toISOString().slice(0, 10)}.xlsx`);
  },

  // ---- FSA HR module (People & management hub) ----------------------------
  fsaHome() {
    return request('/fsa/home');
  },
  fsaNavCounts() {
    return request('/fsa/nav-counts');
  },
  fsaDashboard() {
    return request('/fsa/dashboard');
  },
  fsaStaff({ service = 'All', q = '' } = {}) {
    return request(`/fsa/staff?service=${encodeURIComponent(service)}&q=${encodeURIComponent(q)}`);
  },
  fsaCompetence() {
    return request('/fsa/competence');
  },
  fsaRequisitions() {
    return request('/fsa/requisitions');
  },
  fsaCreateRequisition(payload) {
    return request('/fsa/requisitions', { method: 'POST', body: JSON.stringify(payload) });
  },
  fsaUpdateRequisition(id, payload) {
    return request(`/fsa/requisitions/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  },
  fsaPipeline() {
    return request('/fsa/pipeline');
  },
  fsaMoveCandidate(id, stage) {
    return request(`/fsa/pipeline/${id}`, { method: 'PATCH', body: JSON.stringify({ stage }) });
  },
  fsaR2g() {
    return request('/fsa/r2g');
  },
  fsaProgramme(code) {
    return request(`/fsa/r2g/${encodeURIComponent(code)}`);
  },
  // Sign-offs are keyed by activity, not by position in the checklist.
  fsaSetCheck(code, { activityId, done }) {
    return request(`/fsa/r2g/${encodeURIComponent(code)}/checks`, {
      method: 'PUT',
      body: JSON.stringify({ activityId, done }),
    });
  },
  fsaAddActivity(payload) {
    return request('/fsa/templates', { method: 'POST', body: JSON.stringify(payload) });
  },
  fsaUpdateActivity(id, payload) {
    return request(`/fsa/templates/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  },
  fsaRemoveActivity(id) {
    return request(`/fsa/templates/${id}`, { method: 'DELETE' });
  },
  fsaAddTarget(payload) {
    return request('/fsa/templates/targets', { method: 'POST', body: JSON.stringify(payload) });
  },
  fsaUpdateTarget(id, payload) {
    return request(`/fsa/templates/targets/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  },
  fsaRemoveTarget(id) {
    return request(`/fsa/templates/targets/${id}`, { method: 'DELETE' });
  },
  fsaTemplates(dept) {
    return request(`/fsa/templates?dept=${encodeURIComponent(dept)}`);
  },
  fsaToggleActivity(id, enabled) {
    return request(`/fsa/templates/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
  },
  // The leave queue is filtered, sorted and paged server-side — the client
  // only ever holds one page of it.
  fsaLeave({ status = 'pending', site = 'All', service = 'All', type = 'All',
             coverage = 'All', q = '', sort = 'urgent', page = 1, pageSize = 25 } = {}) {
    const qs = new URLSearchParams({
      status, site, service, type, coverage, q, sort,
      page: String(page), pageSize: String(pageSize),
    });
    return request(`/fsa/leave?${qs}`);
  },
  fsaLeaveCoverage({ q = '', risk = false, limit = 8 } = {}) {
    const qs = new URLSearchParams({ q, risk: String(risk), limit: String(limit) });
    return request(`/fsa/leave/coverage?${qs}`);
  },
  fsaLeaveBulkDecision(ids, decision) {
    return request('/fsa/leave/bulk-decision', {
      method: 'POST',
      body: JSON.stringify({ ids, decision }),
    });
  },
  fsaLeaveDecision(id, decision) {
    return request(`/fsa/leave/${id}/decision`, { method: 'POST', body: JSON.stringify({ decision }) });
  },
  fsaDocuments({ library = 'All documents', q = '' } = {}) {
    return request(`/fsa/documents?library=${encodeURIComponent(library)}&q=${encodeURIComponent(q)}`);
  },
  fsaAddLibrary(name) {
    return request('/fsa/documents/libraries', { method: 'POST', body: JSON.stringify({ name }) });
  },
  fsaRenameLibrary(id, name) {
    return request(`/fsa/documents/libraries/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
  },

};

// Pull a filename out of a Content-Disposition header. Prefers the RFC 5987
// filename* (unicode) form, falling back to the plain filename.
function parseContentDispositionFilename(cd) {
  if (!cd) return null;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(cd);
  if (star) {
    try { return decodeURIComponent(star[1].trim().replace(/^["']|["']$/g, '')); } catch { /* fall through */ }
  }
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  return plain ? plain[1].trim() : null;
}

async function downloadXlsx(path, fallbackName) {
  const token = auth.getToken();
  const res = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let message = `Export failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {}
    throw new Error(message);
  }
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const filename = match ? match[1] : fallbackName;
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}
