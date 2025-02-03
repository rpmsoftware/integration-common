const assert = require('assert');
const {
    validateString, toArray, validatePropertyConfig, getDeepValue, toBuffer
} = require("../../../../util");
const core = require('../../../../aws/textract/analyzer');

module.exports = {
    init: async function (cfg) {
        let { fileName, fileData, parallel, dstProperty } = cfg;
        fileName = validatePropertyConfig(fileName);
        fileData = validatePropertyConfig(fileData);
        validateString(dstProperty);
        if (parallel || (parallel = undefined)) {
            parallel = +parallel;
            assert(parallel > 0);
        }
        cfg = await core.init(cfg);
        return Object.assign({ fileData, fileName, dstProperty, parallel }, cfg);
    },

    convert: async function (cfg, obj) {
        let { fileData: fileDataProp, fileName: fileNameProp, dstProperty, parallel } = cfg;
        assert(!parallel);
        const analyze = core.analyze.bind(cfg);
        for (const o of toArray(obj)) {
            let fileData = getDeepValue(o, fileDataProp);
            const fileName = getDeepValue(o, fileNameProp);
            if (!fileData) {
                continue;
            }
            validateString(fileName);
            fileData = toBuffer(fileData);
            o[dstProperty] = await analyze(fileName, fileData);
        }
        return obj;
    }
};