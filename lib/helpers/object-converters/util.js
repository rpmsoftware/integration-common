const assert = require('assert');
const { validatePropertyConfig, getDeepValue } = require('../../util');

exports.getGlobalContext = function () {
    return this.state || this;
};

exports.propertyOrValue = {
    init: conf => {
        let { value, property } = conf;
        if (value !== undefined) {
            property = undefined;
        } else if (!property) {
            property = conf;
        }
        if (property) {
            value = undefined;
            property = validatePropertyConfig(property);
        } else {
            assert(value !== undefined);
        }
        return { value, property };
    },
    get: ({ value, property }, obj) => value === undefined ? getDeepValue(obj, property) : value
};
