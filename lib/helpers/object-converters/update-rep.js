const { validateString, toArray, toBoolean, validatePropertyConfig, isEmpty, getDeepValue } = require('../../util');
const { initMultiple, get: getValue } = require('../getters');
const { PhoneType: PT } = require('../../api-enums');
const assert = require('assert');

const normalizeRequest = ({
    Username,
    Salutation,
    FirstName,
    LastName,
    Title,
    Email,
    BusinessPhone,
    Fax,
    OtherPhone,
    HomePhone,
    IsAlsoManager,
    Company,
    Enabled,
    CommissionsHidden,
    // Relationship
}) => {
    const result = {};

    Username == undefined || (result.Username = Username);
    Enabled == undefined || (result.Enabled = toBoolean(Enabled));
    CommissionsHidden == undefined || (result.CommissionsHidden = toBoolean(CommissionsHidden));
    IsAlsoManager == undefined || (result.IsAlsoManager = toBoolean(IsAlsoManager));

    const c = {};
    FirstName === undefined || (c.FirstName = FirstName);
    LastName === undefined || (c.LastName = LastName);
    Title === undefined || (c.Title = Title);
    Email === undefined || (c.Email = Email);
    Company === undefined || (c.Company = Company);
    Salutation === undefined || (c.Salutation = Salutation);

    const pn = [];
    BusinessPhone === undefined || pn.push({ Type: PT.Business, Number: BusinessPhone });
    Fax === undefined || pn.push({ Type: PT.Fax, Number: Fax });
    OtherPhone === undefined || pn.push({ Type: PT.Other, Number: OtherPhone });
    HomePhone === undefined || pn.push({ Type: PT.Home, Number: HomePhone });

    pn.length > 0 && (c.PhoneNumbers = pn);
    isEmpty(c) || (result.Contact = c);
    return result;
};

module.exports = {

    init: async function ({ idProperty, agencyIdProperty, nameProperty, create, dstProperty, propertyMap, fieldMap, errorProperty }) {
        errorProperty = errorProperty ? validateString(errorProperty) : undefined;
        validateString(dstProperty);
        idProperty = idProperty ? validatePropertyConfig(idProperty) :undefined;
        agencyIdProperty = agencyIdProperty ? validatePropertyConfig(agencyIdProperty) : undefined;
        nameProperty = nameProperty ? validatePropertyConfig(nameProperty) : undefined;
        create = toBoolean(create) || undefined;
        assert(idProperty || agencyIdProperty && nameProperty);
        const defaultNoGetterConverter = property => ({ getter: 'property', property, default: null });
        propertyMap = await initMultiple.call(this, propertyMap || {}, defaultNoGetterConverter);
        fieldMap = await initMultiple.call(this, fieldMap || {}, defaultNoGetterConverter);
        isEmpty(fieldMap) && assert(!isEmpty(propertyMap));
        return { idProperty, agencyIdProperty, nameProperty, create, dstProperty, propertyMap, fieldMap, errorProperty };
    },

    convert: async function ({ idProperty, agencyIdProperty, nameProperty, create, dstProperty, propertyMap, fieldMap, errorProperty }, obj) {
        const { api } = this;
        for (const srcObj of toArray(obj)) {
            if (errorProperty) {
                delete srcObj[errorProperty];
            }
            const id = idProperty ? +getDeepValue(srcObj, idProperty) : undefined;
            const name = nameProperty ? getDeepValue(srcObj, nameProperty) : undefined;
            const agencyID = agencyIdProperty ? +getDeepValue(srcObj, agencyIdProperty) : undefined;
            if (!id && !(name && agencyID)) {
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
            props = normalizeRequest(props);
            const noFields = fieldPatch.length < 1;
            if (noFields && isEmpty(props)) {
                continue;
            }
            noFields || (props.Fields = fieldPatch);
            let beforeUpdate;
            let result;
            try {
                if (id) {
                    result = await api.editRep(id, props).catch(async err => {
                        beforeUpdate = await api.getRep(id);
                        if (beforeUpdate) {
                            throw err;
                        }
                    });
                }
                if (!result && name) {
                    beforeUpdate = await api.getRep(agencyID, name);
                    beforeUpdate && (result = await api.editRep(beforeUpdate.RepID, props));
                }
                if (!result && create) {
                    result = await api.createRep(agencyID, props);
                    result._created = true;
                }
            } catch (err) {
                if (!errorProperty) {
                    throw err;
                }
                const agency = await api.getAgency(agencyID);
                srcObj[errorProperty] = {
                    Error: (err.Message || err).toString(),
                    TimeStamp: new Date().toISOString(),
                    AgencyID: agency?.AgencyID || agencyID,
                    Agency: agency?.Agency,
                    RepID: beforeUpdate?.RepID || id,
                    Rep: beforeUpdate?.Rep || name,
                    Username: beforeUpdate?.Username || props.Username
                };
                result = undefined;
            }
            srcObj[dstProperty] = result;
        }
        return obj;
    }
};
