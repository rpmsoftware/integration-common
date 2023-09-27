const { validateString, toArray, isEmpty } = require('../../util');
const { render } = require('mustache');
const assert = require('assert');

module.exports = {
    init: function ({ dstProperty, template, templates }) {
        const m = {};
        if (templates) {
            for (const dstProperty in templates) {
                m[dstProperty] = validateString(templates[dstProperty]);
            }
        } else {
            m[validateString(dstProperty)] = validateString(template);
        }
        assert(!isEmpty(m));
        return { templates: m };
    },

    convert: function ({ templates }, data) {
        toArray(data).forEach(obj => {
            for (const dstProperty in templates) {
                obj[dstProperty] = render(templates[dstProperty], obj)
            }
        });
        return data;
    }
};