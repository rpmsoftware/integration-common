const { validateString, toArray, toBoolean, validatePropertyConfig, isEmpty, getDeepValue, getEager } = require('../../util');
const { ObjectType } = require('../../api-enums');
const assert = require('assert');

const OBJECT_UPDATERS = {};
OBJECT_UPDATERS[ObjectType.Customer] = {
    edit: function (id, props) {
        return this.editCustomer(id, props);
    },
    create: function (props) {
        return this.createCustomer(props);
    }
};
OBJECT_UPDATERS[ObjectType.AgentCompany] = {
    edit: function (id, props) {
        return this.editAgency(id, props);
    },
    create: function (props) {
        return this.createAgency(props);
    }
};

module.exports = {
    init: async function ({ type, create, idProperty, nameProperty, dstProperty, fieldMap: inFieldMap, propertyMap: inPropertyMap }) {
        typeof type === 'string' && (type = getEager(ObjectType, type));
        getEager(OBJECT_UPDATERS, type);
        validateString(dstProperty);
        create = toBoolean(create) || undefined;
        idProperty = idProperty ? validatePropertyConfig(idProperty) : undefined;
        nameProperty = nameProperty ? validatePropertyConfig(nameProperty) : undefined;
        idProperty === undefined && assert(nameProperty);
        const propertyMap = {};
        if (inPropertyMap) {
            for (let k in inPropertyMap) {
                propertyMap[k] = validatePropertyConfig(inPropertyMap[k]);
            }
        }
        const fieldMap = {};
        if (inFieldMap) {
            for (let k in inFieldMap) {
                fieldMap[k] = validatePropertyConfig(inFieldMap[k]);
            }
        }
        isEmpty(fieldMap) && assert(!isEmpty(propertyMap));
        return { type, create, idProperty, nameProperty, dstProperty, fieldMap, propertyMap };
    },
    convert: async function ({ type, create, idProperty, nameProperty, dstProperty, fieldMap, propertyMap }, obj) {
        const { api } = this;
        const { create: createEntity, edit: editEntity } = OBJECT_UPDATERS[type];
        for (const e of toArray(obj)) {
            const id = idProperty ? +getDeepValue(e, idProperty) : undefined;
            const name = nameProperty ? getDeepValue(e, nameProperty) : undefined;
            if (!id && !name) {
                continue;
            }
            const fields = [];
            for (const Field in fieldMap) {
                const Value = await getDeepValue(e, fieldMap[Field]);
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
            let be = id && await api.getEntity(type,id);
            be || (be = name && await api.getEntity(name));
            if (be) {
                name && be.Name !== name && (props.Name = name);
                isEmpty(props) || (be = await editEntity.call(api, be.EntityID, props));
            } else if (create) {
                assert(name);
                props.Name = name;
                be = await createEntity.call(api, props);
            }
            e[dstProperty] = be;
        }
        return obj;
    }
};
