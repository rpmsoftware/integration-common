const debug = require('debug')('rpm:send-email');
const assert = require('assert');
const {
    validateString, toArray, getEager, toBoolean, isEmpty,
    validatePropertyConfig, getDeepValue, getGlobal
} = require('../../util');

const INSTANCES = {};

exports.send = async function (conf, data) {
    let {
        transport,
        fromEmail: fromEmailConf,
        toEmails: toEmailsConf,
        replyToEmail,
        ccEmails: ccEmailsConf,
        subject,
        body,
        html,
        attachments: attachmentsConf,
        dryRun,
        sendEmpty,
    } = conf;

    if (!sendEmpty && isEmpty(data)) {
        debug('There is nothing to send');
        return;
    }

    let sendEmail = INSTANCES[transport];
    if (!sendEmail) {
        transport = getEager(getGlobal(), transport);
        sendEmail = require(`./transports/${transport.name}`)(transport);
        INSTANCES[transport] = sendEmail;
    }
    assert.strictEqual(typeof sendEmail, 'function');

    subject = subject && getPropOrValue(subject, data);
    body = body && getPropOrValue(body, data);
    const attachments = [];
    attachmentsConf && attachmentsConf.forEach(({ property, content, filename, type, raw }) => {
        const d = property ? toArray(getDeepValue(data, property)) : [data];
        d.forEach(data => {
            let c = getPropOrValue(content, data);
            c && attachments.push({
                content: c,
                filename: getPropOrValue(filename, data),
                type,
                raw
            })
        })
    });
    subject || assert(body);
    const fromEmail = getEmails(fromEmailConf, data)[0];
    assert(fromEmail);
    replyToEmail = replyToEmail && getEmails(replyToEmail, data)[0];
    let toEmails = [];
    let ccEmails = [];
    for (let c of toEmailsConf) {
        toEmails = toEmails.concat(getEmails(c, data));
    }
    for (let c of ccEmailsConf) {
        ccEmails = ccEmails.concat(getEmails(c, data));
    }
    if (toEmails.length < 1 && ccEmails.length < 1) {
        return;
    }
    dryRun ?
        debug('sendEmail(%j, %j, %j, %j, %s, %s, %s)', fromEmail, replyToEmail, toEmails, ccEmails, subject, body, html) :
        await sendEmail(fromEmail, replyToEmail, toEmails, ccEmails, subject, body, html, attachments);
    debug('Email is sent');

};

const getEmails = ({ address: addressConf, name: nameConf, property: propertyConf }, form) => {
    const result = {};
    propertyConf && (form = getDeepValue(form, propertyConf));
    for (let address of toArray(form)) {
        const name = nameConf && getPropOrValue(nameConf, address) || undefined;
        address = getPropOrValue(addressConf, address);
        address && (result[address] = { name, address });
    }
    return Object.values(result);
};

const initEmailConfig = conf => {
    let { property, address, name } = conf;
    property = property ? validatePropertyConfig(property) : undefined;
    name = name ? initPropOrValue(name) : undefined;
    address = initPropOrValue(address || conf);
    return { property, address, name };
};

const initPropOrValue = conf => conf.property ?
    { property: validatePropertyConfig(conf.property) } :
    { value: validateString(conf.value || conf) };

const getPropOrValue = ({ property, value }, obj) => property ? getDeepValue(obj, property) : value;

exports.init = function ({ transport, fromEmail, toEmails, replyToEmail, ccEmails, subject, body, html, dryRun, sendEmpty, attachments }) {
    const t = getEager(getGlobal(), validateString(transport));
    assert.strictEqual(typeof t, 'object');
    require(`./transports/${t.name}`);

    fromEmail || (fromEmail = t.fromEmail);
    toEmails || (toEmails = t.toEmails);
    replyToEmail || (replyToEmail = t.replyToEmail);
    ccEmails || (ccEmails = t.ccEmails);
    subject || (subject = t.subject);
    body || (body = t.body);
    html || (html = t.html);
    sendEmpty || (sendEmpty = t.sendEmpty);
    attachments || (attachments = t.attachments);
    t.dryRun === undefined || (dryRun = t.dryRun);

    fromEmail = initEmailConfig(fromEmail);
    replyToEmail = replyToEmail ? initEmailConfig(replyToEmail) : undefined;
    subject = subject ? initPropOrValue(subject) : undefined;
    body = body ? initPropOrValue(body) : undefined;

    attachments = attachments ? toArray(attachments).map(({ property, content, filename, type, raw }) => {
        raw = toBoolean(raw) || undefined;
        property = property ? validatePropertyConfig(property) : undefined;
        content = initPropOrValue(content);
        filename = initPropOrValue(filename);
        type = type ? validateString(type) : undefined;
        return { property, content, filename, type, raw };
    }) : [];
    attachments.length < 1 && (attachments = undefined);

    const initEmails = emails =>
        emails ? toArray(emails).map(conf => initEmailConfig(conf)) : [];


    toEmails = initEmails(toEmails);
    assert(toEmails.length > 0);
    ccEmails = initEmails(ccEmails);

    html = toBoolean(html) || undefined;
    dryRun = toBoolean(dryRun) || undefined;
    sendEmpty = toBoolean(sendEmpty) || undefined;
    return { transport, fromEmail, toEmails, replyToEmail, ccEmails, subject, body, attachments, html, dryRun, sendEmpty };
};