const { MailService } = require('@sendgrid/mail');
const { validateString, toBase64 } = require('../../../util');

const normalize = eml => {
    const { name, address: email } = typeof eml === 'string' ? { address: eml } : eml;
    return { name, email };
};

module.exports = ({ apiKey }) => {
    validateString(apiKey);
    const sgMail = new MailService();
    sgMail.setApiKey(apiKey);
    return (fromEmail, replyToEmail, toEmails, ccEmails, subject, messageBody, html, attachments) => {
        const message = {
            subject,
            from: normalize(fromEmail),
            reply_to: replyToEmail ? normalize(replyToEmail) : undefined,
            to: toEmails.map(normalize),
            cc: ccEmails.map(normalize),
            attachments: attachments ? attachments.map(({ content, filename, type }) => ({
                filename,
                type,
                content: toBase64(content)
            })) : undefined
        };
        messageBody && (message[html ? 'html' : 'text'] = messageBody);
        return sgMail.send(message);
    };
};
