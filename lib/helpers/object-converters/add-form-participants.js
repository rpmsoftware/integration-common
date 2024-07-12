const { toArray, validatePropertyConfig, getDeepValue, toBoolean } = require('../../util');
const assert = require('assert');

module.exports = {
    init: async function ({ array, formID, staffID, nameProperty, errors2actions }) {
        array = array ? validatePropertyConfig(array) : undefined;
        formID = validatePropertyConfig(formID);
        staffID = staffID ? validatePropertyConfig(staffID) : undefined;
        nameProperty = nameProperty ? validatePropertyConfig(nameProperty) : undefined;
        staffID || assert(nameProperty);
        errors2actions = toBoolean(errors2actions) || undefined;
        return { array, formID, staffID, nameProperty, errors2actions };
    },

    convert: async function ({ array, formID: propFormID, staffID: propStaffID, nameProperty, errors2actions }, obj) {
        const { api } = this;
        let staffList;

        const searchProp = propStaffID ? 'ID' : 'Name';

        for (const e of toArray(obj)) {
            let formID = +getDeepValue(e, propFormID);
            if (!formID) {
                continue;
            }
            let form;
            const errors = [];

            let namesOrIDs = {};
            (array ? getDeepValue(e, array) : [e]).forEach(row => {
                let nameOrID = propStaffID ?
                    +getDeepValue(row, propStaffID) :
                    getDeepValue(row, nameProperty);
                nameOrID && (namesOrIDs[nameOrID] = nameOrID);
            });

            for (let nameOrID in namesOrIDs) {
                nameOrID = namesOrIDs[nameOrID];

                staffList || (staffList = (await api.getStaffList()).StaffList);
                form || (form = (await api.demandForm(formID)).Form);

                const { Participants } = form;

                const s = staffList.find(s => s[searchProp] === nameOrID);
                if (!s) {
                    // errors.push(`Cannot find staff member "${nameOrID}"`);
                    continue;
                }
                const { UserID: newUserID, Username, Name } = s;
                assert(Username);
                if (Participants.find(({ UserID }) => newUserID === UserID)) {
                    continue;
                }
                try {
                    await api.addFormParticipant(formID, Username);
                } catch (e) {
                    if (!errors2actions) {
                        throw e;
                    }
                    errors.push(`Cannot add participant ${Name} (${Username}). ${e.Message || e.message || e + ''}`);
                }
            }
            errors.length > 0 && await api.errorToFormAction(errors.join('\n'), form);
        }
        return obj;
    }
};
