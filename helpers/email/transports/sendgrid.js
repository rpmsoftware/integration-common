const { MailService } = require('@sendgrid/mail');
const { validateString } = require('../../../util');

const normalize = eml => {
    const { name, address: email } = typeof eml === 'string' ? { address: eml } : eml;
    return { name, email };
};

module.exports = ({ apiKey }) => {
    validateString(apiKey);
    const sgMail = new MailService();
    sgMail.setApiKey(apiKey);
    return (fromEmail, toEmails, ccEmails, subject, messageBody, html) => {
        const message = {
            subject,
            from: normalize(fromEmail),
            to: toEmails.map(normalize),
            cc: ccEmails.map(normalize)
        };
        messageBody && (message[html ? 'html' : 'text'] = messageBody);
        return sgMail.send(message);
    };
};
