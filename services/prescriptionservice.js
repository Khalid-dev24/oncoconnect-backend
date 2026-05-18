// backend/services/prescriptionService.js
// Digital Prescription PDF Generation Service

const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

class PrescriptionService {
  /**
   * Generate prescription PDF with QR code
   */
  static async generatePrescriptionPDF(
    prescriptionData,
    outputPath = null
  ) {
    return new Promise(async (resolve, reject) => {
      try {
        const {
          prescriptionID,
          doctorName,
          doctorMDCN,
          doctorPhone,
          patientName,
          patientAge,
          patientID,
          dateIssued,
          medications,
          notes,
          watermark = 'DIGITAL PRESCRIPTION',
        } = prescriptionData;

        // Generate QR code
        const qrCode = await QRCode.toDataURL(
          JSON.stringify({
            prescriptionID,
            doctorMDCN,
            patientID,
            dateIssued,
          }),
          {
            errorCorrectionLevel: 'H',
            type: 'image/png',
            quality: 0.95,
            margin: 1,
            width: 300,
          }
        );

        // Create PDF
        const doc = new PDFDocument({
          size: 'A4',
          margin: 50,
        });

        // Set up file path
        const fileName = `prescription_${prescriptionID}.pdf`;
        const filePath =
          outputPath ||
          path.join(__dirname, '../../uploads/prescriptions', fileName);

        // Create stream
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        // Header with hospital letterhead
        doc
          .fontSize(20)
          .font('Helvetica-Bold')
          .text('OncoConnect', 50, 50, { align: 'center' });
        doc
          .fontSize(12)
          .font('Helvetica')
          .text('Professional Oncology Care Platform', { align: 'center' });
        doc
          .fontSize(10)
          .text('Lagos, Nigeria', { align: 'center' });
        doc
          .fontSize(10)
          .text('support@oncoconnect.ng', { align: 'center' });

        // Watermark
        doc
          .fontSize(60)
          .opacity(0.1)
          .text(watermark, 150, 300, { align: 'center', angle: 45 });
        doc.opacity(1);

        // Divider line
        doc
          .moveTo(50, 150)
          .lineTo(545, 150)
          .stroke('#0B8F8F');

        // Prescription title
        doc.moveDown(0.5);
        doc
          .fontSize(16)
          .font('Helvetica-Bold')
          .text('DIGITAL PRESCRIPTION', { align: 'center' });
        doc
          .fontSize(10)
          .font('Helvetica')
          .text('(QR Code Verified)', { align: 'center' });

        // Doctor information
        doc.moveDown();
        doc
          .fontSize(11)
          .font('Helvetica-Bold')
          .text('Prescriber Information', 50, doc.y);
        doc
          .fontSize(10)
          .font('Helvetica')
          .text(`Dr. ${doctorName}`, 70, doc.y);
        doc.text(`MDCN: ${doctorMDCN}`, 70, doc.y);
        doc.text(`Phone: ${doctorPhone}`, 70, doc.y);

        // Patient information
        doc
          .fontSize(11)
          .font('Helvetica-Bold')
          .text('Patient Information', 50, doc.y + 10);
        doc
          .fontSize(10)
          .font('Helvetica')
          .text(`Name: ${patientName}`, 70, doc.y);
        doc.text(`Patient ID: ${patientID}`, 70, doc.y);
        doc.text(`Age: ${patientAge}`, 70, doc.y);

        // Date issued
        doc
          .fontSize(11)
          .font('Helvetica-Bold')
          .text('Date Issued', 50, doc.y + 10);
        doc
          .fontSize(10)
          .font('Helvetica')
          .text(new Date(dateIssued).toLocaleDateString(), 70, doc.y);

        // QR Code section
        doc
          .fontSize(11)
          .font('Helvetica-Bold')
          .text('Verification QR Code', 300, 200);
        doc
          .fontSize(9)
          .font('Helvetica')
          .text('Scan at pharmacy to verify', 300, 220);

        // Add QR code image
        doc.image(qrCode, 310, 235, { width: 180, height: 180 });

        // Prescription ID
        doc
          .fontSize(9)
          .text(`ID: ${prescriptionID}`, 310, 420, { align: 'center' });

        // Medications section
        doc
          .fontSize(12)
          .font('Helvetica-Bold')
          .text('MEDICATIONS', 50, 440);

        // Table header
        doc
          .fontSize(10)
          .font('Helvetica-Bold')
          .text('Drug Name', 60, 460);
        doc.text('Strength', 220, 460);
        doc.text('Frequency', 320, 460);
        doc.text('Duration', 420, 460);

        // Divider
        doc
          .moveTo(50, 478)
          .lineTo(545, 478)
          .stroke('#CCCCCC');

        // Medications rows
        let currentY = 490;
        doc.font('Helvetica');
        medications.forEach((med, idx) => {
          if (currentY > 700) {
            // Add new page if needed
            doc.addPage();
            currentY = 50;
          }

          doc
            .fontSize(10)
            .text(med.name, 60, currentY, { width: 150 });
          doc.text(med.dosage, 220, currentY, { width: 90 });
          doc.text(med.frequency || 'As directed', 320, currentY, { width: 90 });
          doc.text(med.duration || '30 days', 420, currentY, { width: 100 });

          // Divider between medications
          doc
            .moveTo(50, currentY + 22)
            .lineTo(545, currentY + 22)
            .stroke('#EEEEEE');

          currentY += 30;
        });

        // Notes section
        doc
          .fontSize(11)
          .font('Helvetica-Bold')
          .text('Special Instructions', 50, currentY + 20);
        doc
          .fontSize(10)
          .font('Helvetica')
          .text(
            notes ||
              'Take medications as prescribed. Report any adverse reactions to your doctor immediately.',
            50,
            currentY + 40,
            { width: 495 }
          );

        // Pharmacy guidance
        doc
          .fontSize(11)
          .font('Helvetica-Bold')
          .text('For Pharmacy', 50, currentY + 100);
        doc
          .fontSize(9)
          .font('Helvetica')
          .text(
            '• Verify prescription by scanning QR code above',
            60,
            currentY + 120
          );
        doc.text('• Check patient ID matches prescription', 60, doc.y);
        doc.text(
          '• Dispense only medications listed in this prescription',
          60,
          doc.y
        );
        doc.text(
          '• Contact prescriber immediately if unable to verify',
          60,
          doc.y
        );

        // Footer
        const footerY = doc.page.height - 50;
        doc
          .fontSize(9)
          .text(
            'This is a digitally signed prescription. Pharmacies must verify the QR code before dispensing medications.',
            50,
            footerY,
            { align: 'center' }
          );
        doc.text(
          `Generated on OncoConnect | ${new Date().toLocaleString()}`,
          footerY + 20,
          { align: 'center' }
        );

        // Finalize PDF
        doc.end();

        // Resolve when stream finishes
        stream.on('finish', () => {
          resolve({
            success: true,
            filePath: filePath,
            fileName: fileName,
            fileSize: fs.statSync(filePath).size,
          });
        });

        stream.on('error', (error) => {
          reject({
            success: false,
            error: error.message,
          });
        });
      } catch (error) {
        reject({
          success: false,
          error: error.message,
        });
      }
    });
  }

  /**
   * Generate multiple prescriptions (batch)
   */
  static async generateBatchPrescriptions(prescriptions) {
    const results = [];
    for (const prescription of prescriptions) {
      try {
        const result = await this.generatePrescriptionPDF(prescription);
        results.push(result);
      } catch (error) {
        results.push(error);
      }
    }
    return results;
  }

  /**
   * Create prescription data object
   */
  static createPrescriptionData(
    prescriptionID,
    doctorName,
    doctorMDCN,
    doctorPhone,
    patientName,
    patientAge,
    patientID,
    medications,
    notes = ''
  ) {
    return {
      prescriptionID,
      doctorName,
      doctorMDCN,
      doctorPhone,
      patientName,
      patientAge,
      patientID,
      dateIssued: new Date(),
      medications, // Array of {name, dosage, frequency, duration}
      notes,
      watermark: 'DIGITAL PRESCRIPTION',
    };
  }
}

module.exports = PrescriptionService;