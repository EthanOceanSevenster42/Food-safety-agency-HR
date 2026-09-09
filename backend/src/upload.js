import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

export const UPLOAD_DIR = path.resolve('uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const id = crypto.randomBytes(12).toString('hex');
    cb(null, `${id}${ext}`);
  },
});

const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif'];
// Documents accepted by the signed-copy endpoint (per-version upload).
// PDFs are the primary case but we also accept the same image types in
// case the user scans the signature into a PNG / JPEG instead.
const ALLOWED_DOCS = [...ALLOWED, 'application/pdf'];

export const upload = multer({
  storage,
  // 20 MB per file — generous for high-res header/footer banner PNGs.
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ALLOWED.includes(file.mimetype);
    cb(ok ? null : new Error('Only PNG, JPEG, WebP, SVG or GIF images are allowed'), ok);
  },
});

// Separate multer instance for endpoints that need to accept PDFs as
// well as images — used for the per-version "signed copy" upload. 25 MB
// limit because scanned multi-page contracts can run into the tens of
// megabytes.
export const uploadDoc = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ALLOWED_DOCS.includes(file.mimetype);
    cb(ok ? null : new Error('Only PDF, PNG, JPEG, WebP, SVG or GIF files are allowed'), ok);
  },
});

export function deleteUpload(filename) {
  if (!filename) return;
  fs.unlink(path.join(UPLOAD_DIR, filename), () => {});
}
