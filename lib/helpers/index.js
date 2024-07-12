const assert = require('assert');
const { ObjectType } = require('../api-enums');

const PROP_USER_CACHE = Symbol();

async function getUsers() {
    const [agentUsers, staffList] = await Promise.all([
        this.getAgentUsers().then(({ AgentUsers }) => AgentUsers.map(
            ({ UserID, Username, Enabled, RepID: ID, Name }) =>
                ({ Name, UserID, Username, Enabled, ID, RefType: ObjectType.AgentRep })
        )),
        this.getStaffList().then(({ StaffList }) => StaffList.map(
            ({ UserID, Username, Enabled, ID, Name }) =>
                ({ Name, UserID, Username, Enabled, ID, RefType: ObjectType.Staff })
        ))
    ]);
    return agentUsers.concat(staffList);
}

exports.getUserInfo = async function (refType, id) {
    assert(refType);
    if (!id) {
        return;
    }
    const criteria = ({ RefType, ID }) => RefType === refType && ID === id;
    const firstTime = !this[PROP_USER_CACHE];
    firstTime && Object.defineProperty(this, PROP_USER_CACHE, { value: getUsers.call(this), configurable: true });
    const result = (await this[PROP_USER_CACHE])[firstTime ? 'demand' : 'find'](criteria);
    if (result) {
        return result;
    }
    Object.defineProperty(this, PROP_USER_CACHE, { value: getUsers.call(this), configurable: true });
    return (await this[PROP_USER_CACHE]).demand(criteria);
};
