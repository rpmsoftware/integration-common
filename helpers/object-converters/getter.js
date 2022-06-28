const { init: initGetter, get } = require('../getters');
const { validateString, toArray } = require('../../util');

module.exports = {
    init: async function (conf) {
        const { dstProperty } = conf;
        validateString(dstProperty);
        conf = await initGetter.call(this, conf);
        conf.dstProperty = dstProperty;
        return conf;
    },
    convert: async function (conf, obj) {
        const { dstProperty } = conf;
        for (const e of toArray(obj)) {
            e[dstProperty] = await get.call(this, conf, e);
        }
        return obj;
    }
};