const { validateString, toArray, getEager, toBoolean } = require('../../util');
const { ObjectType } = require('../../api-enums');
const { init: initCondition, process: processCondition } = require('../../conditions');

module.exports = {
    init: async function ({ type, dstProperty, matchCondition, single, unique }) {
        validateString(dstProperty);
        type = getEager(ObjectType, type);
        matchCondition = await initCondition(matchCondition);
        single = toBoolean(single);
        unique = unique === undefined || toBoolean(unique);
        return { type, dstProperty, matchCondition, single, unique };
    },

    convert: async function ({ type, dstProperty, matchCondition, single, unique }, data) {
        const array = toArray(data);
        if (array.length > 0) {
            const forms = (await this.api.getEntities(type)).concat();
            const action = single ? 'find' : 'filter';
            array.forEach(parent =>
                parent[dstProperty] = forms[action]((child, idx) => {
                    const result = child && processCondition(matchCondition, { parent, child });
                    result && unique && (forms[idx] = undefined);
                    return result;
                })
            );
        }
        return data;

    }
};