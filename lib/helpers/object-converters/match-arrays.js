const { validateString, toArray, toBoolean, validatePropertyConfig, getDeepValue } = require('../../util');
const { init: initCondition, process: processCondition } = require('../../conditions');

const PROP_MATCHED = Symbol();

module.exports = {
    init: function ({ parents, children, dstProperty, matchCondition, single, unique, unmatched }) {
        parents = validatePropertyConfig(parents);
        children = validatePropertyConfig(children);
        single = toBoolean(single);
        unique = unique === undefined || toBoolean(unique);
        dstProperty = validateString(dstProperty);
        matchCondition = initCondition(matchCondition);
        unmatched = unmatched ? validateString(unmatched) : undefined;
        return { parents, children, dstProperty, matchCondition, single, unique, unmatched };
    },

    convert: function ({ parents, children, dstProperty, matchCondition, single, unique, unmatched }, data) {
        const action = single ? 'find' : 'filter';
        toArray(data).forEach(e => {
            let chldrn = toArray(getDeepValue(e, children));
            if (chldrn.length < 1) {
                return;
            }
            const cc = unique ? chldrn.concat() : chldrn;
            toArray(getDeepValue(e, parents)).forEach(parent => {
                const result = cc[action]((child, idx) => {
                    const result = child && processCondition(matchCondition, { parent, child });
                    if (result) {
                        unique && (cc[idx] = undefined);
                        child[PROP_MATCHED] = true;
                    }
                    return result;
                });
                parent[dstProperty] = result;
            });
            unmatched && (e[unmatched] = chldrn.filter(c => {
                const matched = c[PROP_MATCHED];
                delete c[PROP_MATCHED];
                return !matched;
            }));
        });
        return data;
    }
};