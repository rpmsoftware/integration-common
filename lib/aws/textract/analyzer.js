/* global Buffer */
const te = require('@aws-sdk/client-textract');
const { validateString, toBoolean, pause } = require('../../util');
const s3 = require('@aws-sdk/client-s3');
const assert = require('assert');

const s3Client = new s3.S3Client();
const teClient = new te.TextractClient();

const init = async ({ adapter, bucket, keepFiles, queries }) => {

    const analyzeCommandBase = { FeatureTypes: [te.FeatureType.QUERIES, te.FeatureType.TABLES] };

    {
        let { name, version: Version } = adapter;
        const { AdapterId } = (await teClient.send(new te.ListAdaptersCommand()))
            .Adapters.demand(({ AdapterName }) => AdapterName === name);

        Version += '';
        (await teClient.send(new te.ListAdapterVersionsCommand({ AdapterId })))
            .AdapterVersions.demand(({ AdapterVersion }) => AdapterVersion === Version);

        analyzeCommandBase.AdaptersConfig = { Adapters: [{ AdapterId, Version }] };
    }

    (await s3Client.send(new s3.ListBucketsCommand()))
        .Buckets.demand(({ Name }) => Name === bucket);

    keepFiles = toBoolean(keepFiles);

    {
        const Queries = [];
        const Pages = ['*'];
        for (let Alias in queries) {
            const cfg = queries[Alias];
            let { query: Text } = typeof cfg === 'object' ? cfg : { query: validateString(cfg) };
            if (Text) {
                validateString(Text);
            } else {
                Text = Alias;
                Alias = undefined;
            }
            Queries.push({ Text, Alias, Pages });
        }
        analyzeCommandBase.QueriesConfig = { Queries };
    }

    return { analyzeCommandBase, bucket, keepFiles };

};

const JOB_VERIFY_PERIOD = 5000;

async function analyze(fileName, fileData) {
    let { analyzeCommandBase, bucket: Bucket, keepFiles } = this;
    validateString(fileName);
    assert(Buffer.isBuffer(fileData));

    await s3Client.send(new s3.PutObjectCommand({
        Bucket,
        Body: fileData,
        Key: fileName,
    }));

    const command = new te.StartDocumentAnalysisCommand(Object.assign({
        DocumentLocation: {
            S3Object: {
                Bucket,
                Name: fileName
            }
        }
    }, analyzeCommandBase));

    // let seconds = Date.now();
    const { JobId } = await teClient.send(command);
    const j = new te.GetDocumentAnalysisCommand({ JobId });
    let r;
    while ((r = await teClient.send(j)).JobStatus === te.JobStatus.IN_PROGRESS) {
        await pause(JOB_VERIFY_PERIOD);
    }
    assert.strictEqual(r.JobStatus, te.JobStatus.SUCCEEDED);

    keepFiles || await s3Client.send(new s3.DeleteObjectCommand({ Bucket, Key: fileName }));

    let { Blocks: res } = r;
    let { NextToken: nt } = r;
    while (nt) {
        const { NextToken, JobStatus, Blocks } = await teClient.send(
            new te.GetDocumentAnalysisCommand({ JobId, NextToken: nt })
        );
        assert.strictEqual(JobStatus, te.JobStatus.SUCCEEDED);
        nt = NextToken;
        res = res.concat(Blocks);
    }
    // seconds = (Date.now() - seconds) / 1000;
    return res;
};



module.exports = { init, analyze };