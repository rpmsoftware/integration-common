const assert = require('assert');
const { getEager } = require('../util');
const { getField } = require('../api-wrappers');

const BASIC_FIELD_GETTERS = {
    getFormNumber: {
        init: async function (cfg) {
            return {
                process: (await this.api.getProcesses()).getActiveProcess(cfg.process, true).ProcessID
            };
        },
        get: async function (cfg, object) {
            const id = getField.call(object, cfg.srcField, true).ID || undefined;
            return id && (await this.api.getFormList(cfg.process)).Forms.demand(f => f.ID === id).N;
        }
    }
};

async function init(cfg) {
    let result;
    const type = typeof cfg;
    if (type === 'string') {
        result = { srcField: cfg };
    } else {
        assert.equal(type, 'object');
        if (cfg.getter) {
            const init = getEager(BASIC_FIELD_GETTERS, cfg.getter).init;
            result = init ? await init.call(this, cfg) : {};
            result.getter = cfg.getter;
        } else {
            result = {};
        }
        result.srcField = cfg.srcField;
        result.nulls = !!cfg.nulls;
    }
    return result;
}

function defaultGetter(cfg, object) {
    return getField.call(object, cfg.srcField, true).Value || undefined;
}

function get(cfg, object) {
    const result = (cfg.getter ? getEager(BASIC_FIELD_GETTERS, cfg.getter).get : defaultGetter).call(this, cfg, object);
    return result === undefined && cfg.nulls ? null : result;
}

module.exports = { get, init };

