const debug = require('debug')('rpm:send-email');
const assert = require('assert');
const { validateString, toArray, getEager, toBoolean, isEmpty, validatePropertyConfig, getDeepValue } = require('../../util');

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

    let ctx;
    if (typeof transport === 'string') {
        const { globals } = this.parentContext || this;
        ctx = globals;
        transport = getEager(globals, transport);
    } else {
        ctx = this;
    }
    let { _sendEmail } = ctx;
    if (!_sendEmail) {
        _sendEmail = require(`./transports/${transport.name}`)(transport);
        assert.strictEqual(typeof _sendEmail, 'function');
        Object.defineProperty(ctx, '_sendEmail', { value: _sendEmail });
    }

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
    const fromEmail = getEmails.call(this, fromEmailConf, data)[0];
    assert(fromEmail);
    replyToEmail = replyToEmail && getEmails.call(this, replyToEmail, data)[0];
    let toEmails = [];
    let ccEmails = [];
    for (let c of toEmailsConf) {
        toEmails = toEmails.concat(getEmails.call(this, c, data));
    }
    for (let c of ccEmailsConf) {
        ccEmails = ccEmails.concat(getEmails.call(this, c, data));
    }
    if (toEmails.length < 1 && ccEmails.length < 1) {
        return;
    }
    dryRun ?
        debug('_sendEmail(%j, %j, %j, %j, %s, %s, %s)', fromEmail, replyToEmail, toEmails, ccEmails, subject, body, html) :
        await _sendEmail(fromEmail, replyToEmail, toEmails, ccEmails, subject, body, html, attachments);
    debug('Email is sent');

};

function getEmails(conf, form) {
    let { property, address: addressConf, name: nameConf } = conf;
    const result = {};
    for (let f of toArray(form)) {
        property && (f = getDeepValue(f, property));
        for (let address of toArray(f)) {
            if (!address) {
                continue;
            }
            const name = nameConf && getDeepValue(address, nameConf) || undefined;
            address = getDeepValue(address, addressConf);
            address && (result[address] = { name, address });
        }
    }
    return Object.values(result);
}

function initEmailConfig(conf) {
    let { address, name, property } = conf;
    name = name ? validatePropertyConfig(name) : undefined;
    if (!(address || property)) {
        property = undefined;
        address = validatePropertyConfig(conf);
    } else if (address) {
        address = validatePropertyConfig(address);
        property = property ? validatePropertyConfig(property) : undefined;
    } else {
        address = validatePropertyConfig(property);
        property = undefined;
    }
    return { property, address, name };
}

const initPropOrValue = conf => conf.property ?
    { property: validatePropertyConfig(conf.property) } :
    { value: validateString(conf.value || conf) };

const getPropOrValue = ({ property, value }, obj) => property ? getDeepValue(obj, property) : value;

exports.init = async function ({ transport, fromEmail, toEmails, replyToEmail, ccEmails, subject, body, html, dryRun, sendEmpty, attachments }) {
    const { globals } = this.parentContext || this;
    fromEmail = initEmailConfig.call(this, fromEmail);
    replyToEmail = replyToEmail ? initEmailConfig.call(this, replyToEmail) : undefined;
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

    const initEmails = async emails => {
        const result = [];
        if (emails) {
            for (let conf of toArray(emails)) {
                result.push(initEmailConfig.call(this, conf));
            }
        }
        return result;
    }

    toEmails = await initEmails(toEmails);
    assert(toEmails.length > 0);
    ccEmails = await initEmails(ccEmails);

    const t = typeof transport === 'string' ? getEager(globals, transport) : transport;
    assert.strictEqual(typeof t, 'object');
    require(`./transports/${t.name}`);

    html = toBoolean(html) || undefined;
    dryRun = toBoolean(dryRun) || undefined;
    sendEmpty = toBoolean(sendEmpty) || undefined;
    return { transport, fromEmail, toEmails, replyToEmail, ccEmails, subject, body, attachments, html, dryRun, sendEmpty };
};