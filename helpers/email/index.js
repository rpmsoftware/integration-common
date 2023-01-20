const debug = require('debug')('rpm:send-email');
const assert = require('assert');
const { init: initGetter, get: getValue } = require('../getters');
const { validateString, toArray, getEager, toBoolean, isEmpty } = require('../../util');
const { render } = require('mustache');

exports.send = async function (conf, data) {
    let {
        transport,
        fromEmail: fromEmailConf,
        toEmails: toEmailsConf,
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

    subject = subject && render(subject, data);
    body = body && render(body, data);
    const attachments = attachmentsConf && attachmentsConf.map(({ content, filename, type }) => ({
        content: render(content, data),
        filename: render(filename, data),
        type
    }));
    subject || assert(body);
    const fromEmail = (await getEmails.call(this, fromEmailConf, data))[0];
    assert(fromEmail);
    let toEmails = [];
    let ccEmails = [];
    for (let c of toEmailsConf) {
        toEmails = toEmails.concat(await getEmails.call(this, c, data));
    }
    for (let c of ccEmailsConf) {
        ccEmails = ccEmails.concat(await getEmails.call(this, c, data));
    }
    if (toEmails.length < 1 && ccEmails.length < 1) {
        return;
    }
    dryRun ?
        debug('_sendEmail(%j, %j, %j, %s, %s, %s)', fromEmail, toEmails, ccEmails, subject, body, html) :
        await _sendEmail(fromEmail, toEmails, ccEmails, subject, body, html, attachments);
    debug('Email is sent');

};

async function getEmails(conf, form) {
    let { address: addressConf, name: nameConf } = conf;
    const result = {};
    for (let f of toArray(form)) {
        const addresses = await getValue.call(this, conf, f) || f;
        for (let address of toArray(addresses)) {
            if (!address) {
                continue;
            }
            const name = nameConf ? await getValue.call(this, nameConf, address) : undefined;
            address = addressConf ? await getValue.call(this, addressConf, address) : validateString(address);
            address && (result[address] = { name, address });
        }
    }
    return Object.values(result);
}

async function initEmailConfig(conf) {
    let { address, name, getter } = conf;
    getter || (conf.getter = 'none');
    let result = await initGetter.call(this, conf);
    assert(!result.name);
    assert(!result.address);
    result.address = address ? await initGetter.call(this, address) : undefined;
    result.name = (address && name) ? await initGetter.call(this, name) : undefined;
    return result;
}

exports.init = async function ({ transport, fromEmail, toEmails, ccEmails, subject, body, html, dryRun, sendEmpty, attachments }) {
    const { globals } = this.parentContext || this;
    fromEmail = await initEmailConfig.call(this, fromEmail);
    subject = subject ? validateString(subject.trim()) : undefined;
    body = body ? validateString(body.trim()) : undefined;

    attachments = attachments ? toArray(attachments).map(({ content, filename, type }) => {
        validateString(content);
        validateString(filename);
        type = type ? validateString(type) : undefined;
        return { content, filename, type };
    }) : [];
    attachments.length < 1 && (attachments = undefined);

    const initEmails = async emails => {
        const result = [];
        if (emails) {
            for (let conf of toArray(emails)) {
                result.push(await initEmailConfig.call(this, conf));
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
    return { transport, fromEmail, toEmails, ccEmails, subject, body, attachments, html, dryRun, sendEmpty };
};