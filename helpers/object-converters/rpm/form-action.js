const { validateString, toArray, validatePropertyConfig, getDeepValue } = require('../../../util');
const { propertyOrValue } = require('../util');

const ASSIGNEE_GETTERS = {
    _owner: async function (formID) {
        const { Participants, Owner } = (await this.demandForm(formID)).Form;
        return Participants.demand(({ Name }) => Name === Owner).UserID;
    },

    _lastModified: async function (formID) {
        const { Participants, ModifiedBy } = (await this.demandForm(formID)).Form;
        return Participants.demand(({ Name }) => Name === ModifiedBy).UserID;
    },

};


module.exports = {
    init: async function ({ formIDProperty, assignee, description, dstProperty }) {
        formIDProperty = validatePropertyConfig(formIDProperty);
        dstProperty = dstProperty ? validateString(dstProperty) : undefined;
        description = propertyOrValue.init(description);
        if (!ASSIGNEE_GETTERS[assignee]) {
            let { value } = assignee = propertyOrValue.init(assignee);
            if (value) {
                let prop;
                if (isNaN(+value)) {
                    prop = 'Name';
                    value = value + '';
                } else {
                    prop = 'ID';
                    value = +value;
                }
                assignee.value = (await this.api.getStaffList(true))
                    .StaffList.demand(s => s[prop] === value).UserID;
            }
        }
        return { formIDProperty, assignee, description, dstProperty };
    },

    convert: async function ({ formIDProperty, assignee, description, dstProperty }, data) {
        const { api } = this;
        const StaffOnly = true;
        for (const e of toArray(data)) {
            const FormID = +getDeepValue(e, formIDProperty);
            let action;
            if (FormID) {
                const ag = ASSIGNEE_GETTERS[assignee];
                const UserID = ag ? await ag.call(api, FormID) : +propertyOrValue.get(assignee, e);
                const Description = propertyOrValue.get(description, e) + '';
                UserID && Description && (
                    action = await api.editFormAction({ FormID, Description, StaffOnly, UserID })
                );
            }
            dstProperty && (e[dstProperty] = action);
        }
        return data;
    }
};
