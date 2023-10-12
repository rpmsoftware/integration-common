const { init: initView, getForms: getViewForms } = require('../views');
const { validateString, toArray } = require('../../util');

module.exports = {
    init: async function (conf) {
        const { dstProperty } = conf;
        conf = await initView.call(this, conf);
        conf.dstProperty = validateString(dstProperty);
        return conf;
    },

    convert: async function (conf, data) {
        const array = toArray(data);
        if (array.length > 0) {
            const forms = await getViewForms.call(this, conf);
            const { dstProperty } = conf;
            array.forEach(parent => parent[dstProperty] = forms);
        }
        return data;
    }
};