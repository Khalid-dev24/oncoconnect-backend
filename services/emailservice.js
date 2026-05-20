// backend/services/emailService.js
// Email Notification Service

const axios = require('axios');

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const COMPANY_EMAIL = process.env.EMAIL_ADDRESS || 'noreply@oncoconnect.ng';
const COMPANY_NAME = 'OncoConnect';

class EmailService {
  /**
   * Send email via SendGrid API
   */
  static async sendEmail(to, subject, htmlContent, textContent = '') {
    try {
      if (!SENDGRID_API_KEY) {
        console.error('❌ SENDGRID_API_KEY not set in environment variables');
        return {
          success: false,
          error: 'Email service not configured',
        };
      }

      console.log('📬 Preparing email via SendGrid:', { to, subject });
      
      const payload = {
        personalizations: [
          {
            to: [{ email: to }],
            subject: subject,
          },
        ],
        from: {
          email: COMPANY_EMAIL,
          name: COMPANY_NAME,
        },
        content: [
          {
            type: 'text/plain',
            value: textContent || htmlContent.replace(/<[^>]*>/g, ''),
          },
          {
            type: 'text/html',
            value: htmlContent,
          },
        ],
      };

      console.log('📤 Sending via SendGrid as:', COMPANY_EMAIL);
      const response = await axios.post('https://api.sendgrid.com/v3/mail/send', payload, {
        headers: {
          Authorization: `Bearer ${SENDGRID_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });

      console.log('✅ Email sent successfully via SendGrid');
      return {
        success: true,
        messageId: response.headers['x-message-id'] || 'sent',
        response: response.data,
      };
    } catch (error) {
      console.error('❌ Email sending failed:', error.message);
      if (error.response) {
        console.error('SendGrid error:', error.response.data);
      }
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Welcome email for newly registered doctor
   */
  static async sendDoctorWelcomeEmail(doctorEmail, doctorName, inviteCode) {
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #0B8F8F, #0DD6C8); padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="color: white; margin: 0;">Welcome to OncoConnect</h1>
          <p style="color: white; margin: 5px 0 0 0;">Professional Oncology Care Platform</p>
        </div>

        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px;">
          <p>Hello Dr. ${doctorName},</p>

          <p>Welcome to OncoConnect! You're now registered and ready to start accepting patient consultations.</p>

          <div style="background: white; border-left: 4px solid #0B8F8F; padding: 15px; margin: 20px 0;">
            <h3 style="color: #0B8F8F; margin: 0 0 10px 0;">Your Unique Invite Code</h3>
            <div style="font-size: 24px; font-weight: bold; color: #0DD6C8; text-align: center; padding: 15px; background: #0A1628; border-radius: 6px;">
              ${inviteCode}
            </div>
            <p style="color: #666; margin: 10px 0 0 0;">Share this code with your patients. They'll enter it when registering on the mobile app to be automatically linked to your profile.</p>
          </div>

          <h3 style="color: #333; margin-top: 20px;">How It Works</h3>
          <ol style="color: #666; line-height: 1.8;">
            <li><strong>Share your code</strong> with patients via WhatsApp, SMS, or email</li>
            <li><strong>Patients register</strong> on the mobile app using your code</li>
            <li><strong>They pay ₦40,000</strong> to open a 48-hour consultation window</li>
            <li><strong>You earn ₦28,000</strong> instantly (70% of fee)</li>
            <li><strong>Message back and forth</strong> during the 48-hour window</li>
            <li><strong>Send prescriptions</strong> with automatic QR codes</li>
          </ol>

          <div style="background: #e8f5f5; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <h4 style="color: #0B8F8F; margin: 0 0 10px 0;">💰 Earnings Model</h4>
            <p style="margin: 0; color: #666;">
              • Consultation: ₦40,000 → You get ₦28,000<br>
              • Window Extension: ₦15,000 → You get ₦10,500<br>
              • Emergency Alert: FREE (always)<br>
              • No monthly fees or hidden charges
            </p>
          </div>

          <div style="background: #fff3cd; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <h4 style="color: #856404; margin: 0 0 10px 0;">⚠️ Next Step: Bank Setup</h4>
            <p style="margin: 0; color: #666;">
              Log in to your dashboard and update your bank details. Earnings are sent to your account within 24 hours of each consultation.
            </p>
          </div>

          <p style="color: #666; margin-top: 20px;">
            <strong>Dashboard Login:</strong> <a href="https://oncoconnect-doctor.ng" style="color: #0B8F8F; text-decoration: none;">oncoconnect-doctor.ng</a>
          </p>

          <p style="color: #666; margin-top: 20px;">
            Need help? Reply to this email or contact support@oncoconnect.ng
          </p>

          <div style="border-top: 1px solid #ddd; padding-top: 20px; margin-top: 30px;">
            <p style="color: #999; font-size: 12px; margin: 0;">
              © 2026 OncoConnect. All rights reserved.<br>
              Medical care that scales. Doctors that earn.
            </p>
          </div>
        </div>
      </div>
    `;

    return this.sendEmail(
      doctorEmail,
      '🎉 Welcome to OncoConnect - Your Invite Code Inside',
      htmlContent
    );
  }

  /**
   * Welcome email for newly registered patient
   */
  static async sendPatientWelcomeEmail(patientEmail, patientName, doctorName) {
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #0B8F8F, #0DD6C8); padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="color: white; margin: 0;">Welcome to OncoConnect</h1>
          <p style="color: white; margin: 5px 0 0 0;">Your Oncology Care Companion</p>
        </div>

        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px;">
          <p>Hello ${patientName},</p>

          <p>Welcome to OncoConnect! You're now connected with Dr. ${doctorName} for your oncology care journey.</p>

          <div style="background: white; border-left: 4px solid #0B8F8F; padding: 15px; margin: 20px 0;">
            <h3 style="color: #0B8F8F; margin: 0 0 10px 0;">Get Started in 3 Steps</h3>
            <ol style="color: #666; line-height: 1.8; margin: 0; padding-left: 20px;">
              <li><strong>Open Consultation</strong> - Pay ₦40,000 for 48-hour access</li>
              <li><strong>Message Doctor</strong> - Share your health updates</li>
              <li><strong>Receive Care</strong> - Get prescriptions and guidance</li>
            </ol>
          </div>

          <div style="background: #e8f5f5; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <h4 style="color: #0B8F8F; margin: 0 0 10px 0;">📱 App Features</h4>
            <ul style="margin: 0; padding-left: 20px; color: #666;">
              <li>Track your medications daily</li>
              <li>Log symptoms and get instant alerts</li>
              <li>Message Dr. ${doctorName} during consultation</li>
              <li>Receive digital prescriptions with QR codes</li>
              <li>Emergency alert (always free)</li>
            </ul>
          </div>

          <p style="color: #666; margin-top: 20px; text-align: center;">
            <a href="https://oncoconnect.ng/download" style="background: #0B8F8F; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block;">
              Download App Now
            </a>
          </p>

          <div style="background: #fff3cd; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <h4 style="color: #856404; margin: 0 0 10px 0;">💡 Pro Tip</h4>
            <p style="margin: 0; color: #666;">
              The more you track (medications, symptoms), the better Dr. ${doctorName} can help you. Use the app daily.
            </p>
          </div>

          <p style="color: #666; margin-top: 20px;">
            Need help? Contact support@oncoconnect.ng or call our helpline.
          </p>

          <div style="border-top: 1px solid #ddd; padding-top: 20px; margin-top: 30px;">
            <p style="color: #999; font-size: 12px; margin: 0;">
              © 2026 OncoConnect. All rights reserved.<br>
              Quality oncology care, made accessible.
            </p>
          </div>
        </div>
      </div>
    `;

    return this.sendEmail(
      patientEmail,
      '👋 Welcome to OncoConnect - Start Your Care Journey',
      htmlContent
    );
  }

  /**
   * Payment confirmation email for patient
   */
  static async sendPaymentConfirmationEmail(
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
              <li>Go to the Home screen - you'll see your consultation is active</li>
              <li>Start messaging Dr. ${doctorName} immediately</li>
              <li>The countdown timer shows hours remaining</li>
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

    return this.sendEmail(
      patientEmail,
      '✓ Payment Confirmed - Consultation Window Active',
      htmlContent
    );
  }

  /**
   * Doctor earnings notification email
   */
  static async sendDoctorEarningsEmail(
    doctorEmail,
    doctorName,
    patientName,
    amount,
    totalEarnings
  ) {
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #22C55E, #16A34A); padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="color: white; margin: 0;">💰 You Earned Money!</h1>
        </div>

        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px;">
          <p>Hello Dr. ${doctorName},</p>

          <p>Great news! You just earned money from a patient consultation.</p>

          <div style="background: white; border-left: 4px solid #22C55E; padding: 15px; margin: 20px 0;">
            <h3 style="color: #22C55E; margin: 0 0 10px 0;">Earnings Summary</h3>
            <table style="width: 100%; color: #666;">
              <tr>
                <td><strong>Patient</strong></td>
                <td style="text-align: right;">${patientName}</td>
              </tr>
              <tr style="border-top: 1px solid #eee;">
                <td><strong>This Earning</strong></td>
                <td style="text-align: right; font-size: 18px; color: #22C55E; font-weight: bold;">₦${amount.toLocaleString()}</td>
              </tr>
              <tr style="border-top: 1px solid #eee;">
                <td><strong>Total to Date</strong></td>
                <td style="text-align: right;">₦${totalEarnings.toLocaleString()}</td>
              </tr>
            </table>
          </div>

          <div style="background: #e8f5f5; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <h4 style="color: #0B8F8F; margin: 0 0 10px 0;">📊 Payment Status</h4>
            <p style="margin: 0; color: #666;">
              ✓ Payment received from patient<br>
              ✓ Automatically sent to your bank account<br>
              ⏱️ Settlement: T+1 (within 24 hours)
            </p>
          </div>

          <p style="color: #666; margin-top: 20px; text-align: center;">
            <a href="https://oncoconnect-doctor.ng/earnings" style="background: #0B8F8F; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block;">
              View Earnings Dashboard
            </a>
          </p>

          <div style="border-top: 1px solid #ddd; padding-top: 20px; margin-top: 30px;">
            <p style="color: #999; font-size: 12px; margin: 0;">
              © 2026 OncoConnect. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    `;

    return this.sendEmail(
      doctorEmail,
      `💰 You Earned ₦${amount.toLocaleString()} - New Consultation`,
      htmlContent
    );
  }

  /**
   * Prescription sent notification
   */
  static async sendPrescriptionEmail(
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

    return this.sendEmail(
      patientEmail,
      `💊 New Prescription from Dr. ${doctorName}`,
      htmlContent
    );
  }
}

module.exports = EmailService;