import PDFDocument from 'pdfkit';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { UPLOAD_DIR } from './upload.js';

const INK = '#0F1A1F';
const MUTED = '#6B7B82';
const HAIRLINE = '#E4E8EB';
const FALLBACK_BRAND = '#088298';

export function repairReference(assetId, bookedInAt) {
  const date = bookedInAt ? new Date(bookedInAt) : new Date();
  const seconds = Math.floor(date.getTime() / 1000);
  return `REP-${assetId}-${seconds.toString(36).toUpperCase()}`;
}

export function generateRepairDocket({ asset, company, owner, problem, supplier, coordinator, reference, notes = [] }) {
  return new Promise((resolve, reject) => {
    const filename = `repair-docket-${asset.Id}-${crypto.randomBytes(6).toString('hex')}.pdf`;
    const filepath = path.join(UPLOAD_DIR, filename);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(filepath);
    stream.on('finish', () => resolve(filename));
    stream.on('error', reject);
    doc.pipe(stream);

    const brandColor = company.BrandColor || FALLBACK_BRAND;
    const pageWidth = doc.page.width;

    // Brand stripe
    doc.rect(0, 0, pageWidth, 6).fill(brandColor);

    let y = 50;

    // Header: company logo (left) + title (right)
    if (company.LogoFile) {
      const logoPath = path.join(UPLOAD_DIR, company.LogoFile);
      if (fs.existsSync(logoPath)) {
        try { doc.image(logoPath, 50, y, { fit: [120, 50] }); } catch {}
      }
    }

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(22).text('REPAIR DOCKET', 0, y, { align: 'right', width: pageWidth - 50 });
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      .text(`Ref ${reference}`, 0, y + 28, { align: 'right', width: pageWidth - 50 });
    doc.fontSize(9).fillColor(MUTED)
      .text(new Date().toLocaleString(), 0, y + 42, { align: 'right', width: pageWidth - 50 });

    y = 120;
    doc.moveTo(50, y).lineTo(pageWidth - 50, y).strokeColor(HAIRLINE).lineWidth(0.5).stroke();
    y += 18;

    function sectionHeader(label) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(brandColor).text(label, 50, y);
      y += 16;
    }

    function field(label, value, opts = {}) {
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(label.toUpperCase(), 50, y, { width: 130, ...opts });
      doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(value || '—', 180, y, { width: pageWidth - 230 });
      const lineHeight = doc.heightOfString(value || '—', { width: pageWidth - 230 });
      y += Math.max(20, lineHeight + 6);
    }

    function blockField(label, value) {
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(label.toUpperCase(), 50, y);
      y += 14;
      doc.font('Helvetica').fontSize(11).fillColor(INK).text(value || '—', 50, y, { width: pageWidth - 100, align: 'left' });
      y = doc.y + 14;
    }

    sectionHeader('ASSET');
    field('Company', company.Name);
    field('Asset', asset.Name);
    field('Type / Category', `${asset.Type || '—'}  ·  ${asset.Category}`);
    field('Serial Number', asset.SerialNumber || '—');
    field('Asset Tag', asset.AssetTag || '—');
    if (asset.PurchaseDate) {
      const d = new Date(asset.PurchaseDate);
      field('Purchase Date', d.toISOString().slice(0, 10));
    }

    y += 4;
    doc.moveTo(50, y).lineTo(pageWidth - 50, y).strokeColor(HAIRLINE).stroke();
    y += 16;

    sectionHeader('REPAIR');
    field('Booked In', new Date().toISOString().slice(0, 16).replace('T', ' '));
    field('Supplier', supplier || 'To be confirmed');
    if (owner?.Name) field('Owner', `${owner.Name}${owner.Title ? ' · ' + owner.Title : ''}`);
    if (owner?.Email) field('Owner email', owner.Email);

    y += 4;
    blockField('Problem reported', problem);

    // Repair notes — every note recorded against this repair in chronological
    // order. PDFKit's `text(...)` auto-flows onto a new page when the cursor
    // would otherwise spill below the bottom margin, so a very chatty repair
    // is fine. Before we start a fresh note we still reserve ~180pt at the
    // bottom of the page for the signature lines + footer; if a note's
    // header line would land in that zone we advance to a fresh page first.
    if (Array.isArray(notes) && notes.length > 0) {
      y += 6;
      doc.moveTo(50, y).lineTo(pageWidth - 50, y).strokeColor(HAIRLINE).stroke();
      y += 14;
      sectionHeader('REPAIR NOTES');

      for (const note of notes) {
        if (y > doc.page.height - 180) {
          doc.addPage();
          y = 50;
        }
        const dateStr = note.createdAt
          ? new Date(note.createdAt).toISOString().replace('T', ' ').slice(0, 16)
          : '';
        // Author left, date right on the same baseline.
        doc.font('Helvetica-Bold').fontSize(10).fillColor(INK)
          .text(note.author || 'Unknown', 50, y, { width: 300, lineBreak: false });
        doc.font('Helvetica').fontSize(9).fillColor(MUTED)
          .text(dateStr, 0, y + 1, { align: 'right', width: pageWidth - 50, lineBreak: false });
        y += 14;
        // Message body — wraps inside the column width and pushes y forward.
        doc.font('Helvetica').fontSize(10).fillColor(INK)
          .text(note.message || '', 50, y, { width: pageWidth - 100 });
        y = doc.y + 10;
      }

      // If the notes ran right up to where the signature lines would
      // normally sit, push them onto a fresh page so they don't overlap.
      if (y > doc.page.height - 180) {
        doc.addPage();
      }
    }

    // Notify on updates — single point of contact (the system's repair coordinator).
    // Suppliers reply here with status updates; the coordinator forwards them into the system.
    if (coordinator?.email) {
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('NOTIFY ON UPDATES', 50, y);
      y += 14;
      doc.font('Helvetica-Bold').fontSize(12).fillColor(INK)
        .text(coordinator.email, 50, y);
      y = doc.y + 2;
      if (coordinator.name) {
        doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(coordinator.name, 50, y);
        y = doc.y + 2;
      }
      doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED)
        .text('Please direct all repair correspondence and status updates to the contact above.', 50, y, {
          width: pageWidth - 100,
        });
      y = doc.y + 12;
    }

    // Signature lines at the bottom
    const sigY = doc.page.height - 130;
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('SUPPLIER NAME', 50, sigY);
    doc.moveTo(50, sigY + 28).lineTo(280, sigY + 28).strokeColor(MUTED).lineWidth(0.5).stroke();
    doc.text('SUPPLIER SIGNATURE / DATE', 320, sigY);
    doc.moveTo(320, sigY + 28).lineTo(pageWidth - 50, sigY + 28).strokeColor(MUTED).stroke();

    // Footer
    doc.font('Helvetica').fontSize(8).fillColor('#9AA6AC').text(
      `FSA HR Portal · Ref ${reference} · Last updated ${new Date().toLocaleString()}`,
      50,
      doc.page.height - 40,
      { width: pageWidth - 100, align: 'center' }
    );

    doc.end();
  });
}
