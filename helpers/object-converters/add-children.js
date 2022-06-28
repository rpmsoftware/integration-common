const { init: initView, getForms: getViewForms } = require('../views');
const { validateString, toArray } = require('../../util');
const { init: initCondition, process: processCondition } = require('../../conditions');

module.exports = {
    init: async function (conf) {
        const { dstProperty, matchCondition } = conf;
        conf = await initView.call(this, conf);
        conf.dstProperty = validateString(dstProperty);
        conf.matchCondition = await initCondition(matchCondition);
        return conf;
    },

    convert: async function (conf, data) {
        const children = await getViewForms.call(this, conf);
        const { dstProperty, matchCondition } = conf;
        toArray(data).forEach(parent =>
            parent[dstProperty] = children.filter(child => processCondition(matchCondition, { parent, child }))
        );
        return data;
    }
};