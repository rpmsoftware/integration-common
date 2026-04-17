const { MailService } = require('@sendgrid/mail');
const { validateString, toBase64, toBoolean, toArray } = require('../../../util');

const normalize = eml => {
    let { name, address: email } = typeof eml === 'string' ? { address: eml } : eml;
    name = name ? validateString(name) : undefined;
    validateString(email);
    return { name, email };
};

const createMessageBase = ({ fromEmail, replyToEmail, toEmails, ccEmails, subject, html }) => {
    const base = {};
    fromEmail && (base.from = normalize(fromEmail));
    subject && (base.subject = validateString(subject));
    replyToEmail && (base.reply_to = normalize(replyToEmail));
    toEmails && (base.to = toArray(toEmails).map(normalize));
    ccEmails && (base.cc = ccEmails.map(normalize));
    toBoolean(html) && (base._html = true);
    return base;
};

module.exports = config => {
    const { apiKey } = config;
    validateString(apiKey);
    const sgMail = new MailService();
    sgMail.setApiKey(apiKey);
    const base = createMessageBase(config);
    return config => {
        const { messageBody, attachments } = config;
        const message = Object.assign({}, base, createMessageBase(config));
        messageBody && (message[message._html ? 'html' : 'text'] = messageBody);
        delete message._html;
        message.attachments = attachments ? attachments.map(({ content, filename, type, raw }) => ({
            filename,
            type,
            content: raw ? content : toBase64(content)
        })) : undefined;
        return sgMail.send(message);
    };
};
