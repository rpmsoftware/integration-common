/* global process */
(function () {
    var promised = require('promised-io/promise');
    var Deferred = promised.Deferred;
    var rpm = require('./api-wrappers');
    var api = new rpm.RpmApi(require('./util').readConfig('RPM_CONFIG', 'config.json'));
    var util = require('util');

    var reffieldType = rpm.OBJECT_TYPE.FormReference;
    var refSubTypes = {};
    for (var key in rpm.REF_DATA_TYPE) {
        refSubTypes[rpm.REF_DATA_TYPE[key]] = key;
    }

    function getFields(proc) {
        processes[proc.ProcessID] = proc;
        var deferred = new Deferred();
        proc.getFields().then(
            function (result) {
                deferred.resolve(result);
            },
            function (error) {
                console.error(util.format('Cannot get fields for process "%s" (%d)', proc.Process, proc.ProcessID), error);
                deferred.resolve();
            });
        return deferred.promise;
    }

    var processes = {};

    promised.seq([
        function () {
            return api.getProcesses(true);
        },
        function (response) {
            if (!Array.isArray(response)) {
                response = [response];
            }
            var steps = [];
            var data = [];
            var fieldsByUid = {};

            response.forEach(function (proc) {
                steps.push(function () {
                    return getFields(proc);
                });
                steps.push(function (fields) {
                    if (!fields) {
                        return;
                    }

                    var process = processes[fields.ProcessID];
                    fields.Fields.forEach(function (field) {

                        if (field.FieldType !== reffieldType) {
                            return;
                        }
                        field.process = process;
                        fieldsByUid[field.Uid] = field;
                        data.push(field);
                    });
                });
            });
            steps.push(function () {
                return data.map(function (field) {
                    var refProcName = processes[field.ProcessID];
                    refProcName = refProcName && refProcName.Process || util.format('[%s]', refSubTypes[field.SubType]);
                    var parent = fieldsByUid[field.ParentUid];
                    return {
                        'Process ID': field.process.ProcessID,
                        'Process Name': field.process.Process,
                        'Process Enabled': field.process.Enabled,
                        'Field Uid': field.Uid,
                        'Field Name': field.Name,
                        'Field Archived': field.Archived,
                        'Parent Process ID': parent && parent.process.ProcessID,
                        'Parent Process Name': parent && parent.process.Process,
                        'Parent Uid': field.ParentUid,
                        'Parent Name': parent && parent.Name,
                        'Ref Process ID': field.ProcessID,
                        'Ref Process Name': refProcName
                    };
                });
            });
            return promised.seq(steps);
        }
    ]).then(
        function (result) {
            result = require('to-csv')(result);
            var fileName = process.argv[2];
            fileName ? require('fs').writeFileSync(fileName, result) : console.info(result);
        },
        function (error) {
            console.error(error);
        });
})();