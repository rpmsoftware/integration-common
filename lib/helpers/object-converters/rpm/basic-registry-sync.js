const { ObjectType: OT, WebhookEvents: WHE } = require('../../../api-enums');
const { getField } = require('../../../api-wrappers');
const { getEager, toArray } = require('../../../util');
const assert = require('assert');
let { get: getRpmApi } = require('../../global-instance');
getRpmApi = getRpmApi.bind(undefined, 'rpmApi');

const ACTIONS = {};
ACTIONS[OT.Supplier] = {
    create: WHE.SupplierAdd,
    delete: WHE.SupplierDelete
};
ACTIONS[OT.Customer] = {
    create: WHE.CustomerAdd,
    delete: WHE.CustomerTrash
};
ACTIONS[OT.AgentCompany] = {
    create: WHE.AgencyAdd,
    delete: WHE.AgencyTrash
};
ACTIONS[OT.Staff] = {
    create: WHE.StaffAdd,
    delete: WHE.StaffTrash
};

module.exports = {

    init: async function ({ type, process, referenceField }) {
        const api = await getRpmApi();
        type = getEager(OT, type);
        const { create: createEvent, delete: deleteEvent } = getEager(ACTIONS, type);
        process = (await api.getProcesses()).getActiveProcess(process, true);
        referenceField = (await process.getFields()).getField(referenceField, true);
        assert.strictEqual(referenceField.FieldType, OT.FormReference);
        assert.strictEqual(referenceField.SubType, type);
        referenceField = referenceField.Name;
        process = process.ProcessID;
        return { type, process, referenceField, createEvent, deleteEvent };
    },

    convert: async function (conf, events) {
        const { type, process, referenceField: Field, createEvent, deleteEvent } = conf;
        const api = await getRpmApi();
        for (const { ObjectType, EventName, ObjectID } of toArray(events)) {
            if (type !== ObjectType) {
                continue;
            }
            if (EventName === createEvent) {
                const { EntityID: Number, RefName: Value } = await api.demandEntity(type, ObjectID);
                const { Form } = await api.createForm(process, [{ Field, Value }], { Number });
                assert.strictEqual(getField.call(Form, Field, true).ID, ObjectID);
                assert.equal(Form.Number, ObjectID);
            } else if (EventName === deleteEvent) {
                const form = await api.getForm(process, ObjectID + '');
                form && await api.trashForm(form.Form.FormID);
            }
        }
        return events;
    }

};
