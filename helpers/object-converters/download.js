const { validateString, toArray, toBoolean, getDeepValue, validatePropertyConfig, fetch2json,fetch } = require('../../util');

module.exports = {
    init: function ({ dstProperty, url, json }) {
        validateString(dstProperty);
        url = validatePropertyConfig(url);
        json = toBoolean(json) || undefined;
        return { dstProperty, url, json };
    },

    convert: async function ({ dstProperty, url: urlProperty, json }, data) {
        const parse = json ? fetch2json : response => response.text();
        for (const e of toArray(data)) {
            const url = getDeepValue(e, urlProperty);
            e[dstProperty] = url ? await fetch(url).then(parse) : undefined;
        }
        return data;
    }
};

