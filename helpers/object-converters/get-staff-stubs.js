const assert = require('assert');
const { validateString, toArray, validatePropertyConfig, getDeepValue } = require('../../util');

const getStaffList = async function () {
    let [staffList, staffGroups] = await Promise.all([this.getStaffList(), this.getStaffGroups()]);
    staffGroups = staffGroups.Groups;
    staffList.StaffList.forEach(({ Groups }) => Groups.forEach(g =>
        g.Group = staffGroups.demand(({ ID }) => ID === g.ID).Group)
    );
    return staffList;
};

module.exports = {
    init: async function ({ dstProperty, groups }) {
        validateString(dstProperty);
        if (groups || (groups = undefined)) {
            let { fixed, property } = typeof groups === 'string' ? { property: groups } : groups;
            if (fixed || (fixed = undefined)) {
                const { Groups } = await this.api.getStaffGroups();
                fixed = toArray(fixed).map(nameOrID => Groups.demand(({ ID, Group }) => Group === nameOrID || ID === nameOrID).ID);
                assert(fixed.length > 0);
            } else {
                property = validatePropertyConfig(property || groups)
            }
            groups = { fixed, property };
        }
        return { dstProperty, groups };
    },

    convert: async function ({ dstProperty, groups: groupsCfg }, data) {
        let { StaffList } = await getStaffList.call(this.api);

        const { fixed, property } = groupsCfg || {};
        fixed && (StaffList = StaffList.filter(({ Groups }) => Groups.find(({ ID }) => fixed.indexOf(ID) >= 0)));

        for (const e of toArray(data)) {
            let result = StaffList;
            if (property) {
                let groups = getDeepValue(e, property);
                if (groups) {
                    groups = toArray(groups);
                    result = result.filter(({ Groups }) => Groups.find(({ Group, ID }) =>
                        groups.find(nameOrID => nameOrID === Group || nameOrID === ID)
                    ));
                }
            }
            e[dstProperty] = result;
        }
        return data;
    }
};