const { validatePropertyConfig, getDeepValue } = require('../util');

module.exports = {
    init: conf => {
        const { property, value } = conf;
        return value === undefined ? { property: validatePropertyConfig(property || conf) } : { value };
    },
    get: ({ property, value }, obj) => value === undefined ? getDeepValue(obj, property) : value
};