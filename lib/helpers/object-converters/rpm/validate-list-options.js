const { validateString, toArray, getDeepValue, validatePropertyConfig, isEmptyValue } = require('../../../util');
const { ObjectType: OT } = require('../../../api-enums');
const getRpmApi = require('../../global-instance').get.bind(undefined, 'rpmApi');
const assert = require('assert');

module.exports = {
    init: async function ({ process, fields: inFields, errorProperty }) {
        const api = await getRpmApi();
        process = (await api.getProcesses()).getActiveProcess(process, true);
        const processFields = await process.getFields();
        const fields = {};
        for (let fieldName in inFields) {
            const { FieldType, Uid, Options } = processFields.getField(fieldName, true);
            assert.strictEqual(FieldType, OT.CustomField);
            assert(Array.isArray(Options));
            fields[Uid] = validatePropertyConfig(inFields[fieldName]);
        }
        process = processFields.ProcessID;
        errorProperty = errorProperty ? validateString(errorProperty) : undefined;
        return { process, fields, errorProperty };
    },

    convert: async function ({ process, fields, errorProperty }, data) {
        const api = await getRpmApi();
        const processFields = (await api.getFields(process)).Fields.toObject('Uid');

        for (const e of toArray(data)) {
            const unknownOptions = [];
            for (const uid in fields) {
                let Value = getDeepValue(e, fields[uid]);
                if (isEmptyValue(Value)) {
                    continue;
                }
                Value += '';
                const { Options, Name: Field } = processFields[uid];
                Options.find(({ Text, IsLabel }) => !IsLabel && Text === Value)
                    || unknownOptions.push({ Field, Value });
            }
            if (unknownOptions.length < 1) {
                continue;
            }
            if (errorProperty) {
                e[errorProperty] = unknownOptions;
            } else {
                throw new TypeError('Unknown field options:\n' +
                    unknownOptions.map(({ Field, Value }) => `"${Field}":"${Value}"`).join('\n')
                );
            }
        }
        return data;
    }
};
