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
        groups = groups ? validatePropertyConfig(groups) : undefined;
        return { dstProperty, groups };
    },

    convert: async function ({ dstProperty, groups: groupsCfg }, data) {
        const { StaffList } = await getStaffList.call(this.api);
        for (const e of toArray(data)) {
            let result = StaffList;
            let groups = getDeepValue(e, groupsCfg);
            if (groups) {
                groups = toArray(groups);
                result = result.filter(({ Groups }) => Groups.find(({ Group, ID }) =>
                    groups.find(nameOrID => nameOrID === Group || nameOrID === ID)
                ));
            }
            e[dstProperty] = result;
        }
        return data;
    }
};