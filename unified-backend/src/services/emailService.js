const nodemailer = require("nodemailer");

const SMTP_USER = process.env.SMTP_USER || "tech.tsgiitkgp@gmail.com";
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM_NAME = process.env.SMTP_FROM_NAME || "TSG Chess Arena";

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
});

/**
 * Send a password reset email with a reset link.
 * @param {string} to - Recipient email address
 * @param {string} token - The unhashed reset token (will be included in the link)
 */
async function sendPasswordResetEmail(to, token) {
  const clientUrl = process.env.CLIENT_URL || "http://localhost:8080";
  const resetLink = `${clientUrl}/reset-password?token=${token}`;

  const mailOptions = {
    from: `"${SMTP_FROM_NAME}" <${SMTP_USER}>`,
    to,
    subject: "Password Reset - TSG Chess Arena",
    html: `
            <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px;">
                <h2 style="color: #1a1a2e;">Reset Your Password</h2>
                <p>You requested a password reset for your TSG Chess Arena account.</p>
                <p>Click the button below to set a new password. This link is valid for <strong>1 hour</strong>.</p>
                <a href="${resetLink}" style="display: inline-block; padding: 12px 24px; background-color: #6d28d9; color: #fff; text-decoration: none; border-radius: 6px; margin: 16px 0;">
                    Reset Password
                </a>
                <p style="font-size: 13px; color: #666;">If you did not request this, please ignore this email. Your password will remain unchanged.</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
                <p style="font-size: 12px; color: #999;">TSG Chess Arena &bull; IIT Kharagpur</p>
            </div>
        `,
  };

  const info = await transporter.sendMail(mailOptions);
}

module.exports = { sendPasswordResetEmail };
