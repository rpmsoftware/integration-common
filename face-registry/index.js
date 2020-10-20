const assert = require('assert');
const { normalizeInteger, validateString } = require('../util');
const debug = require('debug')('rpm:face:registry');
const { MSG_FORM_NOT_FOUND } = require('../api-errors');
const { RpmApi } = require('../api-wrappers');
const { API: MsFaceApi } = require('./ms-face-api');

const FILE_ID_PREFIX = 'FILE';
const FORM_ID_PREFIX = 'FORM';
const RE_FORM_NUMBER = new RegExp(`^${FORM_ID_PREFIX}(\\d+)$`, 'i');

class FaceRegistry {

    async identifyPersonFromImage(processID, image) {
        assert.strictEqual(typeof processID, 'number')
        debug('identifyPersonFromImage(%d)', processID);
        const { faceApi, rpmApi } = this;
        let detectedFace = await faceApi.detect(image);
        if (detectedFace.length > 1) {
            throw 'There is more than one face in the image';
        }
        detectedFace = detectedFace[0];
        if (!detectedFace) {
            debug('No faces found');
            return;
        }
        let personId = (await faceApi.identify(this.getPersonGroupID(processID), detectedFace))[0];
        assert(personId);
        assert.strictEqual(personId.faceId, detectedFace.faceId);
        personId = personId.candidates[0];
        if (personId) {
            debug('Found: %j', personId);
            personId = personId.personId;
            assert(personId);
            let dstForm = await this.getPersonFormID(personId);
            dstForm = await rpmApi.demandForm(dstForm);
            return dstForm.Form.Number;
        }
        debug('Could not identify a person');
    }


    async getPersonID(formID) {
        const { rpmApi, faceRegistryProcess } = this;
        const form = await rpmApi.getForm(faceRegistryProcess, FORM_ID_PREFIX + formID);
        return form && form.Form.AlternateID;
    }

    async deleteFormID(formID) {
        const { rpmApi, faceRegistryProcess } = this;
        const form = await rpmApi.getForm(faceRegistryProcess, FORM_ID_PREFIX + formID);
        return form && rpmApi.trashForm(form.Form.FormID);
    }

    async getFaceID(fileID) {
        const { rpmApi, faceRegistryProcess } = this;
        const form = await rpmApi.getForm(faceRegistryProcess, FILE_ID_PREFIX + fileID);
        return form && form.Form.AlternateID;
    }

    async registerPersonID(formID, personOrID) {
        const { rpmApi, faceRegistryProcess } = this;
        personOrID = validateString(personOrID.personId || personOrID);
        const formNumber = FORM_ID_PREFIX + normalizeInteger(formID);
        let form = await rpmApi.getForm(faceRegistryProcess, formNumber);
        if (form) {
            form = form.Form;
            if (form.AlternateID === personOrID) {
                return;
            }
            await rpmApi.trashForm(form.FormID);
        }
        return rpmApi.createForm(faceRegistryProcess, [], { Number: formNumber, AlternateID: personOrID });
    }

    async getPersonFormID(personID) {
        const { rpmApi } = this;
        const form = await rpmApi.demandForm(personID);
        const result = RE_FORM_NUMBER.exec(form.Form.Number);
        assert(result);
        return +result[1];
    }

    deleteByAlternateID(alternateID) {
        validateString(alternateID);
        return this.rpmApi.trashForm(alternateID).catch(({ Message }) => assert.strictEqual(Message, MSG_FORM_NOT_FOUND));
    }

    async deleteFileID(fileID) {
        const { rpmApi, faceRegistryProcess } = this;
        const form = await rpmApi.getForm(faceRegistryProcess, FILE_ID_PREFIX + fileID);
        return form && rpmApi.trashForm(form.Form.FormID);
    }

    async registerFaceID(fileID, faceOrID) {
        const { rpmApi, faceRegistryProcess } = this;
        faceOrID = validateString(faceOrID.persistedFaceId || faceOrID);
        const formNumber = FILE_ID_PREFIX + normalizeInteger(fileID);
        const form = await rpmApi.getForm(faceRegistryProcess, formNumber);
        await form ?
            rpmApi.editForm(form.Form.FormID, [], { AlternateID: faceOrID }) :
            rpmApi.createForm(faceRegistryProcess, [], { Number: formNumber, AlternateID: faceOrID });
    }

    getPersonGroupID(processID) {
        assert.strictEqual(typeof processID, 'number');
        const { instanceID, subscriberID } = this;
        return `${instanceID}_${subscriberID}_${processID}`;
    }

}

async function init(rpmApi, faceApi, faceRegistryProcess) {
    assert(rpmApi instanceof RpmApi);
    assert(faceApi instanceof MsFaceApi);
    validateString(faceRegistryProcess);
    let { InstanceID: instanceID, SubscriberID: subscriberID } = await rpmApi.getInfo();
    instanceID = normalizeInteger(instanceID);
    subscriberID = normalizeInteger(subscriberID);
    faceRegistryProcess = (await rpmApi.getProcesses()).getActiveProcess(faceRegistryProcess, true).ProcessID;
    const result = {
        instanceID,
        subscriberID,
        faceRegistryProcess,
    };
    Object.defineProperties(result, {
        rpmApi: { value: rpmApi, configurable: true },
        faceApi: { value: faceApi, configurable: true }
    });
    Object.setPrototypeOf(result, FaceRegistry.prototype);
    return result;
}

module.exports = { FaceRegistry, init };
