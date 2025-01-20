const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: 'localhost',
    port: 1025, // MailHog SMTP port
    secure: false // No TLS required for local testing
});

module.exports = {
    sendMail: (to, subject, text) => {
        return transporter.sendMail({
            from: '"Test App" <test@example.com>',
            to: to,
            subject: subject,
            text: text
        });
    }
};
