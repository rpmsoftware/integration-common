const { getDeepValue, validatePropertyConfig, validateString, toArray } = require('../../util');
const createPDF = require('integration-common/pdf-printer');
const assert = require('assert');

module.exports = {
    init: async function ({ documentDefinition, dstProperty }) {
        validateString(dstProperty);
        let { property } = documentDefinition;
        if (property || (property = undefined)) {
            property = validatePropertyConfig(property);
            documentDefinition = { property };
        } else {
            documentDefinition = { value: JSON.parse(validateString(documentDefinition)) };
        }
        return { documentDefinition, dstProperty };
    },

    convert: async function ({ documentDefinition, dstProperty }, data) {
        const { property, value } = documentDefinition;

        let getDocDef;
        if (property) {
            getDocDef = e => {
                const dd = getDeepValue(e, property);
                // console.log(dd);
                return dd && JSON.parse(dd);
            };
        } else {
            assert(value);
            getDocDef = () => value;
        }

        for (const e of toArray(data)) {
            const docDef = getDocDef(e);
            const buffer = await createPDF(docDef);
            Object.defineProperty(e, dstProperty, { value: buffer, configurable: true });
        }
        return data;
    }
};