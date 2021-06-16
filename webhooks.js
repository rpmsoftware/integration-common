'use strict';
const { startPostServer } = require('./express');
const { ObjectType, WebhookEvents } = require('./api-enums');
const hash = require('object-hash');
const assert = require('assert');
const { createHmac } = require('crypto');

const headerPatterns = {
    'x-rpm-instanceid': /^\d+$/,
    'x-rpm-subscriber': /^\d+$/,
    'user-agent': /^RPM-Webhook$/,
    'content-type': /^application\/json/
};

const validateHeaders = headers => {
    for (const key in headerPatterns) {
        const value = headers[key];
        if (!headerPatterns[key].test(value)) {
            throw new Error(`Invalid header ${key}=${value}`);
        }
    }
};

const EVENT_ID_PROPERTIES = ['Subscriber', 'InstanceID', 'EventName', 'ObjectType', 'ParentType', 'ParentID', 'ObjectID'];
const EVENTS_GAP_MS = 500;

const createRpmWebHookCallback = exports.createRpmWebHookCallback = (secret, callback) => {

    assert.strictEqual(typeof callback, 'function');
    const eventHashes = {};

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
        body.InstanceID = req.headers['x-rpm-instanceid'];
        body.Instance = req.headers['x-rpm-instance'];
        body.Subscriber = req.headers['x-rpm-subscriber'];
        const h = hash(EVENT_ID_PROPERTIES.map(p => body[p]));
        const lastTime = eventHashes[h];
        const date = new Date();
        const time = date.getTime();
        if (lastTime && time - lastTime < EVENTS_GAP_MS) {
            return;
        }
        eventHashes[h] = time;
        body.time = date;
        callback(body, req);
    };
};

exports.start = (config, callback) => startPostServer(config, createRpmWebHookCallback(config.signSecret, callback));

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
exports.WebHooksRequestData = WebHooksRequestData;

exports.EVENT_FORM_START = WebhookEvents.FormStart;
exports.EVENT_FORM_EDIT = WebhookEvents.FormEdit;
exports.EVENT_FORM_TRASH = WebhookEvents.FormTrash;
exports.EVENT_FORM_RESTORE = WebhookEvents.FormRestore;
exports.EVENT_ACTION_START = WebhookEvents.ActionAdd;
exports.EVENT_ACTION_EDIT = WebhookEvents.ActionEdit;
exports.EVENT_ACTION_TRASH = WebhookEvents.ActionTrash;

const isWebHooksRequest = exports.isWebHooksRequest = obj =>
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

exports.WebHooksRequestHeader = function WebHooksRequestHeader(rpmInstanceID, rpmSubscriber, request, secret) {
    this['x-rpm-instanceid'] = rpmInstanceID;
    this['x-rpm-subscriber'] = rpmSubscriber;
    this['user-agent'] = 'RPM-Webhook';
    this['content-type'] = 'application/json';
    validateHeaders(this);
    validateWebHooksRequest(request);
    this['x-rpm-signature'] = getSignature(request, secret);
};

const getSignature = (data, secret) => {
    if (secret === undefined) {
        throw new Error('Signature secret is missing');
    }
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
