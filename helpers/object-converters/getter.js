const { init: initGetter, get } = require('../getters');
const { validateString, toArray } = require('../../util');
const { init: initCondition, process: processCondition } = require('../../conditions');

module.exports = {
    init: async function (conf) {
        let { dstProperty, condition } = conf;
        validateString(dstProperty);
        condition = condition ? initCondition.call(this, condition) : undefined;
        conf = await initGetter.call(this, conf);
        conf.dstProperty = dstProperty;
        conf.condition = condition;
        return conf;
    },
    convert: async function (conf, obj) {
        const { dstProperty, condition } = conf;
        for (const e of toArray(obj)) {
            (!condition || processCondition(condition, e)) &&
                (e[dstProperty] = await get.call(this, conf, e));
        }
        return obj;
    }
};