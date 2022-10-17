const { validateString, toArray, toBoolean, validatePropertyConfig, isEmpty, getDeepValue } = require('../../util');
const { initMultiple, get: getValue } = require('../getters');
const assert = require('assert');


module.exports = {
    init: async function ({ idProperty, nameProperty, customerIdProperty, supplierIdProperty, create, dstProperty, propertyMap, fieldMap }) {
        validateString(dstProperty);
        idProperty = validatePropertyConfig(idProperty);
        create = toBoolean(create) || undefined;
        customerIdProperty = customerIdProperty ? validatePropertyConfig(customerIdProperty) : undefined;
        supplierIdProperty = supplierIdProperty ? validatePropertyConfig(supplierIdProperty) : undefined;
        nameProperty = nameProperty ? validatePropertyConfig(nameProperty) : undefined;
        if (create) {
            assert(customerIdProperty);
            assert(supplierIdProperty);
            assert(nameProperty);
        }
        const defaultNoGetterConverter = property => ({ getter: 'property', property, default: null });
        propertyMap = await initMultiple.call(this, propertyMap || {}, defaultNoGetterConverter);
        fieldMap = await initMultiple.call(this, fieldMap || {}, defaultNoGetterConverter);
        isEmpty(fieldMap) && assert(!isEmpty(propertyMap));
        return { idProperty, customerIdProperty, supplierIdProperty, create, dstProperty, propertyMap, fieldMap };
    },


    convert: async function ({ idProperty, customerIdProperty, supplierIdProperty, nameProperty, create, dstProperty, propertyMap, fieldMap }, obj) {
        const { api } = this;
        for (const e of toArray(obj)) {
            const accountID = +getDeepValue(e, idProperty);
            if (!accountID && !create) {
                continue;
            }
            let customerID, supplierID, name;
            if (create && !accountID) {
                customerID = +getDeepValue(e, customerIdProperty);
                if (!customerID) {
                    continue;
                }
                supplierID = +getDeepValue(e, supplierIdProperty);
                if (!supplierID) {
                    continue;
                }
                name = getDeepValue(e, nameProperty);
                if (!nameProperty) {
                    continue;
                }
            }
            const fieldPatch = [];
            for (const Field in fieldMap) {
                const Value = await getValue.call(this, fieldMap[Field], e);
                Value === undefined || fieldPatch.push({ Field, Value });
            }
            let props = {};
            for (let k in propertyMap) {
                const v = await getValue.call(this, propertyMap[k], e);
                v === undefined || (props[k] = v);
            }
            const noFields = fieldPatch.length < 1;
            if (noFields && isEmpty(props)) {
                continue;
            }
            noFields || (props.Fields = fieldPatch);
            let result;
            if (accountID) {
                try {
                    result = await api.editAccount(accountID, props);
                } catch (e) {
                    if (!create) {
                        throw e;
                    }
                    result = await api.createAccount(name, customerID, supplierID, props);
                    result._created = true;
                }
            } else if (create) {
                result = await api.createAccount(name, customerID, supplierID, props);
                result._created = true;
            }
            e[dstProperty] = result;
        }
        return obj;
    }
};
