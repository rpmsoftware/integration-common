'use strict';
(() => {

    const debug = require('debug')('rpm:webhooks');
    const util = require('util');
    const lib = require('./express');
    const { ObjectType } = require('./api-enums');

    const headerPatterns = {
        'x-rpm-instanceid': /^\d+$/,
        'x-rpm-subscriber': /^\d+$/,
        'user-agent': /^RPM-Webhook$/,
        'content-type': /^application\/json/
    };

    function validateHeaders(headers) {
        debug('validateHeaders()');
        for (const key in headerPatterns) {
            const value = headers[key];
            if (!headerPatterns[key].test(value)) {
                throw util.format('Invalid header %s=%s', key, value);
            }
        }
    }

    function createRpmWebHookCallback(secret, callback) {
        return function (req, res) {
            let body;
            try {
                validateHeaders(req.headers);
                validateSignature(req.headers['x-rpm-signature'], req.body, secret);
                body = JSON.parse(req.body);
                validateWebHooksRequest(body);
                body.time = new Date();
            } catch (err) {
                console.error('Validation error:', err);
                res.status(400).send(err);
                return;
            }
            res.send();
            body.InstanceID = req.headers['x-rpm-instanceid'];
            body.Instance = req.headers['x-rpm-instance'];
            body.Subscriber = req.headers['x-rpm-subscriber'];
            if (typeof callback === 'function') {
                callback(body, req);
            }
        };
    }

    exports.createRpmWebHookCallback = createRpmWebHookCallback;

    exports.start = function (config, callback) {
        return lib.startPostServer(config, createRpmWebHookCallback(config.signSecret, callback));
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
    exports.WebHooksRequestData = WebHooksRequestData;

    exports.EVENT_FORM_START = 'form.start';
    exports.EVENT_FORM_EDIT = 'form.edit';
    exports.EVENT_FORM_TRASH = 'form.trash';
    exports.EVENT_FORM_RESTORE = 'form.restore';
    exports.EVENT_ACTION_START = 'action.add';
    exports.EVENT_ACTION_EDIT = 'action.edit';
    exports.EVENT_ACTION_TRASH = 'action.trash';

    const isWebHooksRequest = obj =>
        typeof obj === 'object' &&
        (!obj.ObjectID || typeof obj.ObjectID === 'number') &&
        (!obj.ParentID || typeof obj.ParentID === 'number') &&
        typeof obj.ObjectType === 'number' &&
        (!obj.ParentType || typeof obj.ParentType === 'number') &&
        (!obj.StatusID || typeof obj.StatusID === 'number') &&
        typeof obj.EventName === 'string';


    exports.isWebHooksRequest = isWebHooksRequest;

    function validateWebHooksRequest(obj) {
        if (!isWebHooksRequest(obj)) {
            throw new Error(JSON.stringify(obj) + ' is a not WebHooksRequest');
        }
    }

    exports.WebHooksRequestHeader = function WebHooksRequestHeader(rpmInstanceID, rpmSubscriber, request, secret) {
        this['x-rpm-instanceid'] = rpmInstanceID;
        this['x-rpm-subscriber'] = rpmSubscriber;
        this['user-agent'] = 'RPM-Webhook';
        this['content-type'] = 'application/json';
        validateHeaders(this);
        validateWebHooksRequest(request);
        this['x-rpm-signature'] = getSignature(request, secret);
    };

    const crypto = require('crypto');

    function getSignature(data, secret) {
        if (secret === undefined) {
            throw new Error(util.format('Signature secret is missing'));
        }
        const hmac = crypto.createHmac('sha256', secret);
        hmac.update(typeof data === 'object' ? JSON.stringify(data) : '' + data);
        return hmac.digest('hex');
    }

    function validateSignature(signRecieved, data, secret) {
        debug('validateSignature()');
        const signCalculated = getSignature(data, secret);
        if (signCalculated !== signRecieved) {
            throw new Error(util.format('Wrong signature. Calculated: %s, recieved: %s', signCalculated, signRecieved));
        }
    }

})();