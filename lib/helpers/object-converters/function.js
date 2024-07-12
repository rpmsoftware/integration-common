const util = require('../../util');
const { validateString, getEager, toArray } = util;
const { propertyOrValue } = require('./util');

module.exports = {
    init: function ({ parameters, dstProperty, function: f }) {
        getEager(util, f);
        dstProperty || (dstProperty = parameters);
        validateString(dstProperty);
        parameters = toArray(parameters).map(propertyOrValue.init);
        return { parameters, dstProperty, function: f };
    },

    convert: function ({ parameters, dstProperty, function: f }, data) {
        toArray(data).forEach(obj =>
            obj[dstProperty] = util[f].apply(obj, parameters.map(p => propertyOrValue.get(p, obj)))
        );
        return data;
    }
};