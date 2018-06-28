(() => {
    var rpm = require('./api-wrappers');

    var api = new rpm.RpmApi(require('./util').readConfig('RPM_CONFIG', 'config.json').rpmEvolutionEngineering);
    var util = require('util');
    var assert = require('assert');

    var reffieldType = rpm.OBJECT_TYPE.FormReference;
    var refSubTypes = {};
    for (var key in rpm.REF_DATA_TYPE) {
        refSubTypes[rpm.REF_DATA_TYPE[key]] = key;
    }

    var processes = {};
    var data = [];
    var fieldsByUid = {};
    
    api.getProcesses(true)
        .then(response => {
            response = response.Procs;
            processes = response.toObject('ProcessID');
            if (!Array.isArray(response)) {
                response = [response];
            }
            var p = Promise.resolve();

            response.forEach(proc => p = p
                .then(() => proc.getFields())
                .then(fields => {
                    fields.Fields.forEach(field => {

                        if (field.FieldType !== reffieldType) {
                            return;
                        }
                        field.process = processes[fields.ProcessID];
                        assert(field.process);
                        fieldsByUid[field.Uid] = field;
                        data.push(field);
                    });
                })
            );
            return p;
        })
        .then(() => data.map(field => {
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
        }))
        .then(result => {
            result = require('to-csv')(result);
            var fileName = process.argv[2];
            fileName ? require('fs').writeFileSync(fileName, result) : console.info(result);
        }, console.error);
})();