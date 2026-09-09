import { useState } from 'react';
import Modal from './Modal.jsx';
import { confirmDialog } from '../confirm.js';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const COLOR_PRESETS = [
  '#088298', // teal (FSA brand)
  '#1F4E79', // deep blue
  '#2E7D32', // forest green
  '#7B1FA2', // purple
  '#C62828', // red
  '#EF6C00', // orange
  '#F9A825', // amber
  '#5D4037', // brown
  '#455A64', // slate
  '#AD1457', // magenta
];

export default function ProjectModal({ mode = 'create', project, onClose, onSave, onDelete }) {
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [color, setColor] = useState(project?.color ?? COLOR_PRESETS[0]);
  const [hexInput, setHexInput] = useState(project?.color ?? COLOR_PRESETS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

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
      });
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!(await confirmDialog({
      title: `Delete project "${project.name}"?`,
      body: 'Its tasks and documents go with it. This cannot be undone.',
      tone: 'danger',
      confirmLabel: 'Delete project',
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
    <Modal title={mode === 'edit' ? 'Edit Project' : 'New Project'} onClose={onClose}>
      <form onSubmit={submit}>
        {err && <div className="error">{err}</div>}

        <div className="field">
          <label htmlFor="proj-name">Project name</label>
          <input
            id="proj-name"
            type="text"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Office refurbishment 2026"
          />
        </div>

        <div className="field">
          <label htmlFor="proj-desc">Description</label>
          <textarea
            id="proj-desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short summary of the project's purpose, scope or stakeholders"
          />
        </div>

        <div className="field">
          <label>Colour</label>
          <div className="color-presets" role="group" aria-label="Project colour">
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
            {busy ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create project'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
