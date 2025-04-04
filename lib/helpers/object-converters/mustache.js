const { validateString, toArray, isEmpty, toBoolean } = require('../../util');
const { render } = require('mustache');
const assert = require('assert');
const { readFileSync } = require('fs');

const JSON_ESCAPE = value => value && typeof value === 'string' ? JSON.stringify(value).slice(1, -1) : value;

module.exports = {
    init: function ({ dstProperty, template, templates, json }) {
        const m = {};
        json = toBoolean(json) || undefined;
        if (templates) {
            for (const dstProperty in templates) {
                const cfg = templates[dstProperty];
                const { file } = cfg;
                m[dstProperty] = file ? readFileSync(file, 'utf-8') : validateString(cfg);
            }
        } else {
            m[validateString(dstProperty)] = validateString(template);
        }
        assert(!isEmpty(m));
        return { templates: m, json };
    },

    convert: function ({ templates, json }, data) {
        let options = {};
        json && (options.escape = JSON_ESCAPE);
        toArray(data).forEach(obj => {
            for (const dstProperty in templates) {
                obj[dstProperty] = render(templates[dstProperty], obj, undefined, options)
            }
        });
        return data;
    }
};