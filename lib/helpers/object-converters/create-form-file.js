/* global Buffer */

const {
    toArray, getDeepValue, validatePropertyConfig, normalizeInteger, validateString, toBoolean
} = require('../../util');
const assert = require('assert');

const PROPS = {
    FormID: {
        required: true,
        normalize: normalizeInteger
    },
    File: {
        required: true,
        normalize: v => Buffer.isBuffer(v) ? v : Buffer.from(v, 'base64')
    },
    Name: {
        required: true,
        normalize: validateString
    },
    Description: {
        normalize: validateString
    },
    IsStaffOnly: {
        normalize: toBoolean
    },
};

module.exports = {
    init: async function ({ propertyMap: propMap }) {
        const propertyMap = {};
        for (let k in PROPS) {
            let c = propMap[k];
            c ? (propertyMap[k] = validatePropertyConfig(c)) : assert(!PROPS[k].required);
        }
        return { propertyMap };
    },

    convert: async function ({ propertyMap }, data) {
        const { api } = this;
        for (const e of toArray(data)) {
            let d = {};
            for (let k in propertyMap) {
                const v = getDeepValue(e, propertyMap[k]) || undefined;
                const { normalize, required } = PROPS[k];
                if (v) {
                    d[k] = normalize(v);
                } else if (required) {
                    d = undefined;
                    break;
                }
            }
            d && await api.addFormFile(d);
        }
        return data;
    }
};