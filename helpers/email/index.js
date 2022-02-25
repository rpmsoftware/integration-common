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
        dryRun,
        sendEmpty
    } = conf;
    if (!sendEmpty && isEmpty(data)) {
        debug('There is nothing to send');
        return;
    }
    const { globals } = this.parentContext;
    let ctx;
    if (typeof transport === 'string') {
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
    console.log(data)

    subject = subject && render(subject, data);
    body = body && render(body, data);
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
        await _sendEmail(fromEmail, toEmails, ccEmails, subject, body, html);
    debug('Email is sent');

};

async function getEmails(conf, form) {
    let { address: addressConf, name: nameConf } = conf;
    const result = [];
    for (let f of toArray(form)) {
        const address = await getValue.call(this, addressConf, f);
        address && result.push({
            address,
            name: nameConf ? await getValue.call(this, nameConf, f) : undefined
        });
    }
    return result;
}

async function initEmailConfig(conf) {
    let { address, name } = conf;
    let result;
    if (address) {
        try {
            result = await initGetter.call(this, conf);
        } catch {
            result = {};
        }
    } else {
        address = conf;
        result = {};
    }
    assert(!result.name);
    assert(!result.address);
    result.name = name ? await initGetter.call(this, name) : undefined;
    result.address = await initGetter.call(this, address);
    assert(result.address);
    return result;
}

exports.init = async function ({ transport, fromEmail, toEmails, ccEmails, subject, body, html, dryRun, sendEmpty }) {
    const { globals } = this;
    fromEmail = await initEmailConfig.call(this, fromEmail);
    subject = subject ? validateString(subject.trim()) : undefined;
    body = body ? validateString(body.trim()) : undefined;

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
    return { transport, fromEmail, toEmails, ccEmails, subject, body, html, dryRun, sendEmpty };
};