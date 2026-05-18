// backend/services/notificationService.js
// Complete Notification Service - Email + Prescriptions (No SMS)

const EmailService = require('./emailservice');
const PrescriptionService = require('./prescriptionservice');

class NotificationService {
  /**
   * Doctor Consultation Opened
   * Notify doctor about new patient consultation
   */
  static async consultationOpened(
    doctorEmail,
    doctorName,
    patientName,
    amount,
    windowHours,
    transactionID
  ) {
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #22C55E, #16A34A); padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="color: white; margin: 0;">💰 New Consultation - You Earned Money!</h1>
        </div>

        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px;">
          <p>Hello Dr. ${doctorName},</p>

          <p>A patient just opened a consultation window with you.</p>

          <div style="background: white; border-left: 4px solid #22C55E; padding: 15px; margin: 20px 0;">
            <h3 style="color: #22C55E; margin: 0 0 10px 0;">Your Earnings</h3>
            <table style="width: 100%; color: #666;">
              <tr>
                <td><strong>Patient Name:</strong></td>
                <td style="text-align: right;">${patientName}</td>
              </tr>
              <tr style="border-top: 1px solid #eee;">
                <td><strong>You Earned:</strong></td>
                <td style="text-align: right; font-size: 18px; color: #22C55E; font-weight: bold;">₦${(amount * 0.7).toLocaleString()}</td>
              </tr>
              <tr style="border-top: 1px solid #eee;">
                <td><strong>Window Duration:</strong></td>
                <td style="text-align: right;">${windowHours} hours</td>
              </tr>
              <tr style="border-top: 1px solid #eee;">
                <td><strong>Transaction ID:</strong></td>
                <td style="text-align: right; font-family: monospace; font-size: 12px;">${transactionID}</td>
              </tr>
            </table>
          </div>

          <div style="background: #e8f5f5; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <h4 style="color: #0B8F8F; margin: 0 0 10px 0;">📋 What To Do Now</h4>
            <ol style="margin: 0; padding-left: 20px; color: #666;">
              <li>Log into your doctor dashboard</li>
              <li>Go to Patient Panel to see ${patientName}'s profile</li>
              <li>View their medical history and symptoms</li>
              <li>Start messaging them immediately</li>
              <li>Send prescriptions as needed</li>
            </ol>
          </div>

          <p style="color: #666; margin-top: 20px; text-align: center;">
            <a href="https://oncoconnect-doctor.ng/dashboard" style="background: #0B8F8F; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block;">
              Go to Dashboard
            </a>
          </p>

          <div style="background: #fffbeb; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <h4 style="color: #b45309; margin: 0 0 10px 0;">⏰ Remember</h4>
            <p style="margin: 0; color: #666;">
              You have ${windowHours} hours to interact with this patient. After that, they'll need to open a new consultation.
            </p>
          </div>

          <div style="border-top: 1px solid #ddd; padding-top: 20px; margin-top: 30px;">
            <p style="color: #999; font-size: 12px; margin: 0;">
              © 2026 OncoConnect. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    `;

    return EmailService.sendEmail(
      doctorEmail,
      `💰 New Consultation from ${patientName} - You Earned ₦${(amount * 0.7).toLocaleString()}`,
      htmlContent
    );
  }

  /**
   * Patient Payment Confirmed
   */
  static async paymentConfirmed(
    patientEmail,
    patientName,
    doctorName,
    amount,
    windowHours,
    transactionID
  ) {
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #22C55E, #16A34A); padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="color: white; margin: 0;">✓ Payment Confirmed</h1>
        </div>

        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px;">
          <p>Hi ${patientName},</p>

          <p>Your payment has been successfully processed. Your ${windowHours}-hour consultation window with Dr. ${doctorName} is now <strong>ACTIVE</strong>.</p>

          <div style="background: white; border-left: 4px solid #22C55E; padding: 15px; margin: 20px 0;">
            <h3 style="color: #22C55E; margin: 0 0 10px 0;">Payment Details</h3>
            <table style="width: 100%; color: #666;">
              <tr>
                <td><strong>Amount</strong></td>
                <td style="text-align: right;">₦${amount.toLocaleString()}</td>
              </tr>
              <tr style="border-top: 1px solid #eee;">
                <td><strong>Doctor</strong></td>
                <td style="text-align: right;">Dr. ${doctorName}</td>
              </tr>
              <tr style="border-top: 1px solid #eee;">
                <td><strong>Duration</strong></td>
                <td style="text-align: right;">${windowHours} hours</td>
              </tr>
              <tr style="border-top: 1px solid #eee;">
                <td><strong>Transaction ID</strong></td>
                <td style="text-align: right; font-family: monospace; font-size: 12px;">${transactionID}</td>
              </tr>
            </table>
          </div>

          <div style="background: #e8f5f5; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <h4 style="color: #0B8F8F; margin: 0 0 10px 0;">📋 What Happens Next</h4>
            <ol style="margin: 0; padding-left: 20px; color: #666;">
              <li>Open the OncoConnect app on your phone</li>
              <li>Go to the Home screen - consultation is active</li>
              <li>Start messaging Dr. ${doctorName} immediately</li>
              <li>The timer shows hours remaining</li>
            </ol>
          </div>

          <div style="background: #fffbeb; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <h4 style="color: #b45309; margin: 0 0 10px 0;">⏰ Window Expires</h4>
            <p style="margin: 0; color: #666;">
              You have ${windowHours} hours from now to message your doctor. After this, you'll need to open a new consultation window.
            </p>
          </div>

          <p style="color: #666; margin-top: 20px; text-align: center;">
            <a href="https://oncoconnect.ng" style="color: #0B8F8F; text-decoration: none;">Open App</a> |
            <a href="https://oncoconnect.ng/help" style="color: #0B8F8F; text-decoration: none;">Get Help</a>
          </p>

          <div style="border-top: 1px solid #ddd; padding-top: 20px; margin-top: 30px;">
            <p style="color: #999; font-size: 12px; margin: 0;">
              © 2026 OncoConnect. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    `;

    return EmailService.sendEmail(
      patientEmail,
      '✓ Payment Confirmed - Consultation Window Active',
      htmlContent
    );
  }

  /**
   * Prescription Sent
   */
  static async prescriptionSent(
    patientEmail,
    patientName,
    doctorName,
    drugs,
    qrCode
  ) {
    const drugsText = drugs.map((d) => `${d.name} ${d.dosage}`).join(', ');

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #0B8F8F, #0DD6C8); padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="color: white; margin: 0;">💊 Digital Prescription</h1>
        </div>

        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px;">
          <p>Hello ${patientName},</p>

          <p>Dr. ${doctorName} has sent you a digital prescription. You can view it in your OncoConnect app or use the QR code below at any pharmacy.</p>

          <div style="background: white; border-left: 4px solid #0B8F8F; padding: 15px; margin: 20px 0;">
            <h3 style="color: #0B8F8F; margin: 0 0 10px 0;">Prescribed Medications</h3>
            <p style="margin: 0; color: #666; line-height: 1.8;">
              ${drugs.map((d) => `<strong>${d.name}</strong> - ${d.dosage} (${d.frequency})<br>`).join('')}
            </p>
          </div>

          <div style="background: #f0f0f0; padding: 20px; border-radius: 6px; margin: 20px 0; text-align: center;">
            <p style="color: #666; margin: 0 0 10px 0;">Show this QR code at your pharmacy:</p>
            <div style="background: white; padding: 15px; display: inline-block; border-radius: 6px;">
              <p style="margin: 0; font-family: monospace; font-weight: bold; color: #0B8F8F;">${qrCode}</p>
              <p style="color: #999; margin: 5px 0 0 0; font-size: 12px;">Pharmacist scans to verify</p>
            </div>
          </div>

          <div style="background: #fffbeb; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <h4 style="color: #b45309; margin: 0 0 10px 0;">📋 How to Use</h4>
            <ol style="margin: 0; padding-left: 20px; color: #666;">
              <li>Take this prescription to any registered pharmacy</li>
              <li>Ask them to scan the QR code</li>
              <li>Pharmacist verifies with OncoConnect system</li>
              <li>Prescription is confirmed and medications dispensed</li>
            </ol>
          </div>

          <p style="color: #666; margin-top: 20px; text-align: center;">
            <a href="https://oncoconnect.ng" style="color: #0B8F8F; text-decoration: none;">View in App</a> |
            <a href="https://oncoconnect.ng/help" style="color: #0B8F8F; text-decoration: none;">Get Help</a>
          </p>

          <div style="border-top: 1px solid #ddd; padding-top: 20px; margin-top: 30px;">
            <p style="color: #999; font-size: 12px; margin: 0;">
              © 2026 OncoConnect. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    `;

    return EmailService.sendEmail(
      patientEmail,
      `💊 New Prescription from Dr. ${doctorName}`,
      htmlContent
    );
  }

  /**
   * Doctor Welcome (New Registration)
   */
  static async doctorWelcome(doctorEmail, doctorName, inviteCode) {
    return EmailService.sendDoctorWelcomeEmail(
      doctorEmail,
      doctorName,
      inviteCode
    );
  }

  /**
   * Patient Welcome (New Registration)
   */
  static async patientWelcome(patientEmail, patientName, doctorName) {
    return EmailService.sendPatientWelcomeEmail(
      patientEmail,
      patientName,
      doctorName
    );
  }
}

module.exports = NotificationService;