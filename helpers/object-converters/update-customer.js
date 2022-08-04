const { validateString, toArray, toBoolean, validatePropertyConfig, isEmpty, getDeepValue } = require('../../util');
const { initMultiple, get } = require('../../helpers/getters');
const assert = require('assert');

module.exports = {
    init: async function ({ create, customerID, customerName, dstProperty, fieldMap, propertyMap: inPropertyMap }) {
        validateString(dstProperty);
        create = toBoolean(create) || undefined;
        customerID = customerID ? validatePropertyConfig(customerID) : undefined;
        customerName = customerName ? validatePropertyConfig(customerName) : undefined;
        customerID === undefined && assert(customerName);
        fieldMap = fieldMap ? await initMultiple.call(this, fieldMap) : {};
        let propertyMap = {};
        if (inPropertyMap) {
            for (let k in inPropertyMap) {
                propertyMap[k] = validatePropertyConfig(inPropertyMap[k]);
            }
        }
        isEmpty(fieldMap) && assert(!isEmpty(propertyMap));
        return { create, customerID, customerName, dstProperty, fieldMap, propertyMap };
    },
    convert: async function ({ create, customerID, customerName, dstProperty, fieldMap, propertyMap }, obj) {
        const { api } = this;
        for (const e of toArray(obj)) {
            const id = +getDeepValue(e, customerID);
            const name = getDeepValue(e, customerName);
            if (!id && !name) {
                continue;
            }
            const fields = [];
            for (const Field in fieldMap) {
                const Value = await get.call(this, fieldMap[Field], e);
                Value === undefined || fields.push({ Field, Value });
            }
            const props = {};
            name && (props.Name = name);
            for (let k in propertyMap) {
                const v = getDeepValue(e, propertyMap[k]);
                v === undefined || (props[k] = v);
            }
            if (isEmpty(fields)) {
                delete propertyMap.Fields;
            } else {
                props.Fields = fields;
            }

            let c = id && await api.getCustomer(id);
            c || (c = await api.getCustomer(name));
            if (c) {
                name && c.Name !== name && (props.Name = name);
                isEmpty(props) || (c = await api.editCustomer(c.CustomerID, props));
            } else if (create) {
                assert(name);
                props.Name = name;
                c = await api.createCustomer(props);
            }
            e[dstProperty] = c;
        }
        return obj;
    }
};
