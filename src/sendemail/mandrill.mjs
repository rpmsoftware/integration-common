import { Mandrill } from 'mandrill-api/mandrill';
import { toArray } from '../util.mjs';

const EMAIL_PATTERN = /(^\s*(\S.*\S)\s*<\s*([\w.]+@[\w.]+)\s*>\s*$)|(^\s*([\w.]+@[\w.]+)\s*$)/;

const parseEmail = (str) => {
    const parts = str.match(EMAIL_PATTERN);
    if (!parts) {
        throw new Error('Bad email format: ' + str);
    }
    return {
        email: parts[3] || parts[5],
        name: parts[2]
    };
};

const normalizeEmails = (emails, typ) => {
    const result = toArray(emails).map(parseEmail);
    typ && result.forEach(email => email.type = typ);
    return result;
};

const createBasicMessageSender = (apiKey) => {
    let send = new Mandrill(apiKey).messages;
    send = send.send.bind(send);
    return function (message) {
        return new Promise((resolve, reject) => send({ message: message }, resolve, reject));
    };
};

export const createMessageSender = (apiKey, fromEmail, toEmails, ccEmails) => {
    if (typeof apiKey === 'object') {
        fromEmail = apiKey.fromEmail;
        toEmails = apiKey.toEmails;
        ccEmails = apiKey.ccEmails;
        apiKey = apiKey.apiKey;
    }
    const send = createBasicMessageSender(apiKey);
    fromEmail = parseEmail(fromEmail);
    toEmails = normalizeEmails(toEmails);
    if (ccEmails) {
        toEmails = toEmails.concat(normalizeEmails(ccEmails, 'cc'));
    }
    if (!toEmails.length) {
        throw new Error('There has to be at least one recipient');
    }
    return function (subject, messageBody, sendAsHtml) {
        const message = {
            subject: subject,
            from_email: fromEmail.email,
            from_name: fromEmail.name,
            to: toEmails,
        };
        if (messageBody) {
            message[sendAsHtml ? 'html' : 'text'] = messageBody;
        }
        return send(message);
    };
};
