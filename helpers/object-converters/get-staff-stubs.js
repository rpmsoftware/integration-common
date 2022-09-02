const { validateString, toArray, validatePropertyConfig, getDeepValue } = require('../../util');
const { ObjectType } = require('../../api-enums');

module.exports = {
    init: async function ({ dstProperty, groups }) {
        validateString(dstProperty);
        groups = groups ? validatePropertyConfig(groups) : undefined;
        return { dstProperty, groups };
    },

    convert: async function ({ dstProperty, groups: groupsCfg }, data) {
        const stubs = await this.api.getEntities(ObjectType.Staff);
        let staffGroups;
        for (const e of toArray(data)) {
            let groups = toArray(getDeepValue(e, groupsCfg));
            let ids;
            if (groups.length > 0) {
                ids = {};
                staffGroups || (staffGroups = await this.api.getEntities(ObjectType.StaffGroup));
                toArray(groups).forEach(nameOrID => {
                    if (!nameOrID) {
                        return;
                    }
                    const prop = typeof nameOrID === 'number' ? 'ID' : 'Group';
                    const g = staffGroups.find(g => g[prop] === nameOrID);
                    g && (ids[g.ID] = true);
                });
            }
            e[dstProperty] = ids ? stubs.filter(({ Groups }) => Groups.find(({ ID }) => ids[ID])) : stubs;
        }
        return data;
    }
};