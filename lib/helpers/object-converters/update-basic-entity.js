const { validateString, toArray, toBoolean, validatePropertyConfig, isEmpty, getDeepValue, getEager, throwError } = require('../../util');
const { ObjectType } = require('../../api-enums');
const { init: initCondition, process: processCondition } = require('../../conditions');
const assert = require('assert');
const { initMultiple, get: getValue } = require('../getters');

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
OBJECT_UPDATERS[ObjectType.Staff] = {
    edit: function (id, props) {
        return this.editStaff(id, props);
    },
    create: function () {
        throw 'Implement me'
    }
};

module.exports = {
    init: async function ({
        type, create, idProperty, nameProperty, dstProperty, fieldMap, propertyMap, verify,
        fieldErrorProperty, errProperty, condition, errorProperty
    }) {
        assert(!errProperty, '"errProperty" is discontinued. Use "fieldErrorProperty" instead');
        typeof type === 'string' && (type = getEager(ObjectType, type));
        getEager(OBJECT_UPDATERS, type);
        dstProperty = dstProperty ? validateString(dstProperty) : undefined;
        fieldErrorProperty = fieldErrorProperty ? validateString(fieldErrorProperty) : undefined;
        errorProperty = errorProperty ? validateString(errorProperty) : undefined;
        create = toBoolean(create) || undefined;
        verify = toBoolean(verify) || undefined;
        idProperty = idProperty ? validatePropertyConfig(idProperty) : undefined;
        nameProperty = nameProperty ? validatePropertyConfig(nameProperty) : undefined;
        idProperty === undefined && assert(nameProperty);

        const defaultNoGetterConverter = property => ({ getter: 'property', property, default: null });

        propertyMap = await initMultiple.call(this, propertyMap || {}, defaultNoGetterConverter);
        fieldMap = await initMultiple.call(this, fieldMap || {}, defaultNoGetterConverter);
        isEmpty(fieldMap) && assert(!isEmpty(propertyMap));
        condition = condition ? initCondition(condition) : undefined;
        return {
            type, create, idProperty, nameProperty, dstProperty, fieldMap, propertyMap,
            errorProperty, fieldErrorProperty, verify, condition
        };
    },
    convert: async function ({
        type, create, idProperty, nameProperty, dstProperty, fieldMap,
        propertyMap, verify, fieldErrorProperty, condition, errorProperty
    }, obj) {
        const { api } = this;
        const { create: createEntity, edit: editEntity } = OBJECT_UPDATERS[type];
        for (const srcObj of toArray(obj)) {
            if (condition && !processCondition(condition, srcObj)) {
                continue;
            }
            if (errorProperty) {
                delete srcObj[errorProperty];
            }
            const id = idProperty ? +getDeepValue(srcObj, idProperty) : undefined;
            const name = nameProperty ? getDeepValue(srcObj, nameProperty) : undefined;
            if (!(id || name || create)) {
                continue;
            }
            const fieldPatch = [];
            for (const Field in fieldMap) {
                const Value = await getValue.call(this, fieldMap[Field], srcObj);
                Value === undefined || fieldPatch.push({ Field, Value });
            }
            const props = {};
            for (let k in propertyMap) {
                const v = await getValue.call(this, propertyMap[k], srcObj);
                v === undefined || (props[k] = v);
            }
            if (isEmpty(fieldPatch)) {
                delete propertyMap.Fields;
            } else {
                props.Fields = fieldPatch;
            }
            if (isEmpty(props)) {
                continue;
            }
            let beforeUpdate;
            let result;
            try {
                if (id) {
                    result = await editEntity.call(api, id, props).catch(async err => {
                        beforeUpdate = await api.getEntity(type, id);
                        if (beforeUpdate) {
                            throw err;
                        }
                    });
                }
                if (!result && name) {
                    beforeUpdate = await api.getEntity(type, name);
                    beforeUpdate && (result = await editEntity.call(api, beforeUpdate.EntityID, props));
                }
                if (!result && create) {
                    result = await createEntity.call(api, props);
                    result._created = true;
                }
            } catch (error) {
                if (!errorProperty) {
                    throw error;
                }
                srcObj[errorProperty] = {
                    Error: (error.Message || error).toString(),
                    TimeStamp: new Date().toISOString(),
                    EntityID: beforeUpdate?.EntityID || id,
                    Entity: beforeUpdate?.RefName || name
                };
                continue;
            }

            if (result) {
                const { Fields: fieldsAfter } = result;
                const values = {};
                fieldPatch.forEach(({ Field: patchField }) => {
                    const { Field, Value } = fieldsAfter.demand(({ Field: resultField }) => resultField === patchField);
                    values[Field] = Value;
                });
                if (verify) {
                    assert(fieldsAfter);
                    let errors = [];
                    for (const { Field, Value } of fieldPatch) {
                        const Result = values[Field];
                        Result === Value || errors.push({ Field, Value, Result });
                    }
                    errors.length > 0 || (errors = undefined);
                    if (!fieldErrorProperty && errors) {
                        throwError(`Field(s) didn't update: ${JSON.stringify(errors)}`, FIELD_UPDATE_ERROR, errors);
                    }
                    srcObj[fieldErrorProperty] = errors;
                }
            }
            dstProperty && (srcObj[dstProperty] = result);
        }
        return obj;
    }
};

const FIELD_UPDATE_ERROR = 'FieldUpdateError';