const te = require('@aws-sdk/client-textract');
const assert = require('assert');
require('../../util');


const isWithin = (inner, outer) => {
    inner = inner?.BoundingBox;
    outer = outer?.BoundingBox;
    return inner && outer
        && inner.Top >= outer.Top
        && inner.Left >= outer.Left
        && inner.Top + inner.Height <= outer.Top + outer.Height
        && inner.Left + inner.Width <= outer.Left + outer.Width;
}

function getCell({ Id: id1, Geometry: g1 }) {
    const Blocks = this;
    return Blocks.find(({ Id: id2, BlockType, Geometry: g2 }) =>
        id1 !== id2 && BlockType === te.BlockType.CELL && isWithin(g1, g2)
    );
}

function getParent({ Id }, type) {
    const Blocks = this;
    return Blocks.demand(({ Relationships, BlockType }) =>
        (!type || type === BlockType)
        && Relationships && Relationships.find(({ Ids }) => Ids.indexOf(Id) >= 0)
    );
}

const isEntityType = ({ EntityTypes }, type) => EntityTypes && EntityTypes.indexOf(type) >= 0;

function parseQueries(cfg, data) {
    if (data === undefined) {
        data = cfg;
        cfg = this;
    }
    const { tables } = cfg;
    const blocks = data.Blocks || data;

    const queries = {};
    blocks.forEach(({ BlockType, Query, Relationships }) => {
        if (BlockType !== te.BlockType.QUERY || !Relationships || Relationships.length < 1) {
            return;
        }
        const { Text, Alias } = Query;
        const c = queries[Text] || (queries[Text] = { Text, Alias });
        Relationships.forEach(({ Ids }) => Ids.forEach(id => {
            const a = blocks.demand(({ Id, BlockType }) => Id === id && BlockType === te.BlockType.QUERY_RESULT);
            c.Answer && c.Answer.Confidence > a.Confidence || (c.Answer = a);
        }));
    });

    const result = {};
    const tbls = {};

    for (let key in queries) {
        key = queries[key];
        const { Text, Alias, Answer } = key;
        if (!Answer) {
            continue;
        }
        key = Alias || Text;
        const cell = getCell.call(blocks, Answer);
        if (!cell || !isEntityType(cell, te.EntityType.COLUMN_HEADER)) {
            result[key] = Answer.Text;
            continue;
        }
        assert(isEntityType(cell, te.EntityType.COLUMN_HEADER));
        const table = getParent.call(blocks, cell, te.BlockType.TABLE);
        const tableID = tables && tables[key] || table.Id;
        const td = tbls[tableID] || (tbls[tableID] = { table, lastHeaderRow: -1, columnIndices: {} });
        td.columnIndices[cell.ColumnIndex] = key;
        td.lastHeaderRow > cell.RowIndex || (td.lastHeaderRow = cell.RowIndex);
    }

    for (const tableID in tbls) {
        const tableData = [];
        const { table, columnIndices, lastHeaderRow } = tbls[tableID];
        assert(lastHeaderRow > 0);

        const cells = table.Relationships.find(({ Type }) => Type === te.RelationshipType.CHILD)?.Ids || [];
        for (let c of cells) {
            c = blocks.demand(({ Id }) => c === Id);
            assert.strictEqual(c.BlockType, te.BlockType.CELL);
            let k = columnIndices[c.ColumnIndex];
            const row = c.RowIndex - lastHeaderRow - 1;
            if (!k || c.EntityTypes || !c.Relationships || row < 0) {
                continue;
            }
            (tableData[row] || (tableData[row] = {}))[k] = c.Relationships.map(({ Ids, Type }) => {
                assert.strictEqual(Type, te.RelationshipType.CHILD);
                return Ids.map(id => {
                    const { Text, BlockType } = blocks.demand(({ Id }) => Id === id);
                    assert.toString(BlockType, te.BlockType.WORD);
                    return Text;
                }).join(SPACE);
            }).join(NEW_LINE);
        }
        result[tableID] = tableData;
    }
    return result;
}

const SPACE = ' ';
const NEW_LINE = '\n';

module.exports = { parseQueries };