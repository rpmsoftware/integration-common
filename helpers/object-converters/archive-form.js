const assert = require('assert');
const { toArray, toBoolean, validatePropertyConfig, getDeepValue } = require('../../util');

module.exports = {
    init: function ({ formIDProperty, archive }) {
        formIDProperty = validatePropertyConfig(formIDProperty);
        if (typeof archive === 'object') {
            let { property, not } = archive;
            property = validatePropertyConfig(property);
            not = toBoolean(not) || undefined;
            archive = { property, not };
        } else {
            archive = archive === undefined || toBoolean(archive);
        }
        return { formIDProperty, archive };

    },
    convert: async function ({ formIDProperty, archive }, obj) {
        assert.strictEqual(typeof archive, 'boolean', 'Not implemented');
        const { api } = this;
        for (const source of toArray(obj)) {
            const formID = +getDeepValue(source, formIDProperty);
            formID && await api.setFormArchived(formID, archive);
        }
        return obj;
    }
};
