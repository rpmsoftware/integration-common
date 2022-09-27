const { validateString, toArray, toBoolean, validatePropertyConfig, isEmpty, getDeepValue, getEager, throwError } = require('../../util');
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
    init: async function ({
        type, create, idProperty, nameProperty, dstProperty, fieldMap: inFieldMap, propertyMap: inPropertyMap, verify, errProperty
    }) {
        typeof type === 'string' && (type = getEager(ObjectType, type));
        getEager(OBJECT_UPDATERS, type);
        validateString(dstProperty);
        errProperty = errProperty ? validateString(errProperty) : undefined;
        create = toBoolean(create) || undefined;
        verify = toBoolean(verify) || undefined;
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
        return { type, create, idProperty, nameProperty, dstProperty, fieldMap, propertyMap, errProperty, verify };
    },
    convert: async function ({
        type, create, idProperty, nameProperty, dstProperty, fieldMap, propertyMap, verify, errProperty
    }, obj) {
        const { api } = this;
        const { create: createEntity, edit: editEntity } = OBJECT_UPDATERS[type];
        for (const e of toArray(obj)) {
            const id = idProperty ? +getDeepValue(e, idProperty) : undefined;
            const name = nameProperty ? getDeepValue(e, nameProperty) : undefined;
            if (!id && !name) {
                continue;
            }
            const fieldPatch = [];
            for (const Field in fieldMap) {
                const Value = await getDeepValue(e, fieldMap[Field]);
                Value === undefined || fieldPatch.push({ Field, Value });
            }
            const props = {};
            name && (props.Name = name);
            for (let k in propertyMap) {
                const v = getDeepValue(e, propertyMap[k]);
                v === undefined || (props[k] = v);
            }
            if (isEmpty(fieldPatch)) {
                delete propertyMap.Fields;
            } else {
                props.Fields = fieldPatch;
            }
            let beforeUpdate = id && await api.getEntity(type, id);
            beforeUpdate || (beforeUpdate = name && await api.getEntity(name));
            let afterUpdate;
            if (beforeUpdate) {
                name && beforeUpdate.Name !== name && (props.Name = name);
                isEmpty(props) || (afterUpdate = await editEntity.call(api, beforeUpdate.EntityID, props));
            } else if (create) {
                assert(name);
                props.Name = name;
                afterUpdate = await createEntity.call(api, props);
            }
            if (verify && afterUpdate) {
                const { Fields: fieldsAfter } = afterUpdate;
                assert(fieldsAfter);
                let errors = [];
                for (const { Field, Value } of fieldPatch) {
                    const { Value: Result } = fieldsAfter.demand(({ Field: fieldName }) => fieldName === Field);
                    Result === Value || errors.push({ Field, Value, Result });
                }
                errors.length > 0 || (errors = undefined);
                if (!errProperty && errors) {
                    throwError(`Field(s) didn't update: ${JSON.stringify(errors)}`, FIELD_UPDATE_ERROR, errors);
                }
                e[errProperty] = errors;
            }
            e[dstProperty] = afterUpdate;
        }
        return obj;
    }
};

const FIELD_UPDATE_ERROR = 'FieldUpdateError';