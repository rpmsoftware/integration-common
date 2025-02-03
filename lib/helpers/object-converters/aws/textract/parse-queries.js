const {
    validateString, toArray, validatePropertyConfig, getDeepValue
} = require("../../../../util");
const { parseQueries } = require('../../../../aws/textract/query-parser');

module.exports = {
    init: function ({ tables, dstProperty, srcProperty }) {
        validatePropertyConfig(srcProperty);
        validateString(dstProperty);
        if (tables || (tables = undefined)) {
            for (let queryOrAlias in tables) {
                validateString(tables[queryOrAlias]);
            }
        }
        return { srcProperty, dstProperty, tables };
    },

    convert: function (cfg, obj) {
        let { srcProperty, dstProperty } = cfg;
        const parse = parseQueries.bind(cfg);
        for (const o of toArray(obj)) {
            let data = getDeepValue(o, srcProperty);
            if (!data) {
                continue;
            }
            o[dstProperty] = parse(data);
        }
        return obj;
    }
};