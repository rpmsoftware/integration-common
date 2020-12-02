const { getEager, validateString } = require('../util');
const { FIELD_TYPE } = require('../api-wrappers');

module.exports = {
    DEFAULT_ACCESSOR_NAME: 'default',
    getFullType: function (fieldTypeOrField, subType) {
        if (typeof fieldTypeOrField === 'object') {
            subType = fieldTypeOrField.SubType;
            fieldTypeOrField = fieldTypeOrField.FieldType;
        }
        if (typeof fieldTypeOrField !== 'number' || typeof subType !== 'number') {
            fieldTypeOrField = getEager(FIELD_TYPE, validateString(fieldTypeOrField));
            subType = getEager(fieldTypeOrField.subTypes, validateString(subType)).value;
            fieldTypeOrField = fieldTypeOrField.value;
        }
        return `RPM_${fieldTypeOrField}_${subType}`;
    },
    isEmptyValue: v => v === undefined || v === null || v === ''
};