const { MailService } = require('@sendgrid/mail');
const { toArray, validateString, toBoolean } = require('../util');
const assert = require('assert');
const debug = require('debug')('rpm:sendgrid');

const normalize = eml => {
    let { name, address: email } = typeof eml === 'string' ? { address: eml } : eml;
    validateString(email);
    name = name ? validateString(name) : undefined;
    return { name, email };
};

const VALIDATORS = {
    fromEmail: normalize,
    toEmails: v => toArray(v).map(normalize),
    ccEmails: v => toArray(v).map(normalize),
    subject: validateString,
    messageBody: validateString,
    html: toBoolean
};

const normConf = conf => {
    const result = {};
    for (const k in VALIDATORS) {
        const v = conf[k];
        v === undefined || (result[k] = VALIDATORS[k](v));
    }
    return result;
}

exports.createMessageSender = conf => {
    const { apiKey } = conf;
    validateString(apiKey);
    conf = normConf(conf);
    const sgMail = new MailService();
    sgMail.setApiKey(apiKey);
    return c => {
        const {
            subject, fromEmail, toEmails, ccEmails, messageBody, html
        } = c ? Object.assign({}, conf, normConf(c)) : conf;
        assert(fromEmail);
        toEmails && toEmails.length > 0 || assert(ccEmails && ccEmails.length > 0);
        const message = {
            subject,
            from: fromEmail,
            to: toEmails,
            cc: ccEmails
        };
        debug('Sending email: %j', message);
        messageBody && (message[html ? 'html' : 'text'] = messageBody);
        return sgMail.send(message);
    };
};
