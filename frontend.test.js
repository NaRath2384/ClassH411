import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function frontend() {
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', innerText: '', textContent: '',
            classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {} });
        return elements.get(id);
    };
    const context = vm.createContext({ console, Date, Blob, URL, setTimeout,
        window: { addEventListener() {} },
        document: { getElementById: element, querySelectorAll: () => [] } });
    vm.runInContext(readFileSync(new URL('../app.js', import.meta.url), 'utf8'), context);
    return { run: code => vm.runInContext(code, context), element, context };
}

test('reports exclude unmarked students and apply local week/month filters', () => {
    const { run, element } = frontend();
    run(`students = [
        {id:'STU-001', name:'<img src=x onerror=alert(1)>', gender:'ប្រុស', avatar:'👨‍🎓'},
        {id:'STU-002', name:'New student', gender:'ស្រី', avatar:'👩‍🎓'}
    ];
    const now = new Date();
    attendanceRecords = {
        [localDate(now) + '_ព្រឹក']: {'STU-001':'T'},
        '2000-01-01_ព្រឹក': {'STU-001':'A'}
    };
    document.getElementById('attendanceDate').value = localDate(now);
    document.getElementById('attendanceSession').value = 'ព្រឹក';`);
    assert.equal(run('reportStats()[0].rate'), 40);
    assert.equal(run('reportStats()[1].totalClasses'), 0);
    assert.equal(run('reportStats()[1].rate'), 0);
    run("filterStats('month')");
    assert.equal(run('reportStats()[0].rate'), 80);
    run("filterStats('week')");
    assert.equal(run('reportStats()[0].totalClasses'), 1);
    run('renderAttendanceList(); updateAttendanceSummary(); renderStudentsList(); renderReportTable();');
    assert.equal(element('count-present').innerText, 0);
    assert.match(element('unmarkedCount').textContent, /1$/);
    for (const id of ['attendanceListContainer', 'studentCardsGrid', 'reportTableBody']) {
        assert.ok(!element(id).innerHTML.includes('<img src=x'));
        assert.match(element(id).innerHTML, /&lt;img/);
    }
    assert.equal(element('dashAvgRate').innerText, '80%');
    run("attendanceRecords = {}; renderReportTable();");
    assert.equal(element('dashAvgRate').innerText, '0%');
    assert.match(element('dashAvgStatus').innerText, /No records/);
});

test('saving waits for server confirmation and preserves UI data on failure', async () => {
    const { run, element, context } = frontend();
    context.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: 'Invalid attendance date.' }) });
    run("currentUserRole='admin'; students=[{id:'STU-001',name:'Test',gender:'ប្រុស',avatar:'👨‍🎓'}]; document.body={classList:{add(){},remove(){}}};");
    element('attendanceDate').value = 'not-a-date';
    element('attendanceSession').value = 'ព្រឹក';
    await run("setAttendance('STU-001', 'P')");
    assert.equal(run('Object.keys(attendanceRecords).length'), 0);
    assert.equal(element('toastMsg').innerText, 'Invalid attendance date.');
    assert.equal(run('saving'), false);
});
