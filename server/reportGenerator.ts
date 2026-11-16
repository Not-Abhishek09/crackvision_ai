import PDFDocument from 'pdfkit';
import type { InspectionRecord } from './types.ts';

export async function generateInspectionPdf(params: {
  record: InspectionRecord;
  originalImageBuffer: Buffer;
  crackAnnotatedBuffer?: Buffer | null;
  helmetAnnotatedBuffer?: Buffer | null;
}): Promise<Buffer> {
  const { record, originalImageBuffer, crackAnnotatedBuffer, helmetAnnotatedBuffer } = params;

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 42,
      info: {
        Title: `Construction Vision Inspection Report - ${record.id}`,
        Author: record.inspector_name,
        Subject: `${record.mode.toUpperCase()} Inspection - ${record.site_name}`,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;

    const drawSectionHeader = (title: string, badge?: string) => {
      if (doc.y > doc.page.height - 140) {
        doc.addPage();
      }
      doc.moveDown(0.5);
      const y = doc.y;
      doc.rect(left, y, pageWidth, 24).fill('#161A22');
      doc.rect(left, y, 4, 24).fill('#FACC15');
      doc
        .fillColor('#F3F4F6')
        .font('Helvetica-Bold')
        .fontSize(10.5)
        .text(title, left + 12, y + 6, { continued: Boolean(badge) });
      if (badge) {
        doc
          .fillColor('#FACC15')
          .font('Helvetica-Bold')
          .fontSize(9)
          .text(`  |  ${badge}`);
      }
      doc.y = y + 32;
      doc.fillColor('#111827');
    };

    const drawKeyValueRow = (label: string, value: string, yOffset?: number) => {
      const y = yOffset ?? doc.y;
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#374151').text(label, left, y, { width: 155 });
      doc.font('Helvetica').fontSize(9).fillColor('#111827').text(value, left + 160, y, { width: pageWidth - 160 });
      doc.y = Math.max(doc.y, y + 14);
    };

    // Header Banner
    doc.rect(0, 0, doc.page.width, 72).fill('#0E1116');
    doc.rect(0, 70, doc.page.width, 3).fill('#FACC15');
    doc
      .fillColor('#FACC15')
      .font('Helvetica-Bold')
      .fontSize(16)
      .text('CONSTRUCTION VISION', left, 18);
    doc
      .fillColor('#D1D5DB')
      .font('Helvetica')
      .fontSize(9.5)
      .text('Automated Structural Crack & Worker Safety Inspection Report', left, 38);
    doc
      .fillColor('#9CA3AF')
      .font('Helvetica')
      .fontSize(8.5)
      .text(`Report ID: ${record.id}`, left, 22, { align: 'right', width: pageWidth });
    doc
      .fillColor('#9CA3AF')
      .font('Helvetica')
      .fontSize(8.5)
      .text(`Generated: ${new Date(record.created_at).toUTCString()}`, left, 36, {
        align: 'right',
        width: pageWidth,
      });

    doc.y = 88;

    // 1. GENERAL INFORMATION
    drawSectionHeader('1. GENERAL INFORMATION', record.status.toUpperCase());
    drawKeyValueRow('Inspection ID:', record.id);
    drawKeyValueRow('Date & Time (ISO):', record.created_at);
    drawKeyValueRow('Inspection Type:', record.mode.toUpperCase());
    drawKeyValueRow('Input Source:', record.source_type.toUpperCase());
    drawKeyValueRow('Site / Zone:', `${record.site_name} — ${record.zone_label}`);
    drawKeyValueRow('Inspector:', record.inspector_name);
    drawKeyValueRow('Inspection Status:', record.status);
    drawKeyValueRow('AI Inference Engine:', `${record.inference_engine} (${record.processing_time_ms} ms)`);
    drawKeyValueRow('Image Resolution:', `${record.image_width} x ${record.image_height} px`);

    doc.moveDown(0.5);
    if (doc.y > doc.page.height - 230) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#374151').text('Original Inspection Image:', left, doc.y);
    doc.moveDown(0.3);
    const origImgY = doc.y;
    doc.image(originalImageBuffer, left, origImgY, {
      fit: [pageWidth, 185],
      align: 'center',
    });
    doc.y = origImgY + 195;

    // 2. STRUCTURAL INSPECTION
    if (record.crack_results) {
      const cracks = record.crack_results;
      const crackStatusLabel = cracks.module_error
        ? 'MODULE ERROR'
        : cracks.total_cracks > 0
          ? 'CRACKS DETECTED'
          : cracks.image_quality === 'uncertain'
            ? 'UNCERTAIN RESULT'
            : 'NO CRACKS DETECTED';
      drawSectionHeader('2. STRUCTURAL INSPECTION', `${crackStatusLabel} · EST. SEVERITY: ${cracks.estimated_overall_severity.toUpperCase()}`);
      drawKeyValueRow('Detection Status:', crackStatusLabel);
      drawKeyValueRow('Total Cracks Detected:', String(cracks.total_cracks));
      drawKeyValueRow('Estimated Overall Severity:', `${cracks.estimated_overall_severity} (AI-generated estimate)`);
      drawKeyValueRow(
        'Avg. Model-Reported Conf.:',
        cracks.average_model_confidence !== null
          ? `${(cracks.average_model_confidence * 100).toFixed(1)}% (model-reported certainty)`
          : 'N/A (No cracks detected)',
      );
      if (cracks.image_quality === 'uncertain' && cracks.uncertain_reason) {
        drawKeyValueRow('Image Quality Warning:', cracks.uncertain_reason);
      }
      drawKeyValueRow('Analysis Notes:', cracks.notes);

      if (cracks.detections.length > 0) {
        doc.moveDown(0.4);
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827').text('Detected Crack Locations & Scores:', left);
        doc.moveDown(0.25);

        for (const det of cracks.detections) {
          if (doc.y > doc.page.height - 70) doc.addPage();
          const line = `${det.id} | ${det.classification} | Severity: ${det.severity} | Model-Reported Conf: ${(det.model_reported_confidence * 100).toFixed(1)}% | Box(px): [${det.pixel_box.x}, ${det.pixel_box.y}, ${det.pixel_box.width}x${det.pixel_box.height}] — ${det.location_description}`;
          doc.font('Helvetica').fontSize(8.2).fillColor('#1F2937').text(line, left + 8, doc.y, { width: pageWidth - 8 });
          doc.moveDown(0.2);
        }
      }

      if (crackAnnotatedBuffer) {
        doc.moveDown(0.4);
        if (doc.y > doc.page.height - 230) doc.addPage();
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#374151').text('Annotated Structural Crack Image (Yellow Bounding Boxes):', left);
        doc.moveDown(0.3);
        const imgY = doc.y;
        doc.image(crackAnnotatedBuffer, left, imgY, {
          fit: [pageWidth, 185],
          align: 'center',
        });
        doc.y = imgY + 195;
      }

      doc
        .font('Helvetica-Oblique')
        .fontSize(8)
        .fillColor('#6B7280')
        .text(`Note: ${cracks.severity_disclaimer}`, left, doc.y, { width: pageWidth });
      doc.moveDown(0.5);
    }

    // 3. WORKER SAFETY INSPECTION
    if (record.helmet_results) {
      const helmets = record.helmet_results;
      const complianceStr =
        helmets.helmet_compliance_percent !== null
          ? `${helmets.helmet_compliance_percent.toFixed(1)}%`
          : 'N/A (0 workers)';

      drawSectionHeader('3. WORKER SAFETY INSPECTION', `COMPLIANCE: ${complianceStr}`);
      drawKeyValueRow('Total Workers Detected:', String(helmets.total_workers));
      drawKeyValueRow('Workers Wearing Helmets:', `${helmets.workers_wearing_helmet} (Green - Compliant)`);
      drawKeyValueRow('Workers Without Helmets:', `${helmets.workers_without_helmet} (Red - Potential Violation)`);
      drawKeyValueRow('Uncertain Detections:', `${helmets.uncertain_detections} (Orange - Manual Verification)`);
      drawKeyValueRow('Helmet Compliance %:', `${complianceStr}  [(With Helmet / Total Workers) x 100]`);
      drawKeyValueRow('Analysis Notes:', helmets.notes);

      if (helmets.detections.length > 0) {
        doc.moveDown(0.35);
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827').text('Worker Detections & Classification:', left);
        doc.moveDown(0.25);
        for (const w of helmets.detections) {
          if (doc.y > doc.page.height - 70) doc.addPage();
          const line = `${w.id} | ${w.classification.toUpperCase()} | Model-Reported Conf: ${(w.model_reported_confidence * 100).toFixed(1)}% | Box(px): [${w.pixel_box.x}, ${w.pixel_box.y}, ${w.pixel_box.width}x${w.pixel_box.height}] — ${w.reason}`;
          doc.font('Helvetica').fontSize(8.2).fillColor('#1F2937').text(line, left + 8, doc.y, { width: pageWidth - 8 });
          doc.moveDown(0.2);
        }
      }

      if (helmets.violations.length > 0) {
        doc.moveDown(0.35);
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#B91C1C').text('Potential Safety Violations:', left);
        doc.moveDown(0.2);
        for (const v of helmets.violations) {
          doc.font('Helvetica').fontSize(8.5).fillColor('#991B1B').text(`• ${v}`, left + 8, doc.y, { width: pageWidth - 8 });
          doc.moveDown(0.15);
        }
      }

      if (helmetAnnotatedBuffer) {
        doc.moveDown(0.4);
        if (doc.y > doc.page.height - 230) doc.addPage();
        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .fillColor('#374151')
          .text('Annotated Worker Helmet Detection Image (Green=Compliant, Red=No Helmet, Orange=Uncertain):', left);
        doc.moveDown(0.3);
        const imgY = doc.y;
        doc.image(helmetAnnotatedBuffer, left, imgY, {
          fit: [pageWidth, 185],
          align: 'center',
        });
        doc.y = imgY + 195;
      }
    }

    // 4. FINAL SUMMARY
    drawSectionHeader('4. FINAL SUMMARY & RECOMMENDED ACTIONS');
    const renderBulletGroup = (heading: string, items: string[], color = '#111827') => {
      if (items.length === 0) return;
      if (doc.y > doc.page.height - 90) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(color).text(heading, left);
      doc.moveDown(0.2);
      for (const item of items) {
        doc.font('Helvetica').fontSize(8.6).fillColor('#1F2937').text(`• ${item}`, left + 8, doc.y, { width: pageWidth - 8 });
        doc.moveDown(0.15);
      }
      doc.moveDown(0.3);
    };

    renderBulletGroup('Structural Inspection Findings', record.summary.structural_findings);
    renderBulletGroup('Worker Safety Findings', record.summary.worker_safety_findings);
    renderBulletGroup('Potential Hazards', record.summary.potential_hazards, '#B91C1C');
    renderBulletGroup('Recommended Corrective Actions', record.summary.recommended_actions);
    renderBulletGroup('Manual Verification Warnings', record.summary.manual_verification_warnings, '#B45309');

    doc.end();
  });
}
