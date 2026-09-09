import { useState } from 'react';
import Modal from './Modal.jsx';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const COLOR_PRESETS = ['#088298', '#1F4E79', '#2E7D32', '#7B1FA2', '#C62828', '#EF6C00', '#455A64', '#5D4037'];

export default function CompanyModal({ mode = 'create', company, onClose, onSave }) {
  const isEdit = mode === 'edit';
  const [name, setName] = useState(company?.name ?? '');
  const [logoFile, setLogoFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [brandColor, setBrandColor] = useState(company?.brandColor ?? '');
  const [hexInput, setHexInput] = useState(company?.brandColor ?? '');
  const [registrationNumber, setRegistrationNumber] = useState(company?.registrationNumber ?? '');

  // Document typography (all optional — empty string = "use default")
  const [sowFontFamily,      setSowFontFamily]      = useState(company?.sowFontFamily ?? '');
  const [sowBodyFontSize,    setSowBodyFontSize]    = useState(company?.sowBodyFontSize    ?? '');
  const [sowH1FontSize,      setSowH1FontSize]      = useState(company?.sowHeading1FontSize ?? '');
  const [sowH2FontSize,      setSowH2FontSize]      = useState(company?.sowHeading2FontSize ?? '');
  const [sowH3FontSize,      setSowH3FontSize]      = useState(company?.sowHeading3FontSize ?? '');
  // Per-heading "all caps" toggles
  const [docH1AllCaps, setDocH1AllCaps] = useState(!!company?.docH1AllCaps);
  const [docH2AllCaps, setDocH2AllCaps] = useState(!!company?.docH2AllCaps);
  const [docH3AllCaps, setDocH3AllCaps] = useState(!!company?.docH3AllCaps);
  // Inset the header / footer banners by the body left/right margin so
  // they line up with the text block — when off, the corresponding
  // banner runs edge-to-edge. The two toggles are independent so authors
  // can mix (e.g. inset header + full-bleed footer).
  const [docHeaderSideMargin, setDocHeaderSideMargin] = useState(!!company?.docHeaderSideMargin);
  const [docFooterSideMargin, setDocFooterSideMargin] = useState(!!company?.docFooterSideMargin);
  // Draw the faint horizontal separator line between main sections and
  // above Signature Control. Defaults to ON for new companies and any
  // existing company that hasn't been migrated yet.
  const [docSectionSeparator, setDocSectionSeparator] = useState(
    company?.docSectionSeparator == null ? true : !!company.docSectionSeparator,
  );
  // Where the page number sits in generated documents — 'top' or
  // 'bottom'. Defaults to 'bottom' to match the original behaviour.
  const [docPageNumberPosition, setDocPageNumberPosition] = useState(
    company?.docPageNumberPosition === 'top' ? 'top' : 'bottom',
  );
  // Header placement: 'all' (every page), 'first' (first page only),
  // 'last' (last page only), or 'none' (no header). Defaults to 'first'
  // — historically the SOW letterhead only appeared on the cover page.
  const [docHeaderPlacement, setDocHeaderPlacement] = useState(
    company?.docHeaderPlacement || 'first',
  );
  // Footer placement: 'all' (every page), 'first' (first page only),
  // 'last' (last page only), or 'none' (no footer). Defaults to 'all'.
  const [docFooterPlacement, setDocFooterPlacement] = useState(
    company?.docFooterPlacement || 'all',
  );

  // Default Service Provider signatory used to pre-fill the Signature
  // Control page of every new SOW for this company.
  const [sowProviderName,        setSowProviderName]        = useState(company?.sowProviderName        ?? '');
  const [sowProviderDesignation, setSowProviderDesignation] = useState(company?.sowProviderDesignation ?? '');
  const [sowProviderLocation,    setSowProviderLocation]    = useState(company?.sowProviderLocation    ?? '');

  // Open-ended list of core values surfaced to downstream document
  // generators. Stored as a plain array of strings; the UI lets the user
  // add/remove rows freely so different companies can keep different counts.
  const [coreValues, setCoreValues] = useState(
    Array.isArray(company?.coreValues) ? company.coreValues : [],
  );
  function updateCoreValue(idx, value) {
    setCoreValues((prev) => prev.map((v, i) => (i === idx ? value : v)));
  }
  function addCoreValue() {
    setCoreValues((prev) => [...prev, '']);
  }
  function removeCoreValue(idx) {
    setCoreValues((prev) => prev.filter((_, i) => i !== idx));
  }

  // Open-ended list of "departments / facets" this company operates in.
  // Drives the department dropdown in the KPA-formulation task so weighted
  // KPAs can be rolled up per facet later.
  const [companyFacets, setCompanyFacets] = useState(
    Array.isArray(company?.companyFacets) ? company.companyFacets : [],
  );
  function updateFacet(idx, value) {
    setCompanyFacets((prev) => prev.map((v, i) => (i === idx ? value : v)));
  }
  function addFacet() {
    setCompanyFacets((prev) => [...prev, '']);
  }
  function removeFacet(idx) {
    setCompanyFacets((prev) => prev.filter((_, i) => i !== idx));
  }

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Header/footer banner state — portrait pair + landscape pair
  const [sowHeaderFile, setSowHeaderFile] = useState(null);
  const [sowHeaderPreview, setSowHeaderPreview] = useState(null);
  const [removeSowHeader, setRemoveSowHeader] = useState(false);
  const [sowFooterFile, setSowFooterFile] = useState(null);
  const [sowFooterPreview, setSowFooterPreview] = useState(null);
  const [removeSowFooter, setRemoveSowFooter] = useState(false);
  const [docLandscapeHeaderFile, setDocLandscapeHeaderFile] = useState(null);
  const [docLandscapeHeaderPreview, setDocLandscapeHeaderPreview] = useState(null);
  const [removeDocLandscapeHeader, setRemoveDocLandscapeHeader] = useState(false);
  const [docLandscapeFooterFile, setDocLandscapeFooterFile] = useState(null);
  const [docLandscapeFooterPreview, setDocLandscapeFooterPreview] = useState(null);
  const [removeDocLandscapeFooter, setRemoveDocLandscapeFooter] = useState(false);

  const showCurrent = !removeLogo && !previewUrl && company?.logoUrl;
  const showPicked = !!previewUrl;
  const showHeaderCurrent = !removeSowHeader && !sowHeaderPreview && company?.sowHeaderUrl;
  const showHeaderPicked = !!sowHeaderPreview;
  const showFooterCurrent = !removeSowFooter && !sowFooterPreview && company?.sowFooterUrl;
  const showFooterPicked = !!sowFooterPreview;

  function pickHeaderFile(file) {
    setSowHeaderFile(file);
    setRemoveSowHeader(false);
    if (file) setSowHeaderPreview(URL.createObjectURL(file));
    else setSowHeaderPreview(null);
  }
  function clearHeaderFile() {
    if (sowHeaderPreview) URL.revokeObjectURL(sowHeaderPreview);
    setSowHeaderFile(null);
    setSowHeaderPreview(null);
    setRemoveSowHeader(true);
  }
  function pickFooterFile(file) {
    setSowFooterFile(file);
    setRemoveSowFooter(false);
    if (file) setSowFooterPreview(URL.createObjectURL(file));
    else setSowFooterPreview(null);
  }
  function clearFooterFile() {
    if (sowFooterPreview) URL.revokeObjectURL(sowFooterPreview);
    setSowFooterFile(null);
    setSowFooterPreview(null);
    setRemoveSowFooter(true);
  }

  function pickLsHeaderFile(file) {
    setDocLandscapeHeaderFile(file);
    setRemoveDocLandscapeHeader(false);
    setDocLandscapeHeaderPreview(file ? URL.createObjectURL(file) : null);
  }
  function clearLsHeaderFile() {
    if (docLandscapeHeaderPreview) URL.revokeObjectURL(docLandscapeHeaderPreview);
    setDocLandscapeHeaderFile(null);
    setDocLandscapeHeaderPreview(null);
    setRemoveDocLandscapeHeader(true);
  }
  function pickLsFooterFile(file) {
    setDocLandscapeFooterFile(file);
    setRemoveDocLandscapeFooter(false);
    setDocLandscapeFooterPreview(file ? URL.createObjectURL(file) : null);
  }
  function clearLsFooterFile() {
    if (docLandscapeFooterPreview) URL.revokeObjectURL(docLandscapeFooterPreview);
    setDocLandscapeFooterFile(null);
    setDocLandscapeFooterPreview(null);
    setRemoveDocLandscapeFooter(true);
  }

  const showLsHeaderCurrent = !removeDocLandscapeHeader && !docLandscapeHeaderPreview && company?.docLandscapeHeaderUrl;
  const showLsHeaderPicked = !!docLandscapeHeaderPreview;
  const showLsFooterCurrent = !removeDocLandscapeFooter && !docLandscapeFooterPreview && company?.docLandscapeFooterUrl;
  const showLsFooterPicked = !!docLandscapeFooterPreview;

  function pickFile(file) {
    setLogoFile(file);
    setRemoveLogo(false);
    if (file) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
  }

  function clearLogo() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setLogoFile(null);
    setPreviewUrl(null);
    setRemoveLogo(true);
  }

  function applyColor(hex) {
    setBrandColor(hex);
    setHexInput(hex);
  }

  function resetColor() {
    setBrandColor('');
    setHexInput('');
  }

  function commitHexInput(value) {
    const trimmed = value.trim();
    setHexInput(trimmed);
    if (trimmed === '') { setBrandColor(''); return; }
    if (HEX_RE.test(trimmed)) setBrandColor(trimmed.toLowerCase());
  }

  const hexInvalid = hexInput !== '' && !HEX_RE.test(hexInput);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    if (hexInvalid) { setErr('Brand color must be a hex value like #088298'); return; }
    setBusy(true);
    setErr('');
    try {
      let colorToSend;
      if (isEdit) colorToSend = brandColor || '';
      else colorToSend = brandColor || undefined;

      await onSave({
        name: name.trim(),
        logoFile,
        removeLogo: isEdit && removeLogo,
        brandColor: colorToSend,
        sowHeaderFile,
        removeSowHeader: isEdit && removeSowHeader,
        sowFooterFile,
        removeSowFooter: isEdit && removeSowFooter,
        docLandscapeHeaderFile,
        removeDocLandscapeHeader: isEdit && removeDocLandscapeHeader,
        docLandscapeFooterFile,
        removeDocLandscapeFooter: isEdit && removeDocLandscapeFooter,
        registrationNumber: isEdit ? (registrationNumber || '') : (registrationNumber || undefined),
        sowFontFamily: isEdit ? sowFontFamily : (sowFontFamily || undefined),
        sowBodyFontSize: isEdit ? sowBodyFontSize : (sowBodyFontSize || undefined),
        sowHeading1FontSize: isEdit ? sowH1FontSize : (sowH1FontSize || undefined),
        sowHeading2FontSize: isEdit ? sowH2FontSize : (sowH2FontSize || undefined),
        sowHeading3FontSize: isEdit ? sowH3FontSize : (sowH3FontSize || undefined),
        docH1AllCaps,
        docH2AllCaps,
        docH3AllCaps,
        docHeaderSideMargin,
        docFooterSideMargin,
        docSectionSeparator,
        docPageNumberPosition,
        docHeaderPlacement,
        docFooterPlacement,
        sowProviderName:        isEdit ? sowProviderName        : (sowProviderName        || undefined),
        sowProviderDesignation: isEdit ? sowProviderDesignation : (sowProviderDesignation || undefined),
        sowProviderLocation:    isEdit ? sowProviderLocation    : (sowProviderLocation    || undefined),
        coreValues: coreValues.map((v) => v.trim()).filter(Boolean),
        companyFacets: companyFacets.map((v) => v.trim()).filter(Boolean),
      });
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={isEdit ? 'Edit Company Branding' : 'New Company'} onClose={onClose}>
      <form onSubmit={submit}>
        {err && <div className="error">{err}</div>}
        <div className="field-row">
          <div className="field">
            <label htmlFor="name">Company name</label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Food Safety Agency"
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="reg-no">Registration number</label>
            <input
              id="reg-no"
              type="text"
              value={registrationNumber}
              onChange={(e) => setRegistrationNumber(e.target.value)}
              placeholder="e.g. 2020/223239/07"
            />
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label>Logo</label>
            <div className="logo-edit">
              <div className="logo-edit-preview">
                {showPicked && <img src={previewUrl} alt="New logo preview" />}
                {showCurrent && <img src={company.logoUrl} alt={company.name} />}
                {!showPicked && !showCurrent && (
                  <div className="company-logo-placeholder">
                    {(name || '?').slice(0, 2).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="logo-edit-actions">
                <label className="btn-ghost upload-trigger">
                  {showPicked || showCurrent ? 'Replace…' : 'Upload…'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="upload-input-overlay"
                    onChange={(e) => {
                      pickFile(e.target.files?.[0] ?? null);
                      e.target.value = '';
                    }}
                  />
                </label>
                {(showPicked || showCurrent) && (
                  <button type="button" className="btn-ghost danger" onClick={clearLogo}>Remove</button>
                )}
              </div>
            </div>
            <small className="muted">PNG, JPEG, WebP or SVG · max 5 MB</small>
          </div>

          <div className="field">
            <label>Brand colour</label>
            <div className="color-edit">
              <div className="color-edit-row">
                <input
                  type="color"
                  aria-label="Pick brand colour"
                  value={brandColor || '#088298'}
                  onChange={(e) => applyColor(e.target.value)}
                  className="color-picker"
                />
                <input
                  type="text"
                  aria-label="Hex value"
                  value={hexInput}
                  placeholder="#088298"
                  onChange={(e) => commitHexInput(e.target.value)}
                  className={'color-hex' + (hexInvalid ? ' invalid' : '')}
                  maxLength={7}
                />
                {brandColor && (
                  <button type="button" className="btn-ghost" onClick={resetColor}>Reset</button>
                )}
              </div>
              <div className="color-presets">
                {COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={'color-swatch' + (brandColor.toLowerCase() === c.toLowerCase() ? ' selected' : '')}
                    style={{ background: c }}
                    onClick={() => applyColor(c)}
                    aria-label={`Use ${c}`}
                    title={c}
                  />
                ))}
              </div>
            </div>
            <small className="muted">Tints organograms and accent UI per company.</small>
          </div>
        </div>

        <div className="modal-section-title">Document branding · Portrait</div>
        <small className="muted" style={{ display: 'block', marginBottom: 10 }}>
          Stamped as the repeating page header/footer on every portrait page. Design for ~<strong>2400 px wide</strong>.
        </small>

        <div className="field-row">
          <div className="field">
            <label>Portrait header</label>
            <div className="banner-edit">
              <div className="banner-edit-preview banner-edit-header">
                {showHeaderPicked && <img src={sowHeaderPreview} alt="New header preview" />}
                {showHeaderCurrent && <img src={company.sowHeaderUrl} alt="Current header" />}
                {!showHeaderPicked && !showHeaderCurrent && (
                  <div className="banner-edit-empty">No header set</div>
                )}
              </div>
              <div className="logo-edit-actions">
                <label className="btn-ghost upload-trigger">
                  {showHeaderPicked || showHeaderCurrent ? 'Replace…' : 'Upload…'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="upload-input-overlay"
                    onChange={(e) => {
                      pickHeaderFile(e.target.files?.[0] ?? null);
                      e.target.value = '';
                    }}
                  />
                </label>
                {(showHeaderPicked || showHeaderCurrent) && (
                  <button type="button" className="btn-ghost danger" onClick={clearHeaderFile}>Remove</button>
                )}
              </div>
            </div>
          </div>

          <div className="field">
            <label>Portrait footer</label>
            <div className="banner-edit">
              <div className="banner-edit-preview banner-edit-footer">
                {showFooterPicked && <img src={sowFooterPreview} alt="New footer preview" />}
                {showFooterCurrent && <img src={company.sowFooterUrl} alt="Current footer" />}
                {!showFooterPicked && !showFooterCurrent && (
                  <div className="banner-edit-empty">No footer set</div>
                )}
              </div>
              <div className="logo-edit-actions">
                <label className="btn-ghost upload-trigger">
                  {showFooterPicked || showFooterCurrent ? 'Replace…' : 'Upload…'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="upload-input-overlay"
                    onChange={(e) => {
                      pickFooterFile(e.target.files?.[0] ?? null);
                      e.target.value = '';
                    }}
                  />
                </label>
                {(showFooterPicked || showFooterCurrent) && (
                  <button type="button" className="btn-ghost danger" onClick={clearFooterFile}>Remove</button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="modal-section-title">Document branding · Landscape</div>
        <small className="muted" style={{ display: 'block', marginBottom: 10 }}>
          Used when a document renders in landscape. Wider aspect ratio — design for ~<strong>3400 px wide</strong>.
        </small>

        <div className="field-row">
          <div className="field">
            <label>Landscape header</label>
            <div className="banner-edit">
              <div className="banner-edit-preview banner-edit-header">
                {showLsHeaderPicked && <img src={docLandscapeHeaderPreview} alt="New landscape header" />}
                {showLsHeaderCurrent && <img src={company.docLandscapeHeaderUrl} alt="Current landscape header" />}
                {!showLsHeaderPicked && !showLsHeaderCurrent && (
                  <div className="banner-edit-empty">No landscape header set</div>
                )}
              </div>
              <div className="logo-edit-actions">
                <label className="btn-ghost upload-trigger">
                  {showLsHeaderPicked || showLsHeaderCurrent ? 'Replace…' : 'Upload…'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="upload-input-overlay"
                    onChange={(e) => {
                      pickLsHeaderFile(e.target.files?.[0] ?? null);
                      e.target.value = '';
                    }}
                  />
                </label>
                {(showLsHeaderPicked || showLsHeaderCurrent) && (
                  <button type="button" className="btn-ghost danger" onClick={clearLsHeaderFile}>Remove</button>
                )}
              </div>
            </div>
          </div>

          <div className="field">
            <label>Landscape footer</label>
            <div className="banner-edit">
              <div className="banner-edit-preview banner-edit-footer">
                {showLsFooterPicked && <img src={docLandscapeFooterPreview} alt="New landscape footer" />}
                {showLsFooterCurrent && <img src={company.docLandscapeFooterUrl} alt="Current landscape footer" />}
                {!showLsFooterPicked && !showLsFooterCurrent && (
                  <div className="banner-edit-empty">No landscape footer set</div>
                )}
              </div>
              <div className="logo-edit-actions">
                <label className="btn-ghost upload-trigger">
                  {showLsFooterPicked || showLsFooterCurrent ? 'Replace…' : 'Upload…'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="upload-input-overlay"
                    onChange={(e) => {
                      pickLsFooterFile(e.target.files?.[0] ?? null);
                      e.target.value = '';
                    }}
                  />
                </label>
                {(showLsFooterPicked || showLsFooterCurrent) && (
                  <button type="button" className="btn-ghost danger" onClick={clearLsFooterFile}>Remove</button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Banner layout — independently inset header vs footer. Default
            for both is full-bleed (edge-to-edge). */}
        <div className="field" style={{ marginTop: 8 }}>
          <label>Banner side margins</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={docHeaderSideMargin}
                onChange={(e) => setDocHeaderSideMargin(e.target.checked)}
              />
              <span>
                <strong>Inset header banner</strong>
                <small className="muted"> — adds side margins so the header lines up with the body text instead of running edge-to-edge.</small>
              </span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={docFooterSideMargin}
                onChange={(e) => setDocFooterSideMargin(e.target.checked)}
              />
              <span>
                <strong>Inset footer banner</strong>
                <small className="muted"> — same idea for the footer; turn it on if you want the footer to align with the body even when the header stays full-bleed.</small>
              </span>
            </label>
          </div>
        </div>

        {/* Header placement — control which pages show the header */}
        <div className="field" style={{ marginTop: 8 }}>
          <label>Header placement</label>
          <div style={{ marginLeft: 16 }}>
            <label className="radio-row">
              <input
                type="radio"
                name="headerPlacement"
                value="all"
                checked={docHeaderPlacement === 'all'}
                onChange={(e) => setDocHeaderPlacement(e.target.value)}
              />
              <span>
                <strong>All pages</strong>
                <small className="muted"> — header appears on every page</small>
              </span>
            </label>
            <label className="radio-row">
              <input
                type="radio"
                name="headerPlacement"
                value="first"
                checked={docHeaderPlacement === 'first'}
                onChange={(e) => setDocHeaderPlacement(e.target.value)}
              />
              <span>
                <strong>First page only</strong>
                <small className="muted"> — header appears only on the first content page</small>
              </span>
            </label>
            <label className="radio-row">
              <input
                type="radio"
                name="headerPlacement"
                value="last"
                checked={docHeaderPlacement === 'last'}
                onChange={(e) => setDocHeaderPlacement(e.target.value)}
              />
              <span>
                <strong>Last page only</strong>
                <small className="muted"> — header appears only on the last page</small>
              </span>
            </label>
            <label className="radio-row">
              <input
                type="radio"
                name="headerPlacement"
                value="none"
                checked={docHeaderPlacement === 'none'}
                onChange={(e) => setDocHeaderPlacement(e.target.value)}
              />
              <span>
                <strong>No header</strong>
                <small className="muted"> — header is hidden on all pages</small>
              </span>
            </label>
          </div>
        </div>

        {/* Footer placement — control which pages show the footer */}
        <div className="field" style={{ marginTop: 8 }}>
          <label>Footer placement</label>
          <div style={{ marginLeft: 16 }}>
            <label className="radio-row">
              <input
                type="radio"
                name="footerPlacement"
                value="all"
                checked={docFooterPlacement === 'all'}
                onChange={(e) => setDocFooterPlacement(e.target.value)}
              />
              <span>
                <strong>All pages</strong>
                <small className="muted"> — footer appears on every page</small>
              </span>
            </label>
            <label className="radio-row">
              <input
                type="radio"
                name="footerPlacement"
                value="first"
                checked={docFooterPlacement === 'first'}
                onChange={(e) => setDocFooterPlacement(e.target.value)}
              />
              <span>
                <strong>First page only</strong>
                <small className="muted"> — footer appears only on the first content page</small>
              </span>
            </label>
            <label className="radio-row">
              <input
                type="radio"
                name="footerPlacement"
                value="last"
                checked={docFooterPlacement === 'last'}
                onChange={(e) => setDocFooterPlacement(e.target.value)}
              />
              <span>
                <strong>Last page only</strong>
                <small className="muted"> — footer appears only on the last page</small>
              </span>
            </label>
            <label className="radio-row">
              <input
                type="radio"
                name="footerPlacement"
                value="none"
                checked={docFooterPlacement === 'none'}
                onChange={(e) => setDocFooterPlacement(e.target.value)}
              />
              <span>
                <strong>No footer</strong>
                <small className="muted"> — footer is hidden on all pages</small>
              </span>
            </label>
          </div>
        </div>

        {/* Section separator line — applies to the faint horizontal rule
            drawn between main sections and above Signature Control. */}
        <div className="field" style={{ marginTop: 8 }}>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={docSectionSeparator}
              onChange={(e) => setDocSectionSeparator(e.target.checked)}
            />
            <span>
              <strong>Show section separator lines</strong>
              <small className="muted"> — draws a faint horizontal rule between every numbered section and above Signature Control. Turn off for a cleaner, line-free look.</small>
            </span>
          </label>
        </div>

        {/* Page-number position — top of the page (header area) or
            bottom (just above the footer banner). */}
        <div className="field" style={{ marginTop: 8 }}>
          <label htmlFor="page-num-pos">Page number position</label>
          <select
            id="page-num-pos"
            value={docPageNumberPosition}
            onChange={(e) => setDocPageNumberPosition(e.target.value)}
          >
            <option value="bottom">Bottom of page (above footer)</option>
            <option value="top">Top of page (header area)</option>
          </select>
          <small className="muted">
            The cover page never shows a page number; numbering starts at <strong>1</strong> on the first body page either way.
          </small>
        </div>

        <div className="modal-section-title">Document typography</div>
        <small className="muted" style={{ display: 'block', marginBottom: 10 }}>
          Applies to every document generated for this company (Scope of Work and any future templates). Leave any size blank to use the placeholder default.
        </small>

        <div className="type-grid">
          <div className="field" style={{ gridColumn: 'span 4' }}>
            <label htmlFor="sow-font">Font family</label>
            <input
              id="sow-font"
              type="text"
              list="sow-font-options"
              value={sowFontFamily}
              onChange={(e) => setSowFontFamily(e.target.value)}
              placeholder="Arial"
            />
            <datalist id="sow-font-options">
              {[
                // Windows system fonts — pre-installed on every host.
                'Arial', 'Calibri', 'Times New Roman', 'Verdana', 'Georgia', 'Cambria', 'Tahoma', 'Helvetica', 'Segoe UI',
                // Google Fonts — render only when the matching TTF files are
                // dropped into the backend's `backend/fonts/` directory
                // (Poppins-Regular.ttf, Poppins-Bold.ttf, etc.).
                'Poppins', 'Montserrat', 'Inter', 'Roboto', 'Lato', 'Open Sans',
              ].map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
            <small className="muted">
              Google Fonts (Poppins, Montserrat, …) only render if their TTF files have been dropped into the backend's <code>backend/fonts/</code> folder.
            </small>
          </div>

          <div className="field">
            <label htmlFor="sow-body">Body size</label>
            <span className="input-affix affix-suffix">
              <input id="sow-body" type="number" min="8" max="24" step="1"
                     value={sowBodyFontSize} onChange={(e) => setSowBodyFontSize(e.target.value)} placeholder="12" />
              <span className="input-affix-symbol">pt</span>
            </span>
          </div>
          <div className="field">
            <label htmlFor="sow-h1">Heading 1</label>
            <span className="input-affix affix-suffix">
              <input id="sow-h1" type="number" min="8" max="36" step="1"
                     value={sowH1FontSize} onChange={(e) => setSowH1FontSize(e.target.value)} placeholder="14" />
              <span className="input-affix-symbol">pt</span>
            </span>
          </div>
          <div className="field">
            <label htmlFor="sow-h2">Heading 2</label>
            <span className="input-affix affix-suffix">
              <input id="sow-h2" type="number" min="8" max="36" step="1"
                     value={sowH2FontSize} onChange={(e) => setSowH2FontSize(e.target.value)} placeholder="13" />
              <span className="input-affix-symbol">pt</span>
            </span>
          </div>
          <div className="field">
            <label htmlFor="sow-h3">Heading 3</label>
            <span className="input-affix affix-suffix">
              <input id="sow-h3" type="number" min="8" max="36" step="1"
                     value={sowH3FontSize} onChange={(e) => setSowH3FontSize(e.target.value)} placeholder="12" />
              <span className="input-affix-symbol">pt</span>
            </span>
          </div>
        </div>

        <div className="field">
          <label style={{ display: 'block', marginBottom: 8 }}>Heading capitalisation</label>
          <div className="caps-toggle-grid">
            <label className="checkbox-row">
              <input type="checkbox" checked={docH1AllCaps} onChange={(e) => setDocH1AllCaps(e.target.checked)} />
              <span>Heading 1 in <strong>ALL CAPS</strong></span>
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={docH2AllCaps} onChange={(e) => setDocH2AllCaps(e.target.checked)} />
              <span>Heading 2 in <strong>ALL CAPS</strong></span>
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={docH3AllCaps} onChange={(e) => setDocH3AllCaps(e.target.checked)} />
              <span>Heading 3 in <strong>ALL CAPS</strong></span>
            </label>
          </div>
          <small className="muted">The company name on the SOW cover is always rendered in ALL CAPS.</small>
        </div>

        <div className="modal-section-title">Default Service Provider signatory</div>
        <small className="muted" style={{ display: 'block', marginBottom: 10 }}>
          Pre-fills the Service Provider rows on the SOW Signature Control page. The author of each SOW can still override any of these values per document.
        </small>
        <div className="field-row">
          <div className="field">
            <label htmlFor="sp-name">Name &amp; Surname</label>
            <input
              id="sp-name"
              type="text"
              value={sowProviderName}
              onChange={(e) => setSowProviderName(e.target.value)}
              placeholder="e.g. Armand Visagie"
            />
          </div>
          <div className="field">
            <label htmlFor="sp-desig">Post Designation</label>
            <input
              id="sp-desig"
              type="text"
              value={sowProviderDesignation}
              onChange={(e) => setSowProviderDesignation(e.target.value)}
              placeholder="e.g. Manager"
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="sp-loc">Location</label>
          <input
            id="sp-loc"
            type="text"
            value={sowProviderLocation}
            onChange={(e) => setSowProviderLocation(e.target.value)}
            placeholder="e.g. 318 The Hillside Building, Lynnwood, Pretoria, 0081"
          />
        </div>

        <div className="modal-section-title">Core values</div>
        <small className="muted" style={{ display: 'block', marginBottom: 10 }}>
          The values your company stands by — surfaced on generated documents that include a values section. Add as many or as few as you need.
        </small>
        <div className="core-values-list">
          {coreValues.length === 0 && (
            <div className="muted small" style={{ marginBottom: 6 }}>
              No core values yet.
            </div>
          )}
          {coreValues.map((v, idx) => (
            <div key={idx} className="core-values-row">
              <input
                type="text"
                value={v}
                onChange={(e) => updateCoreValue(idx, e.target.value)}
                placeholder="e.g. Integrity"
                maxLength={255}
              />
              <button
                type="button"
                className="btn-icon btn-icon-danger"
                title="Remove core value"
                onClick={() => removeCoreValue(idx)}
                aria-label={`Remove core value ${idx + 1}`}
              >
                ×
              </button>
            </div>
          ))}
          <button type="button" className="btn-ghost core-values-add" onClick={addCoreValue}>
            + Add core value
          </button>
        </div>

        <div className="modal-section-title">Company departments / Area</div>
        <small className="muted" style={{ display: 'block', marginBottom: 10 }}>
          The departments or business areas this company operates in (e.g. <em>Human Resources</em>, <em>Operations</em>, <em>New Business</em>). Used as the KPA dropdown when capturing a person's KPAs.
        </small>
        <div className="core-values-list">
          {companyFacets.length === 0 && (
            <div className="muted small" style={{ marginBottom: 6 }}>
              No departments yet.
            </div>
          )}
          {companyFacets.map((v, idx) => (
            <div key={idx} className="core-values-row">
              <input
                type="text"
                value={v}
                onChange={(e) => updateFacet(idx, e.target.value)}
                placeholder="e.g. Operations"
                maxLength={255}
              />
              <button
                type="button"
                className="btn-icon btn-icon-danger"
                title="Remove department"
                onClick={() => removeFacet(idx)}
                aria-label={`Remove department ${idx + 1}`}
              >
                ×
              </button>
            </div>
          ))}
          <button type="button" className="btn-ghost core-values-add" onClick={addFacet}>
            + Add department
          </button>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy || hexInvalid}>
            {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
