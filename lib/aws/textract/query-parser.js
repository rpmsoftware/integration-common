const te = require('@aws-sdk/client-textract');
const assert = require('assert');
require('../../util');
const debug = require('debug')('rpm:textract:parser');

const isWithin = (inner, outer) => {
    inner = inner?.BoundingBox;
    outer = outer?.BoundingBox;
    return inner && outer
        && inner.Top >= outer.Top
        && inner.Left >= outer.Left
        && inner.Top + inner.Height <= outer.Top + outer.Height
        && inner.Left + inner.Width <= outer.Left + outer.Width;
};

const overlap = (g1, g2) => {
    g1 = g1?.BoundingBox;
    g2 = g2?.BoundingBox;
    if (!g1 || !g2) {
        return;
    }
    let { Top: t1, Left: l1, Height: b1, Width: r1 } = g1
    r1 += l1;
    b1 += t1;
    let { Top: t2, Left: l2, Height: b2, Width: r2 } = g2
    r2 += l2;
    b2 += t2;
    const pointWithin = (x, y, l, t, r, b) => x >= l && x <= r && y >= t && y <= b;

    return pointWithin(r1, t1, l2, t2, r2, b2)
        || pointWithin(r1, b1, l2, t2, r2, b2)
        || pointWithin(l1, t1, l2, t2, r2, b2)
        || pointWithin(l1, b1, l2, t2, r2, b2)
        || pointWithin(r2, t2, l1, t1, r1, b1);
};

const isCell = (BlockType) => {
    BlockType = BlockType.BlockType || BlockType;
    return BlockType === te.BlockType.CELL || BlockType === te.BlockType.MERGED_CELL;
};

function getCellByGeometry({ Id: id1, Geometry: g1, Page: p1 }) {
    const Blocks = this;

    let result = Blocks.filter(({ Id: id2, BlockType, Geometry: g2, Page: p2 }) =>
        p1 === p2 && id1 !== id2 && isCell(BlockType) && isWithin(g1, g2)
    );
    assert(result.length < 2);
    // return result[0];
    result.length > 0 || (
        result = Blocks.filter(({ Id: id2, BlockType, Geometry: g2, Page: p2 }) =>
            p1 === p2 && id1 !== id2 && isCell(BlockType) && overlap(g1, g2)
        )
    );
    return result[0];
}

function getParent({ Id }, type) {
    const Blocks = this;
    return Blocks.demand(({ Relationships, BlockType }) =>
        (!type || type === BlockType)
        && Relationships && Relationships.find(({ Ids }) => Ids.indexOf(Id) >= 0)
    );
}

function getBlockByID(id) {
    const Blocks = this;
    return Array.isArray(Blocks) ? Blocks.demand(({ Id }) => Id === id) : Blocks[id];
}

function getText({ Text, Relationships }) {
    if (Text) {
        return Text;
    }
    const result = [];
    Relationships && Relationships.forEach(({ Ids }) => Ids.forEach(id => {
        const b = getBlockByID.call(this, id);
        const text = b && getText.call(this, b);
        text && result.push(text);
    }));
    return result.join(SPACE) || undefined;
}

const normalizeBlocks = blocks => {
    const tables = [];
    const mergedCells = [];

    blocks.forEach(b => {
        let { Id, BlockType } = b;
        if (BlockType === te.BlockType.TABLE) {
            tables.push(b);
        } else if (BlockType === te.BlockType.CELL) {
            b.Text = getText.call(blocks, b);
        } else if (BlockType === te.BlockType.MERGED_CELL) {
            mergedCells[Id] = b;
        }
    });

    mergedCells.forEach(mc => {
        let text = [];
        mc.Relationships.forEach(({ Ids, Type }) => {
            assert.strictEqual(Type, te.RelationshipType.CHILD);
            Ids.forEach(id => {
                const c = getBlockByID.call(blocks, id);
                if (!c) {
                    return;
                }
                c.ParentCellID = mc.Id;
                const t = getText.call(blocks, c);
                t && text.push(t);
            });
        });
        mc.Text = text.join(SPACE) || undefined;
    });

    tables.forEach(t => t.Relationships && t.Relationships.forEach(r => r.Ids && r.Ids.forEach(id => {
        const ch = getBlockByID.call(blocks, id);
        ch && (ch.TableID = t.Id);
    })));

    return blocks.filter(({ ParentCellID }) => !ParentCellID);

};

function getCell(Answer) {
    const Blocks = this;
    return Answer.Geometry ? getCellByGeometry.call(Blocks, Answer) : Blocks.find(c =>
        c.Page === Answer.Page &&
        isCell(c) &&
        getText.call(Blocks, c) === Answer.Text
    );
}

const isEntityType = ({ EntityTypes }, type) => EntityTypes && EntityTypes.indexOf(type) >= 0;

function parseQueries(cfg, data) {
    if (data === undefined) {
        data = cfg;
        cfg = this;
    }
    const { tables, pages } = cfg;
    const blocks = normalizeBlocks(data.Blocks || data);

    let tableAnswers = {};
    let answers = {};

    const storeTableCell = (virtualTableID, key, cell) => {
        let obj = tableAnswers[virtualTableID] || (tableAnswers[virtualTableID] = {});
        obj = obj[cell.TableID] || (obj[cell.TableID] = {});
        obj[key] = cell;
    };

    blocks.forEach(({ BlockType, Query, Relationships, Page: queryPage }) => {
        if (BlockType !== te.BlockType.QUERY || !Relationships || Relationships.length < 1) {
            return;
        }

        const key = Query.Alias || Query.Text;
        Relationships.forEach(({ Ids }) => Ids.forEach(id => {
            const a = blocks.demand(({ Id, BlockType, Page }) =>
                Page === queryPage && Id === id && BlockType === te.BlockType.QUERY_RESULT
            );

            a.QueryKey = key;

            const virtualTableID = tables && tables[key] || undefined;
            if (virtualTableID) {
                if (a.Geometry) {
                    const cell = getCellByGeometry.call(blocks, a);
                    cell ?
                        storeTableCell(virtualTableID, key, cell) :
                        debug('Table cell not found for %j', a);
                } else {
                    debug('Geometry is absent for %j', a);
                }
                return;
            }

            const virtualPageID = a.virtualPageID = pages && pages[key] || '';
            let obj = answers[virtualPageID] || (answers[virtualPageID] = {});
            obj = obj[queryPage] || (obj[queryPage] = {});
            const ans = obj[key];
            const { Confidence, Text } = a;
            ans && Confidence < ans.Confidence || (obj[key] = { QueryKey: key, Confidence, Text });

        }));

    });

    const result = {};

    for (let virtualPageID in answers) {
        const group = answers[virtualPageID];
        let length = -1;
        let page = -1;
        let chosen;
        for (let pg in group) {
            const pageAnswers = Object.values(group[pg]);
            pg = +pg;
            assert(!isNaN(pg));
            if (pageAnswers.length < length || pageAnswers.length === length && pg >= page) {
                continue;
            }
            page = pg;
            length = pageAnswers.length;
            chosen = pageAnswers;
        }
        chosen.forEach(({ QueryKey, Text }) => result[QueryKey] = Text);
    }

    const allCells = {};

    blocks.forEach(b => {
        if (!isCell(b)) {
            return;
        }
        const { TableID } = b;
        assert(TableID);
        (allCells[TableID] || (allCells[TableID] = [])).push(b);
    });

    for (const virtualTableID in tableAnswers) {
        const vt = tableAnswers[virtualTableID];
        let maxLength = 0;
        let chosen;
        for (const tableID in vt) {
            const cells = vt[tableID];
            const { length } = Object.keys(cells);
            if (length <= maxLength) {
                continue;
            }
            maxLength = length;
            chosen = { tableID, cells };
        }
        const { tableID, cells } = chosen;
        let firstDataRow = 0;
        const keys = {};
        for (const key in cells) {
            let { RowIndex, RowSpan, ColumnIndex, ColumnSpan } = cells[key];
            assert.strictEqual(ColumnSpan, 1);
            keys[ColumnIndex] = key;
            const row = RowIndex + RowSpan - 1;
            row > firstDataRow && (firstDataRow = row);
        }
        --firstDataRow;

        const resultRows = [];
        allCells[tableID].forEach(({ Text, RowIndex, ColumnIndex }) => {
            --RowIndex;
            const key = keys[ColumnIndex];
            Text && key && RowIndex >= firstDataRow && (
                (resultRows[RowIndex] || (resultRows[RowIndex] = {}))[key] = Text
            );
        })
        result[virtualTableID] = resultRows.filter(row => row);
    }

    return result;
}

const SPACE = ' ';
const NEW_LINE = '\n';

module.exports = { parseQueries };