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

    init: async function ({ idProperty, agencyIdProperty, create, dstProperty, propertyMap, fieldMap, errorProperty }) {
        errorProperty = errorProperty ? validateString(errorProperty) : undefined;
        validateString(dstProperty);
        idProperty = validatePropertyConfig(idProperty);
        create = toBoolean(create) || undefined;
        agencyIdProperty = agencyIdProperty ? validatePropertyConfig(agencyIdProperty) : undefined;
        create && assert(agencyIdProperty);
        const defaultNoGetterConverter = property => ({ getter: 'property', property, default: null });
        propertyMap = await initMultiple.call(this, propertyMap || {}, defaultNoGetterConverter);
        fieldMap = await initMultiple.call(this, fieldMap || {}, defaultNoGetterConverter);
        isEmpty(fieldMap) && assert(!isEmpty(propertyMap));
        return { idProperty, agencyIdProperty, create, dstProperty, propertyMap, fieldMap, errorProperty };
    },
    
    convert: async function ({ idProperty, agencyIdProperty, create, dstProperty, propertyMap, fieldMap, errorProperty }, obj) {
        const { api } = this;
        for (const srcObj of toArray(obj)) {
            if (errorProperty) {
                delete srcObj[errorProperty];
            }
            const repID = +getDeepValue(srcObj, idProperty);
            if (!repID && !create) {
                continue;
            }
            let agencyID;
            if (create && !repID) {
                agencyID = +getDeepValue(srcObj, agencyIdProperty);
                if (!agencyID) {
                    continue;
                }
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
            if (!create) {
                delete props.Username;
            }
            props = normalizeRequest(props);
            const noFields = fieldPatch.length < 1;
            if (noFields && isEmpty(props)) {
                continue;
            }
            noFields || (props.Fields = fieldPatch);

            let result;
            try {
                if (repID) {
                    try {
                        result = await api.editRep(repID, props);
                    } catch (err) {
                        if (!create) {
                            throw err;
                        }
                        result = await api.createRep(agencyID, props);
                        result._created = true;
                    }
                } else if (create) {
                    result = await api.createRep(agencyID, props);
                    result._created = true;
                }
            } catch (err) {
                if (!errorProperty) {
                    throw err;
                }
                const agency = await api.getAgency(agencyID);
                const rep = result || repID && await api.getRep(repID);
                srcObj[errorProperty] = {
                    Error: (err.Message || err).toString(),
                    TimeStamp: new Date().toISOString(),
                    AgencyID: agency?.AgencyID || agencyID,
                    Agency: agency?.Agency,
                    RepID: rep?.RepID || repID,
                    Rep: rep?.Rep
                };
                result = undefined;
            }
            srcObj[dstProperty] = result;
        }
        return obj;
    }
};
