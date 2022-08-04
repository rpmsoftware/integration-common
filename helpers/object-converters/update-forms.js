const { validateString, toArray } = require('../../util');
const { init, process } = require('../../processors/generic2forms');

module.exports = {
    init: async function (conf) {
        let { dstProperty } = conf;
        dstProperty = dstProperty ? validateString(dstProperty) : undefined;
        conf = await init.call(this, conf);
        conf.dstProperty = dstProperty;
        return conf;
    },
    convert: async function (conf, obj) {
        const { dstProperty } = conf;
        for (const e of toArray(obj)) {
            const r = await process.call(this, conf, e);
            dstProperty && (e[dstProperty] = r);
        }
        return obj;
    }
};
