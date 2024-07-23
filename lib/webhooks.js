'use strict';
const { startPostServer } = require('./express');
const { ObjectType, WebhookEvents } = require('./api-enums');
const assert = require('assert');
const { createHmac } = require('crypto');
const { validateString } = require('./util');

const WebhookHeaders = {
    Instance: 'x-rpm-instance',
    InstanceID: 'x-rpm-instanceid',
    Subscriber: 'x-rpm-subscriber',
    Signature: 'x-rpm-signature'
};

const HEADER_PATTERNS = {
    'user-agent': /^RPM-Webhook$/,
    'content-type': /^application\/json/
};
HEADER_PATTERNS[WebhookHeaders.InstanceID] = /^\d+$/;
HEADER_PATTERNS[WebhookHeaders.Subscriber] = /^\d+$/;

const validateHeaders = headers => {
    for (const key in HEADER_PATTERNS) {
        const value = headers[key];
        if (!HEADER_PATTERNS[key].test(value)) {
            throw new Error(`Invalid header ${key}=${value}`);
        }
    }
};

const createRpmWebHookCallback = (secret, callback) => {

    assert.strictEqual(typeof callback, 'function');

    return (req, res) => {
        let body;
        try {
            validateHeaders(req.headers);
            validateSignature(req.headers['x-rpm-signature'], req.body, secret);
            body = req.body;
            const type = typeof body;
            if (type !== 'object') {
                assert.strictEqual(type, 'string');
                body = JSON.parse(body);
            }
            validateWebHooksRequest(body);
        } catch (err) {
            res.status(400).send(err);
            console.error('Body:', req.body);
            throw err;
        }
        res.send();
        body.InstanceID = req.headers[WebhookHeaders.InstanceID];
        body.Instance = req.headers[WebhookHeaders.Instance];
        body.Subscriber = req.headers[WebhookHeaders.Subscriber];
        body.time = new Date();
        callback(body, req);
    };
};


function WebHooksRequestData(processId, formId, eventName, statusId) {
    this.ObjectID = formId;
    this.ParentID = processId;
    this.EventName = eventName;
    this.RequestID = ++WebHooksRequestData.prototype.RequestId;
    this.ObjectType = ObjectType.Form;
    this.ParentType = ObjectType.PMTemplate;
    if (statusId) {
        this.StatusID = statusId;
    }
    validateWebHooksRequest(this);
}

WebHooksRequestData.prototype.RequestId = 0;

const isWebHooksRequest = obj =>
    typeof obj === 'object' &&
    (!obj.ObjectID || typeof obj.ObjectID === 'number') &&
    (!obj.ParentID || typeof obj.ParentID === 'number') &&
    typeof obj.ObjectType === 'number' &&
    (!obj.ParentType || typeof obj.ParentType === 'number') &&
    (!obj.StatusID || typeof obj.StatusID === 'number') &&
    typeof obj.EventName === 'string';

const validateWebHooksRequest = obj => {
    if (!isWebHooksRequest(obj)) {
        throw new Error(JSON.stringify(obj) + ' is a not WebHooksRequest');
    }
};

function WebHooksRequestHeader(rpmInstanceID, rpmSubscriber, request, secret) {
    this[WebhookHeaders.InstanceID] = rpmInstanceID;
    this[WebhookHeaders.Subscriber] = rpmSubscriber;
    this['user-agent'] = 'RPM-Webhook';
    this['content-type'] = 'application/json';
    validateHeaders(this);
    validateWebHooksRequest(request);
    this[WebhookHeaders.Signature] = getSignature(request, secret);
}

const getSignature = (data, secret) => {
    validateString(secret);
    const hmac = createHmac('sha256', secret);
    hmac.update(typeof data === 'object' ? JSON.stringify(data) : '' + data);
    return hmac.digest('hex');
};

const validateSignature = (signRecieved, data, secret) => {
    const signCalculated = getSignature(data, secret);
    if (signCalculated !== signRecieved) {
        throw new Error(`Wrong signature. Calculated: ${signCalculated}, recieved: ${signRecieved}`);
    }
};

module.exports = {
    createRpmWebHookCallback,
    isWebHooksRequest,
    WebHooksRequestData,
    WebHooksRequestHeader,
    WebhookHeaders,
    validateSignature,
    getSignature,
    start: (config, callback) => startPostServer(config, createRpmWebHookCallback(config.signSecret, callback)),

    EVENT_FORM_START: WebhookEvents.FormStar,
    EVENT_FORM_EDIT: WebhookEvents.FormEdit,
    EVENT_FORM_TRASH: WebhookEvents.FormTrash,
    EVENT_FORM_RESTORE: WebhookEvents.FormRestore,
    EVENT_ACTION_START: WebhookEvents.ActionAdd,
    EVENT_ACTION_EDIT: WebhookEvents.ActionEdit,
    EVENT_ACTION_TRASH: WebhookEvents.ActionTrash,
};
