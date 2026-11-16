const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, 'session-goal.cjs');
assert.ok(fs.existsSync(file), 'Session goal helper must exist');
const { latestRequest, latestTodo } = require(file);
const rows = [
  { id: 'u1', parentId: 'root', type: 'message', message: { role: 'user', content: [{ type: 'text', text: '最初目标' }] } },
  { id: 'a1', parentId: 'u1', type: 'message', message: { role: 'assistant', content: [] } },
  { id: 'old-todo', parentId: 'a1', type: 'message', message: { role: 'toolResult', toolName: 'todo', details: { phases: [{ tasks: [{ content: '旧分支任务', status: 'done' }] }] } } },
  { id: 'u2', parentId: 'a1', type: 'message', message: { role: 'user', content: [{ type: 'text', text: '[Image #1, 800x600] 请恢复二维码' }] } },
  { id: 'a2', parentId: 'u2', type: 'message', message: { role: 'assistant', content: [] } },
  { id: 'active-todo', parentId: 'a2', type: 'message', message: { role: 'toolResult', toolName: 'todo', details: { phases: [{ tasks: [{ content: '恢复二维码', status: 'completed' }, { content: '验证', status: 'pending' }] }] } } },
  { id: 'active', parentId: 'active-todo', type: 'message', message: { role: 'assistant', content: [] } },
];
assert.equal(latestRequest(rows), '请恢复二维码');
assert.deepEqual(latestTodo(rows), [{ text: '恢复二维码', status: 'done' }, { text: '验证', status: 'pending' }]);
assert.equal(latestRequest(rows.concat([{ id: 'u3', parentId: 'active', type: 'message', message: { role: 'user', content: '<system-reminder>内部提示</system-reminder>' } }])), '请恢复二维码');
assert.deepEqual(latestTodo(rows.concat([{ id: 'u3', parentId: 'active', type: 'message', message: { role: 'user', content: '新消息' } }])), latestTodo(rows));
assert.equal(latestRequest(rows.concat([{ id: 'u3', parentId: 'active', type: 'message', message: { role: 'user', content: '<hc from="t7d">检查依赖</hc> 再继续' } }])), '检查依赖 再继续');
console.log('Active branch request and TODO extraction checks passed.');
