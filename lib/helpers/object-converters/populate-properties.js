const { toArray, isEmpty, toBoolean } = require('../../util');
const { init: initCondition, process: processCondition } = require('../../conditions');
const { propertyOrValue } = require('./util');
const assert = require('assert');

module.exports = {
    init: async function ({ condition, properties: inProperties, demand }) {
        const properties = {};
        for (const dstProperty in inProperties) {
            properties[dstProperty] = propertyOrValue.init(inProperties[dstProperty]);
        }
        assert(!isEmpty(properties));
        condition = condition ? initCondition.call(this, condition) : undefined;
        demand = toBoolean(demand) || undefined;
        return { condition, properties, demand };
    },

    convert: async function ({ condition, properties }, obj) {
        for (const e of toArray(obj)) {
            if (condition && !processCondition(condition, e)) {
                continue;
            }
            for (const dstProperty in properties) {
                e[dstProperty] = propertyOrValue.get(properties[dstProperty], e);
            }
        }
        return obj;
    }
};