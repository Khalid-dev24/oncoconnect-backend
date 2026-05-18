// backend/routes/notifications.js
const express = require('express');
const NotificationService = require('../services/notificationService');
const PrescriptionService = require('../services/prescriptionService');

const router = express.Router();

// ==========================================
// CONSULTATION OPENED
// POST /api/notifications/consultation-opened
// ==========================================
router.post('/consultation-opened', async (req, res) => {
  try {
    const {
      doctorEmail,
      doctorName,
      patientName,
      patientEmail,
      amount,
      windowHours,
      transactionID,
    } = req.body;

    const doctorEmailResult = await NotificationService.consultationOpened(
      doctorEmail,
      doctorName,
      patientName,
      amount,
      windowHours,
      transactionID
    );

    const patientEmailResult = await NotificationService.paymentConfirmed(
      patientEmail,
      patientName,
      doctorName,
      amount,
      windowHours,
      transactionID
    );

    res.json({
      success: true,
      notifications: {
        doctorEmail: doctorEmailResult,
        patientEmail: patientEmailResult,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
});


// ==========================================
// PRESCRIPTION SENT
// POST /api/notifications/prescription-sent
// ==========================================
router.post('/prescription-sent', async (req, res) => {
  try {
    const {
      prescriptionID,
      doctorName,
      doctorMDCN,
      doctorPhone,
      patientName,
      patientAge,
      patientID,
      patientEmail,
      medications,
      notes,
    } = req.body;

    const prescriptionData = PrescriptionService.createPrescriptionData(
      prescriptionID,
      doctorName,
      doctorMDCN,
      doctorPhone,
      patientName,
      patientAge,
      patientID,
      medications,
      notes
    );

    const pdfResult = await PrescriptionService.generatePrescriptionPDF(
      prescriptionData
    );

    if (!pdfResult.success) {
      throw new Error('Failed to generate prescription PDF');
    }

    const emailResult = await NotificationService.prescriptionSent(
      patientEmail,
      patientName,
      doctorName,
      medications,
      prescriptionID
    );

    res.json({
      success: true,
      prescription: {
        id: prescriptionID,
        filePath: pdfResult.filePath,
        fileName: pdfResult.fileName,
      },
      email: emailResult,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
});


// ==========================================
// WELCOME DOCTOR
// POST /api/notifications/doctor-welcome
// ==========================================
router.post('/doctor-welcome', async (req, res) => {
  try {
    const { doctorName, doctorEmail, inviteCode } = req.body;

    const emailResult = await NotificationService.doctorWelcome(
      doctorEmail,
      doctorName,
      inviteCode
    );

    res.json({ success: true, email: emailResult });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// ==========================================
// WELCOME PATIENT
// POST /api/notifications/patient-welcome
// ==========================================
router.post('/patient-welcome', async (req, res) => {
  try {
    const { patientName, patientEmail, doctorName } = req.body;

    const emailResult = await NotificationService.patientWelcome(
      patientEmail,
      patientName,
      doctorName
    );

    res.json({ success: true, email: emailResult });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// ==========================================
// PAYMENT CONFIRMED
// POST /api/notifications/payment-confirmed
// ==========================================
router.post('/payment-confirmed', async (req, res) => {
  try {
    const {
      patientEmail,
      patientName,
      doctorName,
      amount,
      windowHours,
      transactionID,
    } = req.body;

    const emailResult = await NotificationService.paymentConfirmed(
      patientEmail,
      patientName,
      doctorName,
      amount,
      windowHours,
      transactionID
    );

    res.json({ success: true, email: emailResult });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// ==========================================
// HEALTH CHECK
// GET /api/notifications/health
// ==========================================
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Notification service is running',
    services: {
      email: 'enabled',
      prescriptions: 'enabled',
    },
  });
});

module.exports = router;