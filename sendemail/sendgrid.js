const Svc = require('@sendgrid/mail').MailService;
const { toArray } = require('./util');

function createMessageSender(apiKey, fromEmail, toEmails, ccEmails) {
    if (typeof apiKey === 'object') {
        fromEmail = apiKey.fromEmail;
        toEmails = apiKey.toEmails;
        ccEmails = apiKey.ccEmails;
        apiKey = apiKey.apiKey;
    }
    toEmails = toEmails ? toArray(toEmails) : [];
    ccEmails = ccEmails ? toArray(ccEmails) : [];
    if (toEmails.length < 1 && ccEmails.length < 1) {
        throw new Error('There has to be at least one recipient');
    }
    const sgMail = new Svc();
    sgMail.setApiKey(apiKey);
    return function (subject, messageBody, sendAsHtml) {
        const message = {
            subject: subject,
            from: fromEmail,
            to: toEmails,
            cc: ccEmails
        };
        if (messageBody) {
            message[sendAsHtml ? 'html' : 'text'] = messageBody;
        }
        return sgMail.send(message);
    };
}

exports.createMessageSender = createMessageSender;
