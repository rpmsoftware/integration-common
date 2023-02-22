const { validateString, toArray, toBoolean, validatePropertyConfig, isEmpty, getDeepValue } = require('../../util');
const { initMultiple, get: getValue } = require('../getters');
const assert = require('assert');

module.exports = {
    init: async function ({
        idProperty, nameProperty, customerIdProperty, supplierIdProperty,
        create, dstProperty, propertyMap, fieldMap, errorProperty
    }) {
        errorProperty = errorProperty ? validateString(errorProperty) : undefined;
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
        return { idProperty, nameProperty, customerIdProperty, supplierIdProperty, create, dstProperty, propertyMap, fieldMap, errorProperty };
    },


    convert: async function ({
        idProperty, customerIdProperty, supplierIdProperty,
        nameProperty, create, dstProperty, propertyMap, fieldMap, errorProperty
    }, obj) {
        const { api } = this;
        for (const srcObj of toArray(obj)) {
            const accountID = +getDeepValue(srcObj, idProperty);
            if (!accountID && !create) {
                continue;
            }
            let customerID, supplierID, name;
            customerID = +getDeepValue(srcObj, customerIdProperty);
            supplierID = +getDeepValue(srcObj, supplierIdProperty);
            name = getDeepValue(srcObj, nameProperty);
            if (!(accountID || customerID && supplierID && name)) {
                continue;
            }
            const fieldPatch = [];
            for (const Field in fieldMap) {
                const Value = await getValue.call(this, fieldMap[Field], srcObj);
                Value === undefined || fieldPatch.push({ Field, Value });
            }
            let props = {};
            for (let k in propertyMap) {
                const v = await getValue.call(this, propertyMap[k], srcObj);
                v === undefined || (props[k] = v);
            }
            if (fieldPatch.length > 0) {
                props.Fields = fieldPatch
            } else {
                delete props.Fields;
            }
            if (isEmpty(props)) {
                continue;
            }
            let beforeUpdate;
            let result;

            try {
                if (accountID) {
                    result = await api.editAccount(accountID, props).catch(async err => {
                        beforeUpdate = await api.getAccount(accountID);
                        if (beforeUpdate) {
                            throw err;
                        }
                    });
                }
                if (!result && name && supplierID) {
                    beforeUpdate = await api.getAccount(name, supplierID).catch(() => undefined);
                    beforeUpdate && (result = await api.editAccount(beforeUpdate.AccountID, props));
                }
                if (!result && create) {
                    result = await api.createAccount(name, customerID, supplierID, props);
                    result._created = true;
                }
            } catch (err) {
                if (!errorProperty) {
                    throw err;
                }
                let { Supplier, SupplierID, Name: supName } = beforeUpdate ||
                    supplierID && await api.getSupplier(supplierID) ||
                    { SupplierID: supplierID };
                Supplier || (Supplier = supName);
                let { Customer, CustomerID, Name: custName } = beforeUpdate ||
                    customerID && await api.getCustomer(customerID) ||
                    { CustomerID: customerID };
                Customer || (Customer = custName);
                srcObj[errorProperty] = {
                    Error: (err.Message || err).toString(),
                    TimeStamp: new Date().toISOString(),
                    AccountID: beforeUpdate?.AccountID || accountID,
                    Account: beforeUpdate?.Account || name,
                    CustomerID, Customer, SupplierID, Supplier
                };
            }
            srcObj[dstProperty] = result;
        }
        return obj;
    }
};
