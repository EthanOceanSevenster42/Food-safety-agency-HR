import { useEffect, useRef, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api.js';
import { confirmDialog } from '../confirm.js';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const COLOR_PRESETS = [
  '#088298', '#1F4E79', '#2E7D32', '#7B1FA2', '#C62828',
  '#EF6C00', '#F9A825', '#5D4037', '#455A64', '#AD1457',
  '#0097A7', '#558B2F',
];

export default function ProcessModal({ mode = 'create', process, companyId, department = 'Procurement', presetTemplateId, presetName, onClose, onSave, onDelete }) {
  // `presetName` is filled by the whiteboard when the user clicks a
  // label-only ghost card — it pre-fills the task name with the
  // placeholder text so the workflow step keeps its sketched identity
  // even though no template is attached yet.
  const [name, setName] = useState(process?.name ?? presetName ?? '');
  const [description, setDescription] = useState(process?.description ?? '');
  const initialColor = process?.color ?? COLOR_PRESETS[0];
  const [color, setColor] = useState(initialColor);
  const [hexInput, setHexInput] = useState(initialColor);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Template picker — shown on every new task when we know the owner
  // company. Picking a template snapshots its content into the new
  // process's SowDataJson on the backend; "Blank" creates a task with
  // no SOW seeded (the SOW editor can still be opened later).
  //
  // When the modal is launched from a workflow ghost card on the
  // whiteboard the caller passes `presetTemplateId` so the picker (and
  // task name) come up pre-filled with the suggested next template.
  //
  // The task name auto-fills from the chosen template, but only while the
  // user hasn't typed a custom name yet — once they do, their text wins
  // and template changes leave the name alone. `userTouchedNameRef` tracks
  // that "has the user typed yet" intent across renders.
  const [sowTemplates, setSowTemplates] = useState([]);
  const [sowTemplateId, setSowTemplateId] = useState(presetTemplateId ? String(presetTemplateId) : '');
  // Treat a presetName the same as a user-typed name — locks the auto-
  // fill from template selection so the placeholder label survives.
  const userTouchedNameRef = useRef(mode === 'edit' || !!presetName);
  const showTemplatePicker = mode === 'create' && !!companyId;
  useEffect(() => {
    if (!showTemplatePicker) return;
    let cancelled = false;
    // Scope the picker to the current workspace's templates so HR
    // tasks can only choose HR templates and vice versa.
    api.listSowTemplates(companyId, department)
      .then((list) => {
        if (cancelled) return;
        const arr = Array.isArray(list) ? list : [];
        setSowTemplates(arr);
        setSowTemplateId((current) => {
          if (current) {
            // If we came in with a preset id, also seed the task name
            // from the matching template (only the first time, before
            // the user has touched the name field).
            if (presetTemplateId && !userTouchedNameRef.current) {
              const t = arr.find((x) => String(x.id) === String(current));
              if (t) setName(t.name || '');
            }
            return current;
          }
          // Default to the first template only if there's no name typed
          // yet — that way the auto-fill below seeds a sensible task name.
          const def = arr.find((t) => t.isDefault);
          if (def && !userTouchedNameRef.current) {
            setName(def.name || '');
            return String(def.id);
          }
          return '';
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [showTemplatePicker, companyId, presetTemplateId]);

  function onTemplateChange(value) {
    setSowTemplateId(value);
    // Auto-fill the task name from the picked template (or clear it when
    // Blank is chosen), but only if the user hasn't typed a custom name.
    if (userTouchedNameRef.current) return;
    if (!value) { setName(''); return; }
    const t = sowTemplates.find((x) => String(x.id) === String(value));
    if (t) setName(t.name || '');
  }
  function onNameChange(value) {
    userTouchedNameRef.current = true;
    setName(value);
  }

  function applyColor(hex) {
    setColor(hex);
    setHexInput(hex);
  }

  function commitHex(value) {
    const trimmed = value.trim();
    setHexInput(trimmed);
    if (HEX_RE.test(trimmed)) setColor(trimmed.toLowerCase());
  }

  const hexInvalid = hexInput !== '' && !HEX_RE.test(hexInput);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setErr('');
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        color: color || null,
        // Only pass the template id when this is a brand-new Scope of
        // Service task — editing a task doesn't replace its existing SOW.
        ...(showTemplatePicker && sowTemplateId ? { sowTemplateId: Number(sowTemplateId) } : {}),
      });
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!(await confirmDialog({
      title: `Delete "${process.name}"?`,
      body: 'The task and its documents are removed from the whiteboard.',
      tone: 'danger',
      confirmLabel: 'Delete task',
    }))) return;
    setBusy(true);
    setErr('');
    try {
      await onDelete();
    } catch (error) {
      setErr(error.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={mode === 'edit' ? 'Edit task' : 'New task'} onClose={onClose}>
      <form onSubmit={submit}>
        {err && <div className="error">{err}</div>}

        {showTemplatePicker && (
          <div className="field">
            <label htmlFor="proc-template">Start from</label>
            <select
              id="proc-template"
              autoFocus
              value={sowTemplateId}
              onChange={(e) => onTemplateChange(e.target.value)}
            >
              <option value="">Blank (no template)</option>
              {sowTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.isDefault ? ' · default' : ''}
                  {!t.isOwned ? ` · shared from ${t.ownerCompanyName}` : ''}
                </option>
              ))}
            </select>
            <small className="muted">
              {sowTemplateId
                ? "The template's content is copied into the new task. Later edits to the template don't affect this task."
                : 'A blank task has no SOW seeded — you can still fill one in from the task card later.'}
            </small>
          </div>
        )}

        <div className="field">
          <label htmlFor="proc-name">Task name</label>
          <input
            id="proc-name"
            type="text"
            required
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={sowTemplateId ? 'Auto-filled from template — change if needed' : 'e.g. AFMA Application Take-over'}
          />
        </div>

        <div className="field">
          <label htmlFor="proc-desc">Description</label>
          <textarea
            id="proc-desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short note about what this step covers"
          />
        </div>

        <div className="field">
          <label>Colour</label>
          <div className="color-presets" role="group" aria-label="Task colour">
            {COLOR_PRESETS.map((hex) => (
              <button
                type="button"
                key={hex}
                className={'color-swatch' + (color === hex ? ' selected' : '')}
                style={{ background: hex }}
                onClick={() => applyColor(hex)}
                aria-label={`Use ${hex}`}
                aria-pressed={color === hex}
              />
            ))}
          </div>
          <div className="color-custom-row">
            <input
              type="color"
              value={HEX_RE.test(color) ? color : '#088298'}
              onChange={(e) => applyColor(e.target.value)}
              aria-label="Custom colour"
            />
            <input
              type="text"
              className={'color-hex-input' + (hexInvalid ? ' is-invalid' : '')}
              value={hexInput}
              onChange={(e) => commitHex(e.target.value)}
              placeholder="#2e6f81"
              maxLength={7}
              spellCheck="false"
            />
            {hexInvalid && <small className="error-text">Use a #RRGGBB hex value</small>}
          </div>
        </div>

        <div className="modal-actions">
          {mode === 'edit' && onDelete && (
            <button
              type="button"
              className="btn-ghost danger"
              style={{ marginRight: 'auto' }}
              onClick={handleDelete}
              disabled={busy}
            >
              Delete
            </button>
          )}
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Add task'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
