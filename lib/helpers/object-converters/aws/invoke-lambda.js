/* global Buffer */

const assert = require('assert');
const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const { validateString, toBoolean, toArray, throwError } = require("integration-common/util");
const { propertyOrValue } = require('../util');

module.exports = {
    init: function ({ functionName, asyncronous, payload, dstProperty, errProperty }) {
        dstProperty = dstProperty ? validateString(dstProperty) : undefined;
        errProperty = errProperty ? validateString(errProperty) : undefined;
        functionName = propertyOrValue.init(functionName);
        asyncronous = toBoolean(asyncronous) || undefined;
        if (payload || (payload = undefined)) {
            assert.strictEqual(typeof payload, 'object');
            const pl = Array.isArray(payload) ? [] : {};
            for (const k in payload) {
                pl[k] = propertyOrValue.init(payload[k]);
            }
            payload = pl;
        }
        return { functionName, asyncronous, payload, dstProperty, errProperty };

    },

    convert: async function (conf, obj) {
        let {
            lambdaClient, functionName: functionNameCfg, asyncronous,
            payload: payloadCfg, dstProperty, errProperty
        } = conf;
        if (!lambdaClient) {
            lambdaClient = new LambdaClient();
            Object.defineProperty(conf, 'lambdaClient', { value: lambdaClient });
        }
        for (const o of toArray(obj)) {
            const FunctionName = propertyOrValue.get(functionNameCfg, o);
            if (!FunctionName) {
                return;
            }
            validateString(FunctionName);
            const payload = {};
            for (const k in payloadCfg) {
                payload[k] = propertyOrValue.get(payloadCfg[k], o);
            }
            const body = {
                FunctionName,
                LogType: 'Tail',
                Payload: JSON.stringify(payload)
            };
            asyncronous && (body.InvocationType = 'Event');
            let { Payload: result, FunctionError } = await lambdaClient.send(new InvokeCommand(body));
            errProperty && delete o[errProperty];
            dstProperty && delete o[dstProperty];
            if (asyncronous) {
                continue;
            }
            result = JSON.parse(Buffer.from(result).toString('utf8'));
            if (!FunctionError) {
                dstProperty && (o[dstProperty] = result);
                continue;
            }
            const { errorMessage, errorType } = result;
            if (!errProperty) {
                throwError(errorMessage, errorType);
            }
            const err = { errorType, errorMessage };
            console.error(err);
            o[errProperty] = err;
        }
        return obj;
    }
};