const { validateString, toArray, toBoolean, validatePropertyConfig, isEmpty, getDeepValue } = require('../../util');
const { initMultiple, getMultiple } = require('../../helpers/getters');
const assert = require('assert');

module.exports = {
    init: async function ({ customerID, locationID, create, dstProperty, propertyMap }) {
        validateString(dstProperty);
        customerID = validatePropertyConfig(customerID);
        locationID = validatePropertyConfig(locationID);
        create = toBoolean(create) || undefined;
        propertyMap = await initMultiple.call(this, propertyMap, c => ({ getter: 'property', property: c, default: null }));
        assert(!isEmpty(propertyMap));
        return { customerID, locationID, create, dstProperty, propertyMap };
    },
    convert: async function ({ customerID, locationID, create, dstProperty, propertyMap }, obj) {
        const { api } = this;
        for (const e of toArray(obj)) {
            const cid = +getDeepValue(e, customerID);
            if (!cid) {
                continue;
            }
            const lid = +getDeepValue(e, locationID);
            const props = await getMultiple.call(this, propertyMap, e);
            let l;
            if (lid) {
                try {
                    l = await api.editCustomerLocation(cid, lid, props);
                } catch (e) {
                    if (!create) {
                        throw e;
                    }
                    l = await api.addCustomerLocation(cid, props);
                }
            } else if (create) {
                l = await api.addCustomerLocation(cid, props);
            }
            e[dstProperty] = l;
        }
        return obj;
    }
};
