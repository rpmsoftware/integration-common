const { validateString, toArray, toBoolean, validatePropertyConfig, isEmpty, getDeepValue, getEager, throwError } = require('../../util');
const { ObjectType } = require('../../api-enums');
const { init: initCondition, process: processCondition } = require('../../conditions');
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
OBJECT_UPDATERS[ObjectType.Supplier] = {
    edit: function (id, props) {
        return this.editSupplier(id, props);
    },
    create: function (props) {
        return this.createSupplier(props);
    }
};

module.exports = {
    init: async function ({
        type, create, idProperty, nameProperty, dstProperty, fieldMap: inFieldMap,
        propertyMap: inPropertyMap, verify, errProperty,
        condition
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
        condition = condition ? initCondition(condition) : undefined;
        return { type, create, idProperty, nameProperty, dstProperty, fieldMap, propertyMap, errProperty, verify, condition };
    },
    convert: async function ({
        type, create, idProperty, nameProperty, dstProperty, fieldMap, propertyMap, verify, errProperty, condition
    }, obj) {
        const { api } = this;
        const { create: createEntity, edit: editEntity } = OBJECT_UPDATERS[type];
        for (const e of toArray(obj)) {
            if (condition && !processCondition(condition, e)) {
                continue;
            }
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
            beforeUpdate || (name && await api.getEntity(type, name));
            let afterUpdate;
            if (beforeUpdate) {
                isEmpty(props) || (afterUpdate = await editEntity.call(api, beforeUpdate.EntityID, props));
            } else if (create) {
                afterUpdate = await createEntity.call(api, props);
                afterUpdate._created = true;
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