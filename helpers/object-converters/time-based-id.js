const { validateString, toArray, createTimeBasedIDGenerator } = require('../../util');
const { init: initCondition, process: processCondition } = require('../../conditions');

module.exports = {
    init: function ({ dstProperty, start, condition }) {
        validateString(dstProperty);
        start || (start = undefined);
        condition = condition ? initCondition(condition) : undefined;
        return { dstProperty, start, condition };
    },
    convert: function (conf, obj) {
        let { dstProperty, start, condition, getID } = conf;
        getID || (getID = conf.getID = createTimeBasedIDGenerator(start));
        for (const e of toArray(obj)) {
            condition && !processCondition(condition, e) || (e[dstProperty] = getID());
        }
        return obj;
    }
};
