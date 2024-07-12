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

        let getArchived;
        if (typeof archive === 'boolean') {
            getArchived = () => archive;
        } else {
            const { property, not } = archive;
            getArchived = source => {
                const v = toBoolean(getDeepValue(source, property));
                return not ? !v : v;
            };
        }

        const { api } = this;
        for (const source of toArray(obj)) {
            const formID = +getDeepValue(source, formIDProperty);
            formID && await api.setFormArchived(formID, getArchived(source));
        }
        return obj;
    }
};
