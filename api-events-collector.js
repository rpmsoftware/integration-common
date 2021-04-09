const assert = require('assert');
const { ObjectType: OT, WebhookEvents: WE } = require('./api-enums');
const { RpmApi } = require('./api-wrappers');

class EventsCollector {

    constructor(api) {
        assert(api instanceof RpmApi);
        this.events = [];
        const {
            editForm, createForm, trashForm, _archiveForm, _unarchiveForm, createFormSet,
            addFormParticipant, addNoteByFormID, addNoteByFormNumber
        } = api;

        const formProcesses = {};
        const self = this;

        api.editForm = async function () {
            const result = await editForm.apply(this, arguments);
            const ObjectID = result.Form.FormID;
            const ParentID = result.ProcessID;
            formProcesses[ObjectID] = ParentID;
            self.push({
                EventName: WE.FormEdit,
                ObjectType: OT.Form,
                ParentType: OT.PMTemplate,
                ObjectID,
                ParentID
            });
            return result;
        };

        api.createForm = async function () {
            const result = await createForm.apply(this, arguments);
            const ObjectID = result.Form.FormID;
            const ParentID = result.ProcessID;
            formProcesses[ObjectID] = ParentID;
            self.push({
                EventName: WE.FormStart,
                ObjectType: OT.Form,
                ParentType: OT.PMTemplate,
                ObjectID,
                ParentID
            });
            return result;
        };

        api.trashForm = async function (id) {
            const result = await trashForm.call(this, id);
            if (result.Success) {
                const ObjectID = id;
                const ParentID = formProcesses[ObjectID] || (await this.demandForm(id)).ProcessID;
                self.push({
                    EventName: WE.FormTrash,
                    ObjectType: OT.Form,
                    ParentType: OT.PMTemplate,
                    ObjectID,
                    ParentID
                });
            }
            return result;
        };

        api._archiveForm = async function (id) {
            const result = await _archiveForm.call(this, id);
            if (result.Success) {
                const ObjectID = id;
                const ParentID = formProcesses[ObjectID] || (await this.demandForm(id)).ProcessID;
                self.push({
                    EventName: WE.FormEdit,
                    ObjectType: OT.Form,
                    ParentType: OT.PMTemplate,
                    ObjectID,
                    ParentID
                });
            }
            return result;
        };

        api._unarchiveForm = async function (id) {
            const result = await _unarchiveForm.call(this, id);
            if (result.Success) {
                const ObjectID = id;
                const ParentID = formProcesses[ObjectID] || (await this.demandForm(id)).ProcessID;
                self.push({
                    EventName: WE.FormEdit,
                    ObjectType: OT.Form,
                    ParentType: OT.PMTemplate,
                    ObjectID,
                    ParentID
                });
            }
            return result;
        };

        api.createFormSet = async function () {
            const result = await createFormSet.apply(this, arguments);
            const ObjectID = result.Form.FormID;
            const ParentID = result.ProcessID;
            formProcesses[ObjectID] = ParentID;
            self.push({
                EventName: WE.FormEdit,
                ObjectType: OT.Form,
                ParentType: OT.PMTemplate,
                ObjectID,
                ParentID
            });
            return result;
        };

        api.addFormParticipant = async function () {
            const result = await addFormParticipant.apply(this, arguments);
            const ObjectID = result.Form.FormID;
            const ParentID = result.ProcessID;
            formProcesses[ObjectID] = ParentID;
            self.push({
                EventName: WE.FormEdit,
                ObjectType: OT.Form,
                ParentType: OT.PMTemplate,
                ObjectID,
                ParentID
            });
            return result;
        };

        api.addNoteByFormID = async function () {
            const result = await addNoteByFormID.apply(this, arguments);
            const ObjectID = result.Form.FormID;
            const ParentID = result.ProcessID;
            formProcesses[ObjectID] = ParentID;
            self.push({
                EventName: WE.FormEdit,
                ObjectType: OT.Form,
                ParentType: OT.PMTemplate,
                ObjectID,
                ParentID
            });
            return result;
        };

        api.addNoteByFormNumber = async function () {
            const result = await addNoteByFormNumber.apply(this, arguments);
            const ObjectID = result.Form.FormID;
            const ParentID = result.ProcessID;
            formProcesses[ObjectID] = ParentID;
            self.push({
                EventName: WE.FormEdit,
                ObjectType: OT.Form,
                ParentType: OT.PMTemplate,
                ObjectID,
                ParentID
            });
            return result;
        };
    }

    push(event) {
        assert.notStrictEqual(event.EventName, WE.FormRestore);
        const { EventName: en, ObjectID: oid } = event;
        const { events } = this;
        let foundFormStart;
        switch (en) {
            case WE.FormStart:
                assert(!events.find(({ ObjectID, ObjectType }) => ObjectID === oid && ObjectType === OT.Form));
                events.push(event);
                break;
            case WE.FormEdit:
                assert(!events.find(({ ObjectID, EventName }) => ObjectID === oid && EventName === WE.FormTrash));
                events.find(({ ObjectID, EventName }) => ObjectID === oid && EventName === WE.FormStart) ?
                    (event = undefined) : events.push(event);
                break;
            case WE.FormTrash:
                foundFormStart = false;
                this.events = events.filter(({ ObjectID, EventName, ObjectType }) => {
                    if (ObjectType !== OT.Form || ObjectID !== oid) {
                        return true;
                    }
                    (EventName === WE.FormStart) && (foundFormStart = true);
                });
                foundFormStart ? events.push(event) : (event = undefined);
        }
        return event;
    }

    get length() {
        return this.events.length;
    }

    clear() {
        this.events = [];
    }

    shift() {
        return this.events.shift();
    }

}

module.exports = EventsCollector;