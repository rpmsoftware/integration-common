const { init: initView, getForms: getViewForms } = require('../views');
const { validateString, toArray, toBoolean } = require('../../util');
const { init: initCondition, process: processCondition } = require('../../conditions');

module.exports = {
    init: async function (conf) {
        const { condition, dstProperty, matchCondition, single, unique, onlyFormID } = conf;
        conf = await initView.call(this, conf);
        conf.single = toBoolean(single);
        conf.unique = unique === undefined || toBoolean(unique);
        conf.dstProperty = validateString(dstProperty);
        conf.matchCondition = await initCondition(matchCondition);
        conf.onlyFormID = toBoolean(onlyFormID) || undefined;
        conf.condition = condition ? await initCondition(condition) : undefined;
        return conf;
    },

    convert: async function (conf, data) {
        const { condition, dstProperty, matchCondition, single, unique, onlyFormID } = conf;
        const action = single ? 'find' : 'filter';
        let forms;
        for (const parent of toArray(data)) {
            if (condition && !processCondition(condition, parent)) {
                continue;
            }
            forms || (forms = await getViewForms.call(this, conf));
            const result = forms[action]((child, idx) => {
                const result = child && processCondition(matchCondition, { parent, child });
                result && unique && (forms[idx] = undefined);
                return result;
            });
            parent[dstProperty] = onlyFormID ? result?.FormID : result;
        }
        return data;
    }
};