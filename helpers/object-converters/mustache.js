const { validateString, toArray } = require('../../util');
const { render } = require('mustache');

module.exports = {
    init: function ({ dstProperty, template }) {
        validateString(dstProperty);
        validateString(template);
        return dstProperty, template;
    },

    convert: function ({ dstProperty, template }, data) {
        toArray(data).forEach(obj => obj[dstProperty] = render(template, obj));
        return data;
    }
};