const assert = require('assert');

module.exports = {
    DEFAULT_ACCESSOR_NAME: 'default',
    getFullType: function (fieldType, subType) {
        if (typeof fieldType === 'object') {
            subType = fieldType.SubType;
            fieldType = fieldType.FieldType;
        }
        assert.equal(typeof fieldType, 'number');
        assert.equal(typeof subType, 'number');
        return `RPM_${fieldType}_${subType}`;
    }
};