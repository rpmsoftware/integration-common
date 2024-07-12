const { validateString, toArray, getDeepValue } = require('../../util');
const { propertyOrValue } = require('./util');
const createPDF = require('../../pdf-printer');
const { writeFileSync } = require('fs');
const assert = require('assert');

module.exports = {
    init: async function ({ documentDefinition, dstProperty, fileName }) {
        documentDefinition = propertyOrValue.init(documentDefinition);
        if (fileName || (fileName = undefined)) {
            fileName = propertyOrValue.init(fileName);
            dstProperty = undefined;
        } else {
            validateString(dstProperty);
        }
        return { documentDefinition, dstProperty, fileName };
    },

    convert: async function ({ documentDefinition, dstProperty, fileName }, data) {

        let getDocDef;
        {
            let { property, value } = documentDefinition;
            if (property) {
                getDocDef = e => {
                    const dd = getDeepValue(e, property);
                    try {
                        return dd && JSON.parse(dd);
                    } catch (e) {
                        console.error('Document Definition:', dd);
                        throw e;
                    }

                };
            } else {
                assert(value);
                value = JSON.parse(value)
                getDocDef = () => value;
            }
        }

        const output = dstProperty ?
            (e, buffer) => Object.defineProperty(e, dstProperty, { value: buffer, configurable: true }) :
            (e, buffer) => writeFileSync(validateString(propertyOrValue.get(fileName, e)), buffer)
        ;
        for (const e of toArray(data)) {
            const docDef = getDocDef(e);
            const buffer = await createPDF(docDef);
            output(e, buffer);
        }
        return data;
    }
};