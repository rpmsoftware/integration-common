const { toArray, validatePropertyConfig, getDeepValue, toBoolean } = require('../../util');

module.exports = {
    init: async function ({ array, formID, staffID, errors2actions }) {
        array = array ? validatePropertyConfig(array) : undefined;
        formID = validatePropertyConfig(formID);
        staffID = validatePropertyConfig(staffID);
        errors2actions = toBoolean(errors2actions) || undefined;
        return { array, formID, staffID, errors2actions };
    },

    convert: async function ({ array, formID: propFormID, staffID: propStaffID, errors2actions }, obj) {
        const { api } = this;
        let staffList;
        for (const e of toArray(obj)) {
            let formID = +getDeepValue(e, propFormID);
            if (!formID) {
                continue;
            }
            let form;
            const errors = [];

            let staffIDs = {};
            (array ? getDeepValue(e, array) : [e]).forEach(row => {
                let staffID = +getDeepValue(row, propStaffID);
                staffID && (staffIDs[staffID] = staffID);
            });

            for (let staffID in staffIDs) {
                staffID = staffIDs[staffID];

                staffList || (staffList = (await api.getStaffList()).StaffList);
                form || (form = (await api.demandForm(formID)).Form);
                
                const { Participants } = form;
                const { UserID: newUserID, Username, Name } = staffList.demand(({ ID }) => ID === staffID);
                if (Participants.find(({ UserID }) => newUserID === UserID)) {
                    continue;
                }
                try {
                    await api.addFormParticipant(formID, Username);
                } catch (e) {
                    if (!errors2actions) {
                        throw e;
                    }
                    errors.push(`Cannot add participant ${Name} (${Username}). Reason: ${e.Message || e.message || e + ''}`);
                }
            }
            errors.length > 0 && await api.errorToFormAction(errors.join('\n'), form);
        }
        return obj;
    }
};
